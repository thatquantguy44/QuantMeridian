"""Authenticated HTTP boundary for MMKT preview and verified ticketed plans."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
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
    RunResult,
)
from .optimizer import ModelInputError, ModelSolveError
from .scenarios import solve_scenario_request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("money_market_api")

app = FastAPI(
    title="QuantMeridian Money Market Optimizer API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)


def _model_binding() -> str:
    value = os.getenv("MONEY_MARKET_MODEL_BINDING", "").strip()
    return value if value in ("local-mmkt-lp-v1", "local-mmkt-execution-v2") else ""


def _local_model_binding_enabled() -> bool:
    return bool(_model_binding())


def _manifest_text() -> str:
    """Packaged manifest (wheel install), else the service-root copy (run from source)."""
    packaged = files("money_market_api").joinpath("capability-manifest.json")
    if packaged.is_file():
        return packaged.read_text()
    return (Path(__file__).resolve().parents[2] / "capability-manifest.json").read_text()


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
    enabled = _local_model_binding_enabled()
    return HealthResponse(
        status="ready" if enabled else "unconfigured",
        ready=enabled,
        model_status=("ticketed_mip_available" if _model_binding() == "local-mmkt-execution-v2"
                      else "continuous_lp_relaxation" if enabled else "not_configured"),
        auth_configured=bool(os.getenv("MONEY_MARKET_API_TOKEN")),
    )


@app.get("/v1/capabilities", response_model=CapabilityManifest)
async def capabilities(_: Annotated[UUID, Depends(require_service_auth)]) -> CapabilityManifest:
    raw = json.loads(_manifest_text())
    enabled = _local_model_binding_enabled()
    raw["solver_enabled"] = enabled
    raw["model_families"] = (["continuous_lp_relaxation", "ticketed_mip"]
                             if _model_binding() == "local-mmkt-execution-v2"
                             else ["continuous_lp_relaxation"] if enabled else [])
    raw["readiness"] = "READY" if enabled else "UNCONFIGURED"
    raw["binding_id"] = _model_binding() or None
    return CapabilityManifest.model_validate(raw)


@app.post("/v1/runs", response_model=RunResult)
async def create_run(
    payload: OptimizeRequest,
    correlation_id: Annotated[UUID, Depends(require_service_auth)],
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)],
) -> RunResult | JSONResponse:
    if not _local_model_binding_enabled():
        return JSONResponse(
            status_code=501,
            content={
                "api_schema_version": "1.0.0",
                "code": "MODEL_NOT_CONFIGURED",
                "category": "unavailable",
                "message": "MMKT has no approved model binding configured.",
            },
        )
    if payload.policy.execution_mode == "ticketed_plan" and _model_binding() != "local-mmkt-execution-v2":
        return JSONResponse(status_code=501, content={
            "api_schema_version": "1.0.0", "code": "EXECUTION_BINDING_NOT_CONFIGURED",
            "category": "unavailable", "message": "Ticketed execution requires local-mmkt-execution-v2.",
        })
    request_hash = _canonical_hash(payload.model_dump(mode="json"))
    run_id = uuid4()
    received_at = datetime.now(UTC)
    for candidate in payload.instrument_candidates:
        rate = next(
            row for row in payload.rate_snapshot.rows
            if row.instrument_id == candidate.rate_instrument_id
        )
        if rate.status != "ok" or rate.mm_yield_pct is None:
            return JSONResponse(
                status_code=422,
                content={
                    "api_schema_version": "1.0.0",
                    "code": "RATE_NOT_PRICED",
                    "category": "validation",
                    "message": "Only candidates with status=ok and normalized mm_yield_pct may enter the model.",
                    "candidate_id": candidate.candidate_id,
                    "rate_instrument_id": rate.instrument_id,
                    "rate_status": rate.status,
                },
            )

    try:
        result = solve_scenario_request(payload)
    except ModelInputError as exc:
        return JSONResponse(
            status_code=422,
            content={
                "api_schema_version": "1.0.0",
                "code": "MODEL_INPUT_UNSUPPORTED",
                "category": "validation",
                "message": str(exc),
            },
        )
    except ModelSolveError as exc:
        logger.warning(
            "run_solve_unavailable",
            extra={
                "correlation_id": str(correlation_id),
                "request_id": str(payload.request_id),
                "request_hash": request_hash,
                "solver_status": exc.status,
            },
        )
        if exc.status == "infeasible":
            status_code, code = 422, "INFEASIBLE"
        elif exc.status == "verification_failed":
            status_code, code = 500, "VERIFICATION_FAILED"
        else:
            status_code, code = 503, "SOLVER_UNAVAILABLE"
        return JSONResponse(
            status_code=status_code,
            content={
                "api_schema_version": "1.0.0",
                "code": code,
                "category": "solve",
                "message": "No verified allocation was produced.",
                "request_id": str(payload.request_id),
                "rate_snapshot_hash": payload.rate_snapshot.snapshot_hash,
            },
        )

    run = {
        "run_id": run_id,
        "request_id": payload.request_id,
        "received_at": received_at,
        "request_hash": request_hash,
        "rate_snapshot_hash": payload.rate_snapshot.snapshot_hash,
        "status": "optimal_verified",
        "model_family": result["model_family"],
        "rate_source": payload.rate_snapshot.source,
        "cash_forecast_case": result["cash_forecast_case"],
        "rate_as_of_date": payload.rate_snapshot.as_of_date,
        "sim_set_id": payload.rate_snapshot.sim_set_id,
    }
    response = RunResult(
        correlation_id=correlation_id,
        run=run,
        currency_results=result["currency_results"],
        excluded_currencies=result["excluded_currencies"],
        execution_ready=result["execution_ready"],
        assumptions=result["assumptions"],
    )
    logger.info(
        "run_solved",
        extra={
            "correlation_id": str(correlation_id),
            "run_id": str(run_id),
            "request_id": str(payload.request_id),
            "request_hash": request_hash,
            "rate_snapshot_hash": payload.rate_snapshot.snapshot_hash,
            "idempotency_key_hash": hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest(),
            "rate_source": payload.rate_snapshot.source,
            "rate_row_count": len(payload.rate_snapshot.rows),
            "currency_count": len(result["currency_results"]),
            "allocation_count": sum(len(item["allocations"]) for item in result["currency_results"]),
            "execution_ready": result["execution_ready"],
        },
    )
    return response
