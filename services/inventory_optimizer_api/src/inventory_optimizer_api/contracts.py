from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LocatedIssue(StrictModel):
    code: str
    message: str
    location: str
    severity: Literal["error", "warning"] = "error"


class ValidationReport(StrictModel):
    valid: bool
    issues: tuple[LocatedIssue, ...] = ()


class SourceDisclosure(StrictModel):
    mode: Literal["synthetic", "upload"]
    label: str
    seed: int | None = None
    generator_version: str | None = None
    upload_hash: str | None = None
    filename: str | None = None


class DatasetSummary(StrictModel):
    row_counts: dict[str, int]
    total_lendable_shares: float
    total_available_shares: float
    total_current_on_loan_shares: float
    total_demand_shares: float
    borrower_count: int
    security_count: int
    as_of: AwareDatetime
    effective_date: date


class DatasetEnvelope(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    template_schema_version: Literal["1.0"] = "1.0"
    source: SourceDisclosure
    request: dict[str, Any]
    request_hash: str
    summary: DatasetSummary
    validation: ValidationReport
    resolved_config: dict[str, Any] | None = None


def _default_as_of() -> datetime:
    return datetime(2026, 9, 14, 12, 0, tzinfo=UTC)


def _default_effective_date() -> date:
    return date(2026, 9, 14)


class SyntheticConfig(StrictModel):
    profile: Literal["balanced", "scarce", "concentrated", "specials"] = "balanced"
    scale: Literal["small", "medium", "large", "custom"] = "small"
    seed: int = Field(default=1701, ge=0, le=2**32 - 1)
    as_of: AwareDatetime = Field(default_factory=_default_as_of)
    effective_date: date = Field(default_factory=_default_effective_date)
    security_count: int = Field(default=8, ge=1, le=100)
    inventory_pool_count: int = Field(default=2, ge=1, le=20)
    borrower_count: int = Field(default=6, ge=1, le=100)
    parent_group_count: int = Field(default=3, ge=1, le=50)
    routes_per_security: int = Field(default=3, ge=1, le=20)
    starting_utilization: float = Field(default=0.35, ge=0.0, le=0.85)
    utilization_cap: float = Field(default=0.90, ge=0.25, le=1.0)
    borrower_concentration: float = Field(default=0.35, ge=0.0, le=1.0)
    fee_rate_mean: float = Field(default=0.025, ge=0.0001, le=0.25)
    fee_rate_dispersion: float = Field(default=0.012, ge=0.0, le=0.10)
    elasticity_mean: float = Field(default=0.10, ge=0.0, le=5.0)
    reserve_fraction: float = Field(default=0.05, ge=0.0, le=0.30)
    ineligible_fraction: float = Field(default=0.03, ge=0.0, le=0.50)
    discrete_route_fraction: float = Field(default=0.0, ge=0.0, le=0.50)

    @model_validator(mode="after")
    def check_dates_and_shape(self) -> SyntheticConfig:
        if self.effective_date < self.as_of.date():
            raise ValueError("effective_date must be on or after the as_of date")
        if self.parent_group_count > self.borrower_count:
            raise ValueError("parent_group_count cannot exceed borrower_count")
        return self


class RunConfig(StrictModel):
    planning_horizon_days: int = Field(default=1, ge=1, le=365)
    day_count_basis: Literal["act_360", "act_365"] = "act_360"
    solver_time_limit_seconds: float = Field(default=10.0, gt=0.0, le=60.0)
    relative_gap: float = Field(default=0.0001, ge=0.0, le=0.10)
    threads: int = Field(default=1, ge=1, le=8)
    solver_seed: int = Field(default=1701, ge=0, le=2**31 - 1)
    max_staleness_hours: float = Field(default=24.0, ge=0.0, le=168.0)
    minimum_entity_confidence: float = Field(default=0.80, ge=0.0, le=1.0)
    allocation_stability_penalty: float = Field(default=0.0, ge=0.0, le=1.0)
    # Opt-in engine diagnostics (InventoryBallast spec0020 DIAG-002, DIAG-005). They never change
    # the solve; when one cannot be produced the result section carries the engine's reason code.
    ranging: bool = False
    mip_progress: bool = False


class RunRequest(StrictModel):
    dataset: DatasetEnvelope
    run_config: RunConfig = Field(default_factory=RunConfig)


class RunResponse(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    source: SourceDisclosure
    request_hash: str
    result: dict[str, Any]


class ExplainRequest(StrictModel):
    """Explain an infeasible dataset with the engine's elastic diagnostic (spec0020 DIAG-003)."""

    dataset: DatasetEnvelope
    run_config: RunConfig = Field(default_factory=RunConfig)


class ExplainResponse(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    source: SourceDisclosure
    request_hash: str
    explanation: dict[str, Any]


MAX_SWEEP_SOLVES = 25


class SweepParameters(StrictModel):
    """One engine catalog parameter on one record (spec0020 DIAG-004). The engine re-checks
    every value against the parameter's own domain and refuses a sweep it will not run."""

    parameter: Literal[
        "route_fee_rate", "demand_elasticity", "utilization_minimum", "utilization_maximum"
    ]
    target_id: str = Field(min_length=1, max_length=200)
    mode: Literal["scenario", "local"] = "scenario"
    values: tuple[float, ...] = Field(default=(), max_length=MAX_SWEEP_SOLVES)
    lower: float | None = Field(default=None, allow_inf_nan=False)
    upper: float | None = Field(default=None, allow_inf_nan=False)
    points: int | None = Field(default=None, ge=2, le=MAX_SWEEP_SOLVES)
    max_solves: int = Field(default=MAX_SWEEP_SOLVES, ge=1, le=MAX_SWEEP_SOLVES)


class SweepRequest(StrictModel):
    dataset: DatasetEnvelope
    run_config: RunConfig = Field(default_factory=RunConfig)
    sweep: SweepParameters


class SweepResponse(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    source: SourceDisclosure
    request_hash: str
    sweep: dict[str, Any]


class ScenarioCatalogItem(StrictModel):
    scenario_type: str
    version: str
    description: str
    applicable_families: tuple[str, ...]
    parameters_schema: dict[str, Any]


class ScenarioCatalogResponse(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    scenarios: tuple[ScenarioCatalogItem, ...]


class ScenarioStressRequest(StrictModel):
    dataset: DatasetEnvelope
    run_config: RunConfig = Field(default_factory=RunConfig)
    baseline_result: dict[str, Any]
    scenario_type: str = Field(min_length=1, max_length=80)
    parameters: dict[str, Any]


class ScenarioStressResponse(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    source: SourceDisclosure
    request_hash: str
    baseline_run_id: str
    baseline_config_hash: str
    scenario_type: str
    generated_scenarios: tuple[dict[str, Any], ...]
    stress_report: dict[str, Any]


class ExportRequest(StrictModel):
    dataset: DatasetEnvelope
    result: dict[str, Any]


class ServiceError(StrictModel):
    code: str
    category: Literal[
        "authentication",
        "configuration",
        "validation",
        "infeasible",
        "timeout",
        "numerical",
        "internal",
        "unavailable",
    ]
    message: str
    correlation_id: str | None = None
    issues: tuple[LocatedIssue, ...] = ()


class RequestIdentity(StrictModel):
    correlation_id: str
    idempotency_key: str | None = None
    received_at: datetime
