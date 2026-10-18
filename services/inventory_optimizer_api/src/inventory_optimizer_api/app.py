from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, File, Header, Path, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from .auth import require_service_auth
from .capabilities import capability_payload, engine_identity
from .engine_source import require_importable_engine
from .telemetry import emit, timed

# Explain a missing engine before the imports below fail on it with a bare ModuleNotFoundError.
require_importable_engine()

from .config_adapter import RunConfigurationError  # noqa: E402
from .contracts import (  # noqa: E402
    DatasetEnvelope,
    ExportRequest,
    LocatedIssue,
    RunRequest,
    ScenarioStressRequest,
    SyntheticConfig,
)
from .engine_service import (  # noqa: E402
    DatasetValidationError,
    export_bundle,
    run_scenario_stress,
    scenario_catalog,
    solve,
    validation_report,
)
from .synthetic import generate_dataset  # noqa: E402
from .showcase import catalog as showcase_catalog, run_book as run_showcase_book  # noqa: E402
from .templates import json_template, workbook_template  # noqa: E402
from .upload import MAX_UPLOAD_BYTES, UploadValidationError, parse_upload  # noqa: E402

logging.basicConfig(level=logging.INFO)
SOLVE_SLOTS = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(_: FastAPI):
    identity = engine_identity()
    emit(
        "startup",
        engine_ready=identity["ready"],
        engine_source=identity["engine_source"],
        engine_mismatches=identity["engine_mismatches"],
        engine_version=identity["package_version"],
        engine_commit=identity["installed_commit"],
        active_backend=identity["active_backend"],
        highspy_version=identity["highspy_version"],
        scipy_version=identity["scipy_version"],
    )
    yield


app = FastAPI(
    title="QuantMeridian Inventory Optimizer API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


def _error(
    status_code: int,
    code: str,
    category: str,
    message: str,
    *,
    correlation_id: str | None = None,
    issues: tuple[LocatedIssue, ...] = (),
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "category": category,
            "message": message,
            "correlation_id": correlation_id,
            "issues": [item.model_dump(mode="json") for item in issues],
        },
    )


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_: Any, exc: RequestValidationError) -> JSONResponse:
    issues = tuple(
        LocatedIssue(
            code=f"REQUEST_{str(item['type']).upper()}",
            message=str(item["msg"]),
            location="$." + ".".join(str(part) for part in item["loc"]),
        )
        for item in exc.errors()
    )
    return _error(422, "REQUEST_CONTRACT_INVALID", "validation", "Request contract is invalid.", issues=issues)


@app.exception_handler(Exception)
async def unhandled_handler(_: Any, exc: Exception) -> JSONResponse:
    emit("unhandled_error", error_type=type(exc).__name__)
    return _error(500, "INTERNAL_ERROR", "internal", "The optimizer service failed safely.")


@app.get("/health")
async def health() -> dict[str, Any]:
    identity = engine_identity()
    backend = (
        identity["solver_backends"].get(identity["active_backend"])
        if identity["active_backend"] is not None
        else None
    )
    error_category = None
    if not identity["package_compatible"]:
        error_category = "incompatible_engine"
    elif identity["active_backend"] is None:
        error_category = "optimizer_backend_unavailable"
    return {
        "status": "ready" if identity["ready"] else "unready",
        "ready": identity["ready"],
        "api_schema_version": "1.0.0",
        "engine_package_version": identity["package_version"],
        "engine_commit": identity["installed_commit"],
        "engine_source": identity["engine_source"],
        "engine_mismatches": identity["engine_mismatches"],
        "backend": backend
        or {"name": None, "version": None, "installed": False, "ready": False},
        "solver_backends": identity["solver_backends"],
        "formulations": identity["formulations"],
        "error_category": error_category,
    }


@app.get("/v1/capabilities")
async def capabilities(_: Annotated[str, Depends(require_service_auth)]) -> dict[str, Any]:
    return capability_payload()


@app.get("/v1/showcase/books", response_model=None)
async def get_showcase_books(_: Annotated[str, Depends(require_service_auth)]) -> dict[str, Any] | JSONResponse:
    try:
        return await asyncio.to_thread(showcase_catalog)
    except RuntimeError:
        return _error(503, "ENGINE_INCOMPATIBLE", "unavailable", "Pinned optimizer engine is not ready.")


