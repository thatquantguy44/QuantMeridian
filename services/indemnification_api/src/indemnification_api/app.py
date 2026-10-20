"""Authenticated HTTP boundary for INDEM runs (spec020 IND-T13).

The service takes a snapshot and returns the complete analysis. It has no database and reads no
market data; it substitutes nothing. Run history is an in-memory ring of the most recent runs. Logs
carry ids and hashes only, never loan, borrower or owner data.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import OrderedDict
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, FastAPI, Header, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from . import MODEL_VERSION
from .analysis import run_analysis
from .auth import production_allowed, require_service_auth
from .canonical import canonical_hash
from .schema import validate_request, validate_snapshot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("indemnification_api")

MAX_BODY_BYTES = 8_000_000
HISTORY_SIZE = 50
API_VERSION = "1.0"

app = FastAPI(title="QuantMeridian INDEM API", version="1.0.0", docs_url=None, redoc_url=None)
_history: OrderedDict[str, dict[str, Any]] = OrderedDict()
_idempotency: OrderedDict[str, tuple[str, str]] = OrderedDict()
_run_lock = asyncio.Lock()


def _fields(**values: Any) -> str:
    """key=value pairs for the message, so plain-text logs show the ids and hashes too."""
    return " ".join(f"{key}={value}" for key, value in values.items())


def _error(
    status: int, code: str, category: str, message: str, issues: list[str] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {
        "api_schema_version": API_VERSION,
        "code": code,
        "category": category,
        "message": message,
    }
    if issues:
        body["issues"] = issues
    return JSONResponse(status_code=status, content=body)


def _manifest() -> dict[str, Any]:
    packaged = files("indemnification_api").joinpath("capability-manifest.json")
    if packaged.is_file():
        return json.loads(packaged.read_text())
    return json.loads(
        (Path(__file__).resolve().parents[2] / "capability-manifest.json").read_text()
    )


def _remember(run_id: str, response: dict[str, Any]) -> None:
    _history[run_id] = response
    _history.move_to_end(run_id)
    while len(_history) > HISTORY_SIZE:
        _history.popitem(last=False)


@app.get("/health")
async def health() -> dict[str, Any]:
    import os

    return {
        "status": "ready" if production_allowed() else "disabled",
        "ready": production_allowed(),
        "model_version": MODEL_VERSION,
        "auth_configured": bool(os.getenv("INDEMNIFICATION_API_TOKEN")),
    }


@app.get("/v1/capabilities")
async def capabilities(_: Annotated[UUID, Depends(require_service_auth)]) -> dict[str, Any]:
    return {**_manifest(), "model_version": MODEL_VERSION}


@app.get("/v1/runs/{run_id}", response_model=None)
async def get_run(
    run_id: str, _: Annotated[UUID, Depends(require_service_auth)]
) -> dict[str, Any] | JSONResponse:
    found = _history.get(run_id)
    if found is None:
        return _error(404, "RUN_NOT_FOUND", "not_found", "No such run in the recent history.")
    return found


@app.post("/v1/runs", response_model=None)
async def create_run(
    request: Request,
    correlation_id: Annotated[UUID, Depends(require_service_auth)],
    idempotency_key: Annotated[
        str | None, Header(alias="Idempotency-Key", min_length=1, max_length=128)
    ] = None,
) -> dict[str, Any] | JSONResponse:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return _error(413, "BODY_TOO_LARGE", "validation", "Request body is too large.")
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return _error(413, "BODY_TOO_LARGE", "validation", "Request body is too large.")
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return _error(422, "REQUEST_CONTRACT_INVALID", "validation", "Body is not valid JSON.")

    issues = validate_request(payload)
    if issues:
        return _error(
            422, "REQUEST_CONTRACT_INVALID", "validation", "Request contract is invalid.", issues
        )
    snapshot = payload["snapshot"]
    issues = validate_snapshot(snapshot)
    if issues:
        return _error(422, "SNAPSHOT_INVALID", "validation", "Snapshot is not consistent.", issues)

    request_hash = canonical_hash(payload)
    if idempotency_key is not None:
        previous = _idempotency.get(idempotency_key)
        if previous is not None:
            if previous[0] != request_hash:
                return _error(
                    409,
                    "IDEMPOTENCY_CONFLICT",
                    "conflict",
                    "This Idempotency-Key was used with a different request.",
                )
            found = _history.get(previous[1])
            if found is not None:
                return found

    if _run_lock.locked():
        return _error(429, "SERVICE_BUSY", "capacity", "A run is in progress; try again shortly.")
    options = payload["options"]
    received = datetime.now(UTC)
    started = time.perf_counter()
    run_id = request_hash[:32]
    async with _run_lock:
        try:
            result = await run_in_threadpool(
                run_analysis,
                snapshot,
                sensitivity_paths=options["sensitivity_paths"],
                stresses=options["stresses"],
                stress_profile_overrides=options["stress_profile_overrides"],
                created_at=received.strftime("%Y-%m-%dT%H:%M:%SZ"),
                run_id=run_id,
            )
        except ValueError as exc:
            too_large = "GB for exposures" in str(exc)
            logger.warning(
                "run_rejected",
                extra={"correlation_id": str(correlation_id), "request_hash": request_hash},
            )
            return _error(
                422,
                "RUN_TOO_LARGE" if too_large else "REQUEST_CONTRACT_INVALID",
                "capacity" if too_large else "validation",
                str(exc),
            )
        except Exception:
            logger.exception(
                "run_failed",
                extra={"correlation_id": str(correlation_id), "request_hash": request_hash},
            )
            return _error(500, "MODEL_ERROR", "internal", "The model failed; see the service log.")

    duration_ms = int((time.perf_counter() - started) * 1000)
    response = {
        "api_schema_version": API_VERSION,
        "correlation_id": str(correlation_id),
        "run": {
            "run_id": run_id,
            "received_at": received.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "snapshot_hash": snapshot["snapshot_hash"],
            "request_hash": request_hash,
            "status": "complete",
            "model_version": MODEL_VERSION,
            "duration_ms": duration_ms,
        },
        "result": result,
    }
    _remember(run_id, response)
    if idempotency_key is not None:
        _idempotency[idempotency_key] = (request_hash, run_id)
        while len(_idempotency) > HISTORY_SIZE:
            _idempotency.popitem(last=False)
    fields = {
        "correlation_id": str(correlation_id),
        "run_id": run_id,
        "snapshot_hash": snapshot["snapshot_hash"],
        "request_hash": request_hash,
        "mode": snapshot["run"]["mode"],
        "paths": snapshot["run"]["paths"],
        "loans": len(snapshot["loans"]),
        "borrowers": len(snapshot["borrowers"]),
        "duration_ms": duration_ms,
    }
    logger.info("run_complete %s", _fields(**fields), extra=fields)
    return response
