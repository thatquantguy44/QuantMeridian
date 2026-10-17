"""HTTP boundary for MMKT; market data and optimization stay outside this scaffold."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import UTC, datetime
from importlib.resources import files
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .auth import require_service_auth
from .contracts import (
    CapabilityManifest,
    HealthResponse,
    OptimizeRequest,
    RunMetadata,
    RunUnavailable,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("money_market_api")

app = FastAPI(
    title="QuantMeridian Money Market Optimizer API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)


def _canonical_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    issues = [
        {
            "location": ".".join(str(part) for part in issue["loc"]),
            "code": str(issue["type"]).upper(),
            "message": "Invalid value.",
        }
        for issue in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "api_schema_version": "1.0.0",
            "code": "REQUEST_CONTRACT_INVALID",
            "category": "validation",
            "message": "Request contract is invalid.",
            "issues": issues,
        },
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(auth_configured=bool(os.getenv("MONEY_MARKET_API_TOKEN")))


@app.get("/v1/capabilities", response_model=CapabilityManifest)
async def capabilities(_: Annotated[UUID, Depends(require_service_auth)]) -> CapabilityManifest:
    raw = json.loads(files("money_market_api").joinpath("capability-manifest.json").read_text())
    return CapabilityManifest.model_validate(raw)


@app.post(
    "/v1/runs",
    status_code=501,
    response_model=RunUnavailable,
    responses={501: {"model": RunUnavailable}},
)
async def create_run(
    payload: OptimizeRequest,
    correlation_id: Annotated[UUID, Depends(require_service_auth)],
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)],
) -> RunUnavailable:
    run = RunMetadata(
        run_id=uuid4(),
        request_id=payload.request_id,
        received_at=datetime.now(UTC),
        request_hash=_canonical_hash(payload.model_dump(mode="json")),
        rate_snapshot_hash=payload.rate_snapshot.snapshot_hash,
        status="model_not_implemented",
    )
    logger.info(
        "run_validated",
        extra={
            "correlation_id": str(correlation_id),
            "run_id": str(run.run_id),
            "request_id": str(run.request_id),
            "request_hash": run.request_hash,
            "rate_snapshot_hash": run.rate_snapshot_hash,
            "idempotency_key_hash": hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest(),
            "rate_source": payload.rate_snapshot.source,
            "rate_row_count": len(payload.rate_snapshot.rows),
        },
    )
    return RunUnavailable(correlation_id=correlation_id, run=run)
