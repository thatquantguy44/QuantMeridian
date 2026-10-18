"""SIM-only HTTP adapter for the reviewed, standalone collateral model."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from typing import Annotated, Literal
from uuid import uuid4

from collateral_optimizer.demo import (SCENARIOS, SCENARIO_DESCRIPTIONS,
                                       apply_demo_scenario, build_demo_book)
from collateral_optimizer.domain import OptimizationResult, Snapshot
from collateral_optimizer.engine import optimize
from collateral_optimizer.verify import assess
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, model_validator

from .adapter import ABS_TOL, REL_TOL, check_result
from .identity import check_binding, manifest

logger = logging.getLogger("collateral_optimizer_api")
app = FastAPI(title="QuantMeridian Collateral Optimizer", version="1.0.0",
              docs_url=None, redoc_url=None)
MAX_BYTES = 2 * 1024 * 1024


class BodyLimit:
    def __init__(self, wrapped):
        self.wrapped = wrapped

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.wrapped(scope, receive, send)
        chunks = []
        count = 0
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            data = event.get("body", b"")
            count += len(data)
            if count > MAX_BYTES:
                return await error(413, "REQUEST_TOO_LARGE", "validation",
                                   "Maximum request size is 2 MiB.")(scope, receive, send)
            chunks.append(data)
            if not event.get("more_body", False):
                break
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
        return await self.wrapped(scope, replay, send)


app.add_middleware(BodyLimit)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_mode: Literal["SIM", "USER_UPLOAD", "PRODUCTION_BOOK"]
    scenario_id: str | None = None
    snapshot: Snapshot | None = None

    @model_validator(mode="after")
    def check_source(self) -> "RunRequest":
        if self.source_mode == "SIM":
            if self.scenario_id not in SCENARIOS or self.snapshot is not None:
                raise ValueError("SIM requires one named upstream scenario and no supplied snapshot")
        elif self.source_mode == "USER_UPLOAD":
            if self.snapshot is None or self.scenario_id is not None:
                raise ValueError("USER_UPLOAD requires a native snapshot and no scenario_id")
        elif self.snapshot is not None or self.scenario_id is not None:
            raise ValueError("production book inputs are disabled")
        return self


def error(status: int, code: str, category: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"api_schema_version": "1.0.0",
        "code": code, "category": category, "message": message, **extra})


@app.exception_handler(RequestValidationError)
async def bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    issues = [{"location": ".".join(str(p) for p in item["loc"]),
               "code": item["type"].upper(), "message": str(item["msg"])}
              for item in exc.errors()]
    return error(422, "SNAPSHOT_INVALID", "validation", "Native request validation failed.", issues=issues)


@app.exception_handler(HTTPException)
async def http_failure(_: Request, exc: HTTPException) -> JSONResponse:
    code = "AUTH_REQUIRED" if exc.status_code == 401 else "AUTH_UNCONFIGURED"
    return error(exc.status_code, code, "auth", str(exc.detail))


async def require_auth(authorization: Annotated[str | None, Header()] = None,
                 correlation: Annotated[str | None, Header(alias="X-Correlation-ID")] = None) -> str:
    token = os.getenv("COLLATERAL_OPTIMIZER_API_TOKEN", "")
    if not token:
        raise HTTPException(status_code=503, detail="Service token is not configured.")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(status_code=401, detail="Service authentication failed.")
    return correlation if correlation and len(correlation) <= 128 else str(uuid4())


def snapshot_for(payload: RunRequest) -> Snapshot:
    if payload.source_mode == "SIM":
        return apply_demo_scenario(build_demo_book(), payload.scenario_id or "baseline")
    assert payload.snapshot is not None
    return payload.snapshot


def incumbent_route_issues(snapshot: Snapshot) -> list[dict[str, str]]:
    current = {(p.asset_id, p.call_id): p.market_value for p in snapshot.current_pledges}
    checked = assess(snapshot, current)
    prefixes = ("wrong legal entity:", "cross-currency denied:", "wrong custodian:",
                "ineligible class or issuer:")
    return [{"location": "snapshot.current_pledges", "code": "INVALID_PLEDGE_ROUTE",
             "message": item} for item in checked.errors if item.startswith(prefixes)]


@app.get("/health")
async def health() -> dict:
    state, detail = check_binding()
    pinned = manifest()
    return {"status": "ready" if state == "READY" else state.lower(),
            "ready": state == "READY", "readiness": state,
            "detail": detail, "api_schema_version": "1.0.0",
            "model_status": "SIM_ONLY" if state == "READY" else state,
            "binding_approved": False, "production_book_enabled": False,
            "source_commit": pinned["commit"], "wheel_sha256": pinned["wheel_sha256"]}


@app.get("/v1/capabilities")
async def capabilities(_: Annotated[str, Depends(require_auth)]) -> dict:
    pinned = manifest()
    state, _ = check_binding()
    return {"api_schema_version": "1.0.0", "family": "collateral",
            "readiness": state, "binding_id": f"ibal-collateral-{pinned['commit']}",
            "model_revision": pinned["commit"], "package_version": pinned["package_version"],
            "adapter_version": pinned["adapter_version"],
            "snapshot_schema_version": pinned["snapshot_schema_version"],
            "result_schema_version": pinned["result_schema_version"],
            "formulations": ["LP", "MIP"], "features": pinned["features"],
            "source_modes": ["SIM", "USER_UPLOAD"], "production_book_enabled": False,
            "verification": {"kind": "fresh_source_domain_assessment",
                             "absolute_tolerance_usd": ABS_TOL, "relative_tolerance": REL_TOL}}


@app.get("/v1/demo/scenarios")
async def scenarios(_: Annotated[str, Depends(require_auth)]) -> dict:
    return {"source_mode": "SIM", "scenarios": [
        {"id": item, "description": SCENARIO_DESCRIPTIONS[item]} for item in SCENARIOS]}


@app.post("/v1/validate", response_model=None)
async def validate(payload: RunRequest, _: Annotated[str, Depends(require_auth)]) -> dict | JSONResponse:
    if payload.source_mode == "PRODUCTION_BOOK":
        return error(403, "PRODUCTION_BOOK_DISABLED", "policy",
                     "Governed sources, reservation, access, audit and execution controls are not approved.")
    snapshot = snapshot_for(payload)
    issues = incumbent_route_issues(snapshot)
    if issues:
        return error(422, "SNAPSHOT_INVALID", "validation", "Current pledge route is invalid.", issues=issues)
    return {"valid": True, "source_mode": payload.source_mode,
            "native_source": snapshot.source, "snapshot": snapshot.model_dump(mode="json"),
            "input_hash": snapshot.canonical_hash(), "parent_hash": snapshot.parent_hash,
            "scenario_id": snapshot.scenario_id, "schema_version": snapshot.schema_version}


@app.post("/v1/runs", response_model=None)
async def run(payload: RunRequest, correlation_id: Annotated[str, Depends(require_auth)],
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict | JSONResponse:
    if payload.source_mode == "PRODUCTION_BOOK":
        return error(403, "PRODUCTION_BOOK_DISABLED", "policy",
                     "Governed sources, reservation, access, audit and execution controls are not approved.")
    state, detail = check_binding()
    if state != "READY":
        return error(503, "BINDING_" + state, "binding", detail)
    snapshot = snapshot_for(payload)
    issues = incumbent_route_issues(snapshot)
    if issues:
        return error(422, "SNAPSHOT_INVALID", "validation", "Current pledge route is invalid.", issues=issues)
    try:
        native = optimize(snapshot)
        assessment, errors = check_result(snapshot, native)
    except Exception:
        logger.exception("collateral model solve failed", extra={"correlation_id": correlation_id})
        return error(503, "SOLVER_FAILED", "solve", "The model produced no verified result.")
    if errors:
        logger.error("adapter rejected native result", extra={"correlation_id": correlation_id,
                                                       "checks": errors})
        native = native.model_copy(update={"status": "unverified", "verified": False,
            "allocations": (), "movements": (), "coverage": (), "residual_liquidity_usd": None,
            "cost": None, "diagnostics": native.diagnostics.model_copy(update={
                "lp_duals_usd_per_unit": {}, "verification_errors": errors})})
        assessment = None
    lifecycle = ("SUCCEEDED_VERIFIED" if native.status == "optimal" and native.verified and not errors
                 else "INFEASIBLE" if native.status == "infeasible" else
                 "SUCCEEDED_UNVERIFIED" if native.status == "unverified" else "FAILED")
    pinned = manifest()
    raw = json.dumps(payload.model_dump(mode="json"), sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode()
    return {"api_schema_version": "1.0.0", "run_id": str(uuid4()),
            "correlation_id": correlation_id, "idempotency_key": idempotency_key,
            "lifecycle_status": lifecycle, "preview_only": True,
            "recommendation_eligible": False, "source_mode": payload.source_mode,
            "native_source": snapshot.source, "as_of": snapshot.as_of.isoformat(),
            "input_age_minutes": max((snapshot.as_of-a.observed_at).total_seconds()/60
                                     for a in snapshot.assets),
            "raw_payload_sha256": hashlib.sha256(raw).hexdigest(),
            "input_hash": snapshot.canonical_hash(), "parent_hash": snapshot.parent_hash,
            "scenario_id": snapshot.scenario_id, "model_commit": pinned["commit"],
            "package_version": pinned["package_version"],
            "wheel_sha256": pinned["wheel_sha256"], "adapter_version": pinned["adapter_version"],
            "snapshot_schema_version": pinned["snapshot_schema_version"],
            "result_schema_version": pinned["result_schema_version"],
            "snapshot": snapshot.model_dump(mode="json"), "result": native.model_dump(mode="json"),
            "adapter_verification": {"passed": assessment is not None and not errors,
                "errors": errors, "checked_rows": len(native.allocations),
                "reconstructed_cost_usd": assessment.total_cost_usd if assessment else None,
                "absolute_tolerance_usd": ABS_TOL, "relative_tolerance": REL_TOL}}
