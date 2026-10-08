# GENERATED from contracts/agent/agent-workflows.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, constr


class Limits(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    max_queued_per_requester: Annotated[int, Field(ge=1, le=100)]
    max_running_per_requester: Annotated[int, Field(ge=1, le=10)]
    queue_ttl_hours: Annotated[int, Field(ge=1, le=168)]
    max_attempts: Annotated[int, Field(ge=1, le=5)]
    lease_seconds: Annotated[int, Field(ge=10, le=600)]
    heartbeat_seconds: Annotated[int, Field(ge=2, le=120)]
    max_context_bytes: Annotated[int, Field(ge=0, le=16384)]
    max_message_chars: Annotated[int, Field(ge=1, le=2000)]


class Llm(StrEnum):
    none = 'none'
    optional = 'optional'
    required = 'required'


class Use(StrEnum):
    copilot = 'copilot'
    interpreter = 'interpreter'
    narrator = 'narrator'
    drafter = 'drafter'


class DataClass(StrEnum):
    public_market_data = 'public_market_data'
    module_context = 'module_context'
    desk_simulated = 'desk_simulated'


class RequiresCapability(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class NonAdditiveOrMultiPeriodItem(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class DeskMetricItem(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class PlanCapabilities(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    non_additive_or_multi_period: list[NonAdditiveOrMultiPeriodItem] | None = None
    desk_metric: list[DeskMetricItem] | None = None


class MacroBackdrop(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    requires_capabilities: list[RequiresCapability]


class FundingConditions(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    requires_capabilities: list[RequiresCapability]


class DeskReview(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    requires_capabilities: list[RequiresCapability]


class Kinds(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    macro_backdrop: MacroBackdrop | None = None
    funding_conditions: FundingConditions | None = None
    desk_review: DeskReview | None = None


class Workflow(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    version: Annotated[str, Field(pattern='^[0-9]+\\.[0-9]+\\.[0-9]+$')]
    llm: Llm
    uses: list[Use]
    timeout_seconds: Annotated[int, Field(ge=5, le=900)]
    data_classes: Annotated[list[DataClass], Field(min_length=1)]
    enabled: bool
    requires_capabilities: list[RequiresCapability]
    plan_capabilities: PlanCapabilities | None = None
    kinds: Kinds | None = None


class Workflow1(StrEnum):
    chart_build = 'chart.build'
    analysis_answer = 'analysis.answer'
    secfin_carry = 'secfin.carry'
    story_build = 'story.build'
    brief_draft = 'brief.draft'
    economics_explain = 'economics.explain'
    economics_transmission = 'economics.transmission'
    economics_scenario = 'economics.scenario'


class DefaultProfile(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9\\-]*$')]


class Domain(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class DeskDataset(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class ContextField(StrEnum):
    series = 'series'
    range = 'range'
    transform = 'transform'
    chartType = 'chartType'
    asOfDate = 'asOfDate'
    tenors = 'tenors'
    components = 'components'
    metric = 'metric'


class Module(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    enabled: bool
    workflows: list[Workflow1]
    default_profile: DefaultProfile | None
    profile_override: bool
    domains: list[Domain]
    desk_datasets: list[DeskDataset] | None = None
    context_fields: list[ContextField]


class Workflows(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    chart_build: Annotated[Workflow, Field(alias='chart.build')]
    analysis_answer: Annotated[Workflow, Field(alias='analysis.answer')]
    secfin_carry: Annotated[Workflow, Field(alias='secfin.carry')]
    story_build: Annotated[Workflow, Field(alias='story.build')]
    brief_draft: Annotated[Workflow, Field(alias='brief.draft')]
    economics_explain: Annotated[Workflow, Field(alias='economics.explain')]
    economics_transmission: Annotated[Workflow, Field(alias='economics.transmission')]
    economics_scenario: Annotated[Workflow, Field(alias='economics.scenario')]


class AgentWorkflowsConfig(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['agent-workflows/1']
    limits: Limits
    workflows: Workflows
    modules: dict[constr(pattern=r'^[A-Z][A-Z0-9]{1,7}$'), Module]
