# GENERATED from contracts/agent/job.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class Workflow(StrEnum):
    chart_build = 'chart.build'
    analysis_answer = 'analysis.answer'
    secfin_carry = 'secfin.carry'
    story_build = 'story.build'
    brief_draft = 'brief.draft'


class Kind(StrEnum):
    macro_backdrop = 'macro_backdrop'
    funding_conditions = 'funding_conditions'
    desk_review = 'desk_review'


class Profile(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9\\-]*$')]


class ParentJobId(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Za-z0-9\\-]{8,64}$')]


class Source(StrEnum):
    econ = 'econ'
    fred = 'fred'
    market = 'market'
    lens = 'lens'


class SeriesRef(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Source
    id: Annotated[
        str, Field(max_length=64, min_length=1, pattern='^[A-Za-z0-9_.\\-^=]+$')
    ]


class Range(StrEnum):
    field_1M = '1M'
    field_3M = '3M'
    field_6M = '6M'
    field_1Y = '1Y'
    field_2Y = '2Y'
    field_5Y = '5Y'
    MAX = 'MAX'


class Transform(StrEnum):
    none = 'none'
    index100 = 'index100'
    pct_change = 'pct_change'
    yoy = 'yoy'
    mom = 'mom'
    zscore = 'zscore'
    log = 'log'


class ChartType(StrEnum):
    line = 'line'
    area = 'area'


class Tenor(RootModel[str]):
    root: Annotated[str, Field(pattern='^[0-9]{1,2}(M|Y)$')]


class Component(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Za-z0-9_.\\-]{1,48}$')]


class ContextSnapshot(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    series: Annotated[list[SeriesRef] | None, Field(max_length=8)] = None
    range: Range | None = None
    transform: Transform | None = None
    chartType: ChartType | None = None
    asOfDate: Annotated[str | None, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')] = (
        None
    )
    tenors: Annotated[list[Tenor] | None, Field(max_length=16)] = None
    components: Annotated[list[Component] | None, Field(max_length=16)] = None
    metric: Annotated[str | None, Field(pattern='^[A-Za-z0-9_.\\-]{1,48}$')] = None


class Side(StrEnum):
    long = 'long'
    short = 'short'


class ShocksBp(RootModel[float]):
    root: Annotated[float, Field(ge=-500.0, le=500.0)]


class CarryInputs1(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    side: Side
    notional: Annotated[float, Field(gt=0.0, le=10000000000000.0)]
    start: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    end: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    tenor: Annotated[str | None, Field(pattern='^[0-9]{1,3}(D|W|M|Y)$')] = None
    benchmark: Annotated[str, Field(pattern='^[A-Za-z0-9_.\\-]{1,48}$')]
    spread_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    borrow_fee_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    use_desk_borrow_fee: bool | None = None
    rebate_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    margin_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    shocks_bps: Annotated[list[ShocksBp] | None, Field(max_length=5)] = None


class CarryInputs2(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    side: Side
    notional: Annotated[float, Field(gt=0.0, le=10000000000000.0)]
    start: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    end: Annotated[str | None, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')] = None
    tenor: Annotated[str, Field(pattern='^[0-9]{1,3}(D|W|M|Y)$')]
    benchmark: Annotated[str, Field(pattern='^[A-Za-z0-9_.\\-]{1,48}$')]
    spread_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    borrow_fee_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    use_desk_borrow_fee: bool | None = None
    rebate_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    margin_bps: Annotated[float | None, Field(ge=0.0, le=10000.0)] = None
    shocks_bps: Annotated[list[ShocksBp] | None, Field(max_length=5)] = None


class CarryInputs(RootModel[CarryInputs1 | CarryInputs2]):
    root: CarryInputs1 | CarryInputs2


class JobStatus(StrEnum):
    queued = 'queued'
    running = 'running'
    verifying = 'verifying'
    succeeded = 'succeeded'
    needs_clarification = 'needs_clarification'
    failed = 'failed'
    cancelled = 'cancelled'
    expired = 'expired'


class ErrorCode(StrEnum):
    AGENT_DISABLED = 'AGENT_DISABLED'
    AGENT_PRODUCTION_DISABLED = 'AGENT_PRODUCTION_DISABLED'
    AGENT_TRUSTED_BOUNDARY_MISSING = 'AGENT_TRUSTED_BOUNDARY_MISSING'
    AGENT_QUEUE_NOT_CONFIGURED = 'AGENT_QUEUE_NOT_CONFIGURED'
    AGENT_MODULE_DISABLED = 'AGENT_MODULE_DISABLED'
    AGENT_CONTEXT_INVALID = 'AGENT_CONTEXT_INVALID'
    AGENT_INPUTS_INVALID = 'AGENT_INPUTS_INVALID'
    AGENT_QUEUE_LIMIT = 'AGENT_QUEUE_LIMIT'
    AGENT_IDEMPOTENCY_CONFLICT = 'AGENT_IDEMPOTENCY_CONFLICT'
    WORKFLOW_UNKNOWN = 'WORKFLOW_UNKNOWN'
    WORKFLOW_NOT_READY = 'WORKFLOW_NOT_READY'
    LLM_PROFILE_UNKNOWN = 'LLM_PROFILE_UNKNOWN'
    LLM_PROFILE_NOT_ALLOWED = 'LLM_PROFILE_NOT_ALLOWED'
    LLM_PROFILE_UNAVAILABLE = 'LLM_PROFILE_UNAVAILABLE'
    DATA_CLASS_NOT_APPROVED = 'DATA_CLASS_NOT_APPROVED'
    AGENT_WORKER_UNAUTHORIZED = 'AGENT_WORKER_UNAUTHORIZED'
    LLM_BUDGET_EXCEEDED = 'LLM_BUDGET_EXCEEDED'
    LLM_PROVIDER_ERROR = 'LLM_PROVIDER_ERROR'
    LLM_OUTPUT_INVALID = 'LLM_OUTPUT_INVALID'
    JOB_TIMEOUT = 'JOB_TIMEOUT'
    WORKER_LOST = 'WORKER_LOST'
    QUEUE_TTL_EXPIRED = 'QUEUE_TTL_EXPIRED'
    DATA_UNAVAILABLE = 'DATA_UNAVAILABLE'
    UNSUPPORTED_CHART = 'UNSUPPORTED_CHART'
    UNSUPPORTED_METRIC = 'UNSUPPORTED_METRIC'
    RESULT_SCHEMA_INCOMPATIBLE = 'RESULT_SCHEMA_INCOMPATIBLE'
    VERIFICATION_ERROR = 'VERIFICATION_ERROR'


class AgentJobCreateRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['agent-job/1']
    module: Annotated[str, Field(pattern='^[A-Z][A-Z0-9]{1,7}$')]
    thread_id: Annotated[str, Field(pattern='^[0-9a-fA-F\\-]{8,64}$')]
    workflow: Workflow
    kind: Kind | None = None
    message: Annotated[str | None, Field(max_length=2000)] = None
    inputs: CarryInputs | None = None
    context: ContextSnapshot
    profile: Profile | None = None
    parent_job_id: ParentJobId | None = None