@app.post("/v1/showcase/runs", response_model=None)
async def post_showcase_run(
    payload: dict[str, Any],
    correlation_id: Annotated[str, Depends(require_service_auth)],
    _: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)],
) -> dict[str, Any] | JSONResponse:
    if set(payload) != {"book_id"} or not isinstance(payload.get("book_id"), str):
        return _error(422, "SHOWCASE_REQUEST_INVALID", "validation", "Choose one named pinned showcase book.", correlation_id=correlation_id)
    try:
        async with SOLVE_SLOTS:
            response = await asyncio.wait_for(asyncio.to_thread(run_showcase_book, payload["book_id"]), timeout=300)
    except ValueError:
        return _error(422, "SHOWCASE_BOOK_UNKNOWN", "validation", "Unknown pinned showcase book.", correlation_id=correlation_id)
    except RuntimeError:
        return _error(503, "ENGINE_INCOMPATIBLE", "unavailable", "Pinned optimizer engine is not ready.", correlation_id=correlation_id)
    except TimeoutError:
        return _error(504, "SHOWCASE_TIMEOUT", "timeout", "Pinned showcase run timed out.", correlation_id=correlation_id)
    emit("showcase_run", correlation_id=correlation_id, book_id=payload["book_id"], passed=response["report"]["passed"])
    return response


@app.get("/v1/templates/{kind}")
async def template_download(
    kind: Annotated[Literal["starter-xlsx", "advanced-xlsx", "request-json"], Path()],
    _: Annotated[str, Depends(require_service_auth)],
) -> Response:
    if kind == "request-json":
        return Response(
            json_template(),
            media_type="application/json",
            headers={"content-disposition": 'attachment; filename="ibal-request-v1.json"'},
        )
    return Response(
        workbook_template(kind),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"content-disposition": f'attachment; filename="ibal-{kind}-v1.xlsx"'},
    )


@app.post("/v1/datasets/synthetic", response_model=DatasetEnvelope)
async def synthetic_dataset(
    config: SyntheticConfig,
    correlation_id: Annotated[str, Depends(require_service_auth)],
) -> DatasetEnvelope:
    with timed("synthetic_dataset", correlation_id=correlation_id, source_mode="synthetic"):
        return await asyncio.to_thread(generate_dataset, config)


@app.post("/v1/datasets/upload", response_model=DatasetEnvelope)
async def upload_dataset(
    upload: Annotated[UploadFile, File(alias="file")],
    correlation_id: Annotated[str, Depends(require_service_auth)],
) -> DatasetEnvelope | JSONResponse:
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    try:
        with timed("upload_dataset", correlation_id=correlation_id, source_mode="upload", upload_bytes=len(data)):
            return await asyncio.to_thread(parse_upload, data, upload.filename or "upload")
    except UploadValidationError as exc:
        emit("upload_rejected", correlation_id=correlation_id, issue_codes=[item.code for item in exc.issues], issue_count=len(exc.issues))
        return _error(422, "UPLOAD_INVALID", "validation", "Upload validation failed.", correlation_id=correlation_id, issues=exc.issues)


@app.post("/v1/validate")
async def validate_dataset(
    dataset: DatasetEnvelope,
    correlation_id: Annotated[str, Depends(require_service_auth)],
) -> dict[str, Any]:
    report = validation_report(dataset)
    emit("dataset_validated", correlation_id=correlation_id, valid=report.valid, issue_count=len(report.issues), source_mode=dataset.source.mode)
    return report.model_dump(mode="json")


@app.get("/v1/scenarios/catalog")
async def get_scenario_catalog(
    correlation_id: Annotated[str, Depends(require_service_auth)],
) -> dict[str, Any]:
    try:
        catalog = scenario_catalog()
    except RuntimeError:
        return _error(
            503,
            "ENGINE_INCOMPATIBLE",
            "unavailable",
            "Pinned optimizer engine is not ready.",
            correlation_id=correlation_id,
        )
    emit("scenario_catalog_read", correlation_id=correlation_id)
    return catalog.model_dump(mode="json")


