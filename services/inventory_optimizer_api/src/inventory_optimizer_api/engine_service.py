from __future__ import annotations

import csv
import json
import zipfile
from io import BytesIO, StringIO

from inventory_optimizer.config import InventoryOptimizerConfig
from inventory_optimizer.domain.requests import OptimizationRequest
from inventory_optimizer.domain.results import OptimizationResult
from inventory_optimizer.facade import InventoryOptimizer
from inventory_optimizer.formulation.compiler_support import needs_qp
from inventory_optimizer.platform import PlatformInvocationContext
from inventory_optimizer.reporting.tables import result_tables
from inventory_optimizer.validation import validate_request
from pydantic import ValidationError

from .canonical import canonical_hash, canonical_json
from .capabilities import engine_identity, require_compatible_engine
from .config_adapter import RunConfigurationError, engine_overrides
from .contracts import (
    DatasetEnvelope,
    ExportRequest,
    LocatedIssue,
    RunRequest,
    RunResponse,
    ValidationReport,
)
from .datasets import summarize
from .scipy_highs_backend import ScipyHighsBackend


class DatasetValidationError(ValueError):
    def __init__(self, issues: tuple[LocatedIssue, ...]):
        self.issues = issues
        super().__init__(f"dataset rejected with {len(issues)} issue(s)")


def _contract_issues(exc: ValidationError) -> tuple[LocatedIssue, ...]:
    return tuple(
        LocatedIssue(
            code=f"CONTRACT_{str(item['type']).upper()}",
            message=str(item["msg"]),
            location="$." + ".".join(str(part) for part in item["loc"]),
        )
        for item in exc.errors(include_url=False, include_context=False, include_input=False)
    )


def validated_request(dataset: DatasetEnvelope, *, max_staleness_hours: float) -> OptimizationRequest:
    try:
        request = OptimizationRequest.model_validate(dataset.request)
    except ValidationError as exc:
        raise DatasetValidationError(_contract_issues(exc)) from exc
    normalized_payload = request.model_dump(mode="json")
    actual_hash = canonical_hash(normalized_payload)
    if actual_hash != dataset.request_hash:
        raise DatasetValidationError(
            (
                LocatedIssue(
                    code="REQUEST_HASH_MISMATCH",
                    message="Prepared request no longer matches its canonical hash.",
                    location="dataset.request_hash",
                ),
            )
        )
    if summarize(request) != dataset.summary:
        raise DatasetValidationError(
            (
                LocatedIssue(
                    code="SUMMARY_MISMATCH",
                    message="Disclosed dataset summary no longer matches its request.",
                    location="dataset.summary",
                ),
            )
        )
    issues = tuple(
        LocatedIssue(code=item.code, message=item.message, location=item.location)
        for item in validate_request(request, max_staleness_hours=max_staleness_hours)
    )
    if issues:
        raise DatasetValidationError(issues)
    return request


def validation_report(dataset: DatasetEnvelope, *, max_staleness_hours: float = 24.0) -> ValidationReport:
    try:
        validated_request(dataset, max_staleness_hours=max_staleness_hours)
    except DatasetValidationError as exc:
        return ValidationReport(valid=False, issues=exc.issues)
    return ValidationReport(valid=True)


def _optimizer(config: InventoryOptimizerConfig) -> InventoryOptimizer:
    identity = engine_identity()
    if identity["active_backend"] == "highs":
        return InventoryOptimizer(config=config)
    if needs_qp(config):
        raise RuntimeError("QP solves require the optional highspy backend")
    if identity["active_backend"] == "scipy_highs":
        return InventoryOptimizer(config=config, backend=ScipyHighsBackend())
    raise RuntimeError("no supported optimizer solver backend is installed")


def solve(run: RunRequest, *, correlation_id: str, idempotency_key: str) -> RunResponse:
    require_compatible_engine()
    request = validated_request(
        run.dataset,
        max_staleness_hours=run.run_config.max_staleness_hours,
    )
    if request.config_overrides:
        raise RunConfigurationError(
            (
                LocatedIssue(
                    code="REQUEST_CONFIG_OVERRIDES_DISABLED",
                    message="Request-level config overrides are not accepted by IBAL.",
                    location="dataset.request.config_overrides",
                ),
            )
        )
    overrides = engine_overrides(request, run.run_config)
    # The pinned 0.1.0 wheel does not include its repository-level default YAML. The public
    # frozen config model carries the same defaults and still rejects every unknown key.
    config = InventoryOptimizerConfig.model_validate(overrides)
    context = PlatformInvocationContext(
        request_id=request.request_id,
        correlation_id=correlation_id,
        idempotency_key=idempotency_key,
        problem_family=request.problem_family,
        as_of=request.as_of,
        authorization_reference="quantmeridian-service-boundary",
        schema_version="1.0.0",
        platform_tenant_id=request.desk_context.platform_tenant_id if request.desk_context else None,
        actor_reference=None,
    )
    result = _optimizer(config).optimize(request, platform=context)
    return RunResponse(
        source=run.dataset.source,
        request_hash=run.dataset.request_hash,
        result=result.model_dump(mode="json"),
    )


def _table_csv(columns: tuple[str, ...], rows: tuple[tuple[object, ...], ...]) -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def export_bundle(payload: ExportRequest) -> bytes:
    request = validated_request(payload.dataset, max_staleness_hours=168.0)
    try:
        result = OptimizationResult.model_validate(payload.result)
    except ValidationError as exc:
        raise DatasetValidationError(_contract_issues(exc)) from exc
    if result.request_id != request.request_id or result.input_hash != payload.dataset.request_hash:
        raise DatasetValidationError(
            (
                LocatedIssue(
                    code="RESULT_DATASET_MISMATCH",
                    message="Result identity does not match the prepared dataset.",
                    location="result.input_hash",
                ),
            )
        )
    report = validation_report(payload.dataset, max_staleness_hours=168.0)
    output = BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("normalized-input.json", canonical_json(payload.dataset.request) + "\n")
        archive.writestr("raw-result.json", json.dumps(payload.result, indent=2, sort_keys=True) + "\n")
        archive.writestr("validation-report.json", report.model_dump_json(indent=2) + "\n")
        for table in result_tables(result):
            archive.writestr(
                f"result-tables/{table.name}.csv",
                _table_csv(table.columns, table.rows),
            )
    return output.getvalue()
