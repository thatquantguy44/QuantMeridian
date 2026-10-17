"""Versioned, strict request and metadata contracts for the MMKT service."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    field_validator,
    model_validator,
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RateSnapshotRow(StrictModel):
    instrument_id: str = Field(min_length=1, max_length=128)
    quoted_rate_pct: FiniteFloat | None
    quoted_basis: str | None = Field(default=None, max_length=64)
    mm_yield_pct: FiniteFloat | None
    observation_date: date | None
    staleness_days: int | None = Field(default=None, ge=0)
    status: str = Field(min_length=1, max_length=32)
    status_detail: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def successful_rate_is_normalized(self) -> RateSnapshotRow:
        if self.status == "ok" and self.mm_yield_pct is None:
            raise ValueError("an ok rate row requires mm_yield_pct")
        return self


class RateSnapshot(StrictModel):
    source: Literal["gold", "sim"]
    as_of_date: date
    snapshot_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    sim_set_id: str | None = Field(default=None, min_length=1, max_length=128)
    rows: list[RateSnapshotRow] = Field(min_length=1, max_length=10_000)

    @field_validator("rows")
    @classmethod
    def unique_instrument_rows(cls, rows: list[RateSnapshotRow]) -> list[RateSnapshotRow]:
        identifiers = [row.instrument_id for row in rows]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("rate snapshot instrument_id values must be unique")
        return rows

    @model_validator(mode="after")
    def explicit_sim_selection(self) -> RateSnapshot:
        if self.source == "sim" and not self.sim_set_id:
            raise ValueError("SIM rate snapshots require an explicit sim_set_id")
        if self.source == "gold" and self.sim_set_id is not None:
            raise ValueError("Gold rate snapshots cannot include sim_set_id")
        return self


class HorizonInput(StrictModel):
    start_date: date
    end_date: date
    period_dates: list[date] = Field(min_length=1, max_length=366)

    @model_validator(mode="after")
    def ordered_periods_within_horizon(self) -> HorizonInput:
        if self.end_date < self.start_date:
            raise ValueError("horizon end_date must be on or after start_date")
        if self.period_dates != sorted(set(self.period_dates)):
            raise ValueError("period_dates must be unique and increasing")
        if any(day < self.start_date or day > self.end_date for day in self.period_dates):
            raise ValueError("period_dates must fall within the requested horizon")
        return self


class CashForecastPoint(StrictModel):
    period_date: date
    legal_entity_id: str = Field(min_length=1, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    opening_cash: FiniteFloat
    known_net_flow: FiniteFloat
    estimated_residual_p10: FiniteFloat
    estimated_residual_p50: FiniteFloat
    estimated_residual_p90: FiniteFloat

    @model_validator(mode="after")
    def ordered_residual_bands(self) -> CashForecastPoint:
        if not (
            self.estimated_residual_p10
            <= self.estimated_residual_p50
            <= self.estimated_residual_p90
        ):
            raise ValueError("estimated residual bands must satisfy p10 <= p50 <= p90")
        return self


class InstrumentCandidate(StrictModel):
    candidate_id: str = Field(min_length=1, max_length=128)
    rate_instrument_id: str = Field(min_length=1, max_length=128)
    instrument_type: Literal[
        "government_mmf",
        "prime_mmf",
        "treasury_bill",
        "tri_party_repo",
        "bilateral_repo",
        "fed_rrp",
        "commercial_paper",
        "certificate_of_deposit",
        "bank_deposit",
    ]
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    issuer_id: str | None = Field(max_length=128)
    counterparty_id: str | None = Field(max_length=128)
    rating: str | None = Field(max_length=32)
    settlement_date: date
    maturity_date: date
    cutoff_at: datetime | None
    minimum_ticket_amount: FiniteFloat = Field(ge=0)
    lot_size_amount: FiniteFloat = Field(gt=0)
    maximum_amount: FiniteFloat | None = Field(ge=0)
    explicit_cost_bps: FiniteFloat = Field(ge=0)

    @model_validator(mode="after")
    def valid_dates(self) -> InstrumentCandidate:
        if self.maturity_date < self.settlement_date:
            raise ValueError("maturity_date must be on or after settlement_date")
        return self


class LiquidityFloor(StrictModel):
    period_date: date
    legal_entity_id: str = Field(min_length=1, max_length=128)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    minimum_cash: FiniteFloat = Field(ge=0)


class ExposureLimit(StrictModel):
    dimension: Literal["issuer", "counterparty", "fund", "rating", "fed_rrp"]
    key: str = Field(min_length=1, max_length=128)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    maximum_amount: FiniteFloat | None
    maximum_portfolio_fraction: FiniteFloat | None = Field(ge=0, le=1)
    minimum_rating: str | None = Field(max_length=32)

    @model_validator(mode="after")
    def explicit_limit_value(self) -> ExposureLimit:
        if (
            self.maximum_amount is None
            and self.maximum_portfolio_fraction is None
            and self.minimum_rating is None
        ):
            raise ValueError("an exposure limit must specify an amount, fraction, or rating floor")
        if self.maximum_amount is not None and self.maximum_amount < 0:
            raise ValueError("maximum_amount must be nonnegative")
        return self


class PolicyInputs(StrictModel):
    policy_id: str = Field(min_length=1, max_length=128)
    # Null explicitly means the objective is not combined across currencies by this request.
    objective_currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    daily_liquidity_floors: list[LiquidityFloor] = Field(max_length=366)
    weekly_liquidity_floors: list[LiquidityFloor] = Field(max_length=60)
    maximum_wam_days: FiniteFloat | None = Field(ge=0)
    maximum_wal_days: FiniteFloat | None = Field(ge=0)
    maximum_ticket_count: int | None = Field(ge=1)
    exposure_limits: list[ExposureLimit] = Field(max_length=10_000)


class OptimizeRequest(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    request_id: UUID
    rate_snapshot: RateSnapshot
    horizon: HorizonInput
    cash_forecast: list[CashForecastPoint] = Field(min_length=1, max_length=10_000)
    instrument_candidates: list[InstrumentCandidate] = Field(min_length=1, max_length=10_000)
    policy: PolicyInputs

    @model_validator(mode="after")
    def cross_reference_inputs(self) -> OptimizeRequest:
        periods = set(self.horizon.period_dates)
        if any(point.period_date not in periods for point in self.cash_forecast):
            raise ValueError("cash forecast points must use a declared horizon period")
        candidate_ids = [item.candidate_id for item in self.instrument_candidates]
        if len(set(candidate_ids)) != len(candidate_ids):
            raise ValueError("instrument candidate IDs must be unique")
        rate_ids = {row.instrument_id for row in self.rate_snapshot.rows}
        missing_rates = {
            item.rate_instrument_id
            for item in self.instrument_candidates
            if item.rate_instrument_id not in rate_ids
        }
        if missing_rates:
            raise ValueError("every instrument candidate must reference a rate snapshot row")
        floor_dates = {
            floor.period_date
            for floor in self.policy.daily_liquidity_floors
            + self.policy.weekly_liquidity_floors
        }
        if not floor_dates.issubset(periods):
            raise ValueError("liquidity floor dates must use declared horizon periods")
        return self


class RunMetadata(StrictModel):
    run_id: UUID
    request_id: UUID
    received_at: AwareDatetime
    request_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    rate_snapshot_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["model_not_implemented"]


class RunUnavailable(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    code: Literal["MODEL_NOT_IMPLEMENTED"] = "MODEL_NOT_IMPLEMENTED"
    category: Literal["unavailable"] = "unavailable"
    message: str = "The MMKT service boundary is available; the optimizer model is not implemented."
    correlation_id: UUID
    run: RunMetadata


class HealthResponse(StrictModel):
    status: Literal["unready"] = "unready"
    ready: Literal[False] = False
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    model_status: Literal["not_implemented"] = "not_implemented"
    auth_configured: bool
    database_access: Literal[False] = False
    market_data_access: Literal[False] = False


class CapabilityManifest(StrictModel):
    api_schema_version: Literal["1.0.0"] = "1.0.0"
    service: Literal["money_market_api"] = "money_market_api"
    port: Literal[8014] = 8014
    request_validation: Literal[True] = True
    solver_enabled: Literal[False] = False
    database_access: Literal[False] = False
    market_data_access: Literal[False] = False
    model_families: tuple[str, ...] = ()