@app.post("/v1/runs", response_model=None)
async def create_run(
    run: RunRequest,
    correlation_id: Annotated[str, Depends(require_service_auth)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any] | JSONResponse:
    if not idempotency_key or len(idempotency_key) > 128:
        return _error(
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "validation",
            "A bounded Idempotency-Key is required.",
            correlation_id=correlation_id,
        )
    try:
        async with SOLVE_SLOTS:
            async with asyncio.timeout(run.run_config.solver_time_limit_seconds + 5.0):
                with timed("solve", correlation_id=correlation_id, source_mode=run.dataset.source.mode):
                    response = await asyncio.to_thread(
                        solve,
                        run,
                        correlation_id=correlation_id,
                        idempotency_key=idempotency_key,
                    )
        result = response.model_dump(mode="json")
        emit("solve_completed", correlation_id=correlation_id, source_mode=run.dataset.source.mode, solver_status=response.result.get("status"), verification_passed=(response.result.get("verification") or {}).get("passed"))
        return result
    except (DatasetValidationError, RunConfigurationError) as exc:
        emit("solve_rejected", correlation_id=correlation_id, issue_codes=[item.code for item in exc.issues], issue_count=len(exc.issues))
        return _error(422, "RUN_REJECTED", "validation", "Run validation failed.", correlation_id=correlation_id, issues=exc.issues)
    except RuntimeError:
        return _error(503, "ENGINE_INCOMPATIBLE", "unavailable", "Pinned optimizer engine is not ready.", correlation_id=correlation_id)
    except TimeoutError:
        return _error(504, "SOLVE_TIMEOUT", "timeout", "Solve exceeded the service deadline.", correlation_id=correlation_id)


@app.post("/v1/scenarios/stress-test", response_model=None)
async def create_scenario_stress_test(
    run: ScenarioStressRequest,
    correlation_id: Annotated[str, Depends(require_service_auth)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any] | JSONResponse:
    if not idempotency_key or len(idempotency_key) > 128:
        return _error(
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "validation",
            "A bounded Idempotency-Key is required.",
            correlation_id=correlation_id,
        )
    try:
        async with SOLVE_SLOTS:
            async with asyncio.timeout(305.0):
                with timed(
                    "scenario_stress",
                    correlation_id=correlation_id,
                    source_mode=run.dataset.source.mode,
                ):
                    response = await asyncio.to_thread(
                        run_scenario_stress,
                        run,
                        correlation_id=correlation_id,
                        idempotency_key=idempotency_key,
                    )
        return response.model_dump(mode="json")
    except (DatasetValidationError, RunConfigurationError) as exc:
        emit(
            "scenario_stress_rejected",
            correlation_id=correlation_id,
            issue_codes=[item.code for item in exc.issues],
            issue_count=len(exc.issues),
        )
        return _error(
            422,
            "SCENARIO_RUN_REJECTED",
            "validation",
            "Scenario run validation failed.",
            correlation_id=correlation_id,
            issues=exc.issues,
        )
    except RuntimeError:
        return _error(
            503,
            "ENGINE_INCOMPATIBLE",
            "unavailable",
            "Pinned optimizer engine is not ready.",
            correlation_id=correlation_id,
        )
    except TimeoutError:
        return _error(
            504,
            "SCENARIO_TIMEOUT",
            "timeout",
            "Scenario stress run exceeded the service deadline.",
            correlation_id=correlation_id,
        )


@app.post("/v1/exports/result-tables", response_model=None)
async def export_result_tables(
    payload: ExportRequest,
    correlation_id: Annotated[str, Depends(require_service_auth)],
) -> Response | JSONResponse:
    try:
        archive = await asyncio.to_thread(export_bundle, payload)
    except DatasetValidationError as exc:
        return _error(422, "EXPORT_REJECTED", "validation", "Export validation failed.", correlation_id=correlation_id, issues=exc.issues)
    emit("export_created", correlation_id=correlation_id, source_mode=payload.dataset.source.mode, export_bytes=len(archive))
    return Response(
        archive,
        media_type="application/zip",
        headers={"content-disposition": 'attachment; filename="ibal-result-bundle.zip"'},
    )
