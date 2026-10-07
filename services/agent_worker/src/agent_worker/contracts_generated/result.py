# GENERATED from contracts/agent/result.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel
from typing_extensions import TypeAliasType


class Id(StrEnum):
    chart_build = 'chart.build'
    analysis_answer = 'analysis.answer'
    secfin_carry = 'secfin.carry'
    story_build = 'story.build'
    brief_draft = 'brief.draft'


class Kind(StrEnum):
    macro_backdrop = 'macro_backdrop'
    funding_conditions = 'funding_conditions'
    desk_review = 'desk_review'


class Workflow(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Id
    version: Annotated[str, Field(pattern='^[0-9]+\\.[0-9]+\\.[0-9]+$')]
    kind: Kind | None


class Outcome(StrEnum):
    answered = 'answered'
    clarification = 'clarification'
    unsupported_chart = 'unsupported_chart'
    unsupported_metric = 'unsupported_metric'
    data_unavailable = 'data_unavailable'


class Usage(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    input_tokens: Annotated[int, Field(ge=0)]
    output_tokens: Annotated[int, Field(ge=0)]


TimingsMsAdditionalProperty = TypeAliasType(
    "TimingsMsAdditionalProperty", Annotated[int, Field(ge=0)]
)


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


class ClaimRef(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]


class Unit(StrEnum):
    pct = 'pct'
    pp = 'pp'
    bps = 'bps'
    index = 'index'
    currency = 'currency'
    count = 'count'
    ratio = 'ratio'
    hours = 'hours'
    days = 'days'
    shares = 'shares'


class LevelClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['level']
    provenance: Literal['DB']
    series: SeriesRef
    date: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    value: float
    unit: Unit
    decimals: Annotated[int, Field(ge=0, le=8)]


class Basis(StrEnum):
    abs = 'abs'
    bps = 'bps'
    pct = 'pct'


class DeltaClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['delta']
    provenance: Literal['DB']
    series: SeriesRef
    from_: Annotated[str, Field(alias='from', pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    to: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    basis: Basis
    value: float
    unit: Unit
    decimals: Annotated[int, Field(ge=0, le=8)]


class Transform(StrEnum):
    yoy = 'yoy'
    mom = 'mom'
    pct_change = 'pct_change'
    log = 'log'


class TransformPointClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['transform_point']
    provenance: Literal['DB']
    series: SeriesRef
    date: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    transform: Transform
    value: float
    unit: Unit
    decimals: Annotated[int, Field(ge=0, le=8)]


class Stat(StrEnum):
    min = 'min'
    max = 'max'
    mean = 'mean'
    first = 'first'
    last = 'last'
    count = 'count'


class At(RootModel[str]):
    root: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]


class WindowStatClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['window_stat']
    provenance: Literal['DB']
    series: SeriesRef
    from_: Annotated[str, Field(alias='from', pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    to: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    stat: Stat
    at: At | None = None
    value: float
    unit: Unit
    decimals: Annotated[int, Field(ge=0, le=8)]


class LatestDateClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['latest_date']
    provenance: Literal['DB']
    series: SeriesRef
    date: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]


class AggregateClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['aggregate']
    provenance: Literal['SIM']
    dataset: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]
    metric: Annotated[str, Field(pattern='^[A-Za-z0-9_.\\-]{1,48}$')]
    filters: dict[str, str | float] | None = None
    group: dict[str, str | float] | None = None
    value: float
    unit: Unit
    decimals: Annotated[int, Field(ge=0, le=8)]


class AssumptionClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['assumption']
    provenance: Literal['USER']
    name: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]
    value: float | str | bool
    unit: Unit | None = None


class Formula(StrEnum):
    days_act = 'days_act'
    leg_cost = 'leg_cost'
    net_financing_cost = 'net_financing_cost'
    funding_rate_bps = 'funding_rate_bps'
    shocked_net_cost = 'shocked_net_cost'
    pct_to_bps = 'pct_to_bps'
    spread_bps = 'spread_bps'
    share = 'share'


class Input(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]


class CalculatedClaim(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    kind: Literal['calculated']
    formula: Formula
    inputs: list[Input]
    params: dict[str, Any] | None = None
    value: float
    unit: Unit
    decimals: Annotated[int | None, Field(ge=0, le=8)] = None


class Claim(
    RootModel[
        LevelClaim
        | DeltaClaim
        | TransformPointClaim
        | WindowStatClaim
        | LatestDateClaim
        | AggregateClaim
        | AssumptionClaim
        | CalculatedClaim
    ]
):
    root: (
        LevelClaim
        | DeltaClaim
        | TransformPointClaim
        | WindowStatClaim
        | LatestDateClaim
        | AggregateClaim
        | AssumptionClaim
        | CalculatedClaim
    )


class Range(StrEnum):
    field_1M = '1M'
    field_3M = '3M'
    field_6M = '6M'
    field_1Y = '1Y'
    field_2Y = '2Y'
    field_5Y = '5Y'
    MAX = 'MAX'


class Transform1(StrEnum):
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


class Series(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    ref: SeriesRef
    chartType: ChartType


class Chart(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    range: Range
    transform: Transform1
    series: Annotated[list[Series], Field(max_length=8, min_length=1)]


class ChartBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['chart']
    title: Annotated[str | None, Field(max_length=200)] = None
    chart: Chart


class Grain(StrEnum):
    day = 'day'
    week = 'week'
    month = 'month'
    quarter = 'quarter'
    year = 'year'


class Item(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    metric: str
    label: str
    window: str | None = None
    grain: Grain | None = None
    transform: Transform1 | None = None


class Note(RootModel[str]):
    root: Annotated[str, Field(max_length=300)]


class PlanEchoBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['plan_echo']
    items: list[Item]
    notes: list[Note] | None = None


class AuthoredBy(StrEnum):
    template = 'template'
    llm = 'llm'


class Claim1(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]


class Item1(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    kind: Annotated[str, Field(max_length=40)]
    text_template: Annotated[str, Field(max_length=2000)]
    authored_by: AuthoredBy
    template_fallback: Annotated[str | None, Field(max_length=2000)] = None
    claims: list[Claim1] | None = None


class InsightsBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['insights']
    items: list[Item1]


class NarrativeBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['narrative']
    heading: Annotated[str | None, Field(max_length=120)] = None
    text_template: Annotated[str, Field(max_length=2000)]
    authored_by: AuthoredBy
    template_fallback: Annotated[str | None, Field(max_length=2000)] = None


class Column(RootModel[str]):
    root: Annotated[str, Field(max_length=80)]


class Row1(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    text: Annotated[str, Field(max_length=200)]


class Row2(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    claim: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]


class Row(RootModel[list[Row1 | Row2]]):
    root: Annotated[list[Row1 | Row2], Field(max_length=12)]


class TableBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['table']
    title: Annotated[str | None, Field(max_length=200)] = None
    columns: Annotated[list[Column], Field(max_length=12, min_length=1)]
    rows: Annotated[list[Row], Field(max_length=200)]


class Candidate(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: str
    label: str | None = None


class ClarificationBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['clarification']
    reason: Annotated[str, Field(max_length=80)]
    question: Annotated[str | None, Field(max_length=300)] = None
    candidates: Annotated[list[Candidate] | None, Field(max_length=20)] = None


class Item2(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: str
    source: str
    text: Annotated[str, Field(max_length=1000)]


class CaveatsBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['caveats']
    items: list[Item2]


class NoticeBlock(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    type: Literal['notice']
    code: Annotated[str, Field(pattern='^[A-Z][A-Z0-9_]*$')]
    text_template: Annotated[str, Field(max_length=1000)]


class Block(
    RootModel[
        ChartBlock
        | PlanEchoBlock
        | InsightsBlock
        | NarrativeBlock
        | TableBlock
        | ClarificationBlock
        | CaveatsBlock
        | NoticeBlock
    ]
):
    root: (
        ChartBlock
        | PlanEchoBlock
        | InsightsBlock
        | NarrativeBlock
        | TableBlock
        | ClarificationBlock
        | CaveatsBlock
        | NoticeBlock
    )


class Mode(StrEnum):
    path = 'path'
    installed = 'installed'


class Quantsmith(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    mode: Mode
    code_digest: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$')]
    assets_digest: Annotated[str, Field(pattern='^(sha256:[0-9a-f]{64}|absent)$')]


class InterpreterMode(StrEnum):
    form = 'form'
    keyword = 'keyword'
    llm = 'llm'


class Use(StrEnum):
    copilot = 'copilot'
    interpreter = 'interpreter'
    narrator = 'narrator'
    drafter = 'drafter'


class LlmItem(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    profile: str
    provider: str | None = None
    model: str
    use: Use
    input_tokens: Annotated[int | None, Field(ge=0)] = None
    output_tokens: Annotated[int | None, Field(ge=0)] = None


class Prompt(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: str
    version: str
    sha256: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$')]


class PlansSha256Item(RootModel[str]):
    root: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$')]


class Provenance(StrEnum):
    DB = 'DB'
    SIM = 'SIM'


class Datum(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    series: SeriesRef | None = None
    dataset: str | None = None
    as_of: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]
    rows: Annotated[int, Field(ge=0)]
    provenance: Provenance


class Pack(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    id: str
    kind: str
    review_status: str


class Disclosure(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    quantsmith: Quantsmith
    registry_version: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$')]
    interpreter_mode: InterpreterMode
    llm: list[LlmItem]
    prompts: list[Prompt]
    plans_sha256: list[PlansSha256Item]
    data: list[Datum]
    content_hash: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$')]
    packs: list[Pack] | None = None


class AgentResult(BaseModel):
    model_config = ConfigDict(
        extra='allow',
    )
    schema_version: Literal['agent-result/1']
    job_id: Annotated[str, Field(pattern='^[A-Za-z0-9\\-]{8,64}$')]
    workflow: Workflow
    outcome: Outcome
    blocks: Annotated[list[Block], Field(max_length=60)]
    claims: Annotated[list[Claim], Field(max_length=2000)]
    disclosure: Disclosure
    usage: Usage
    timings_ms: dict[str, TimingsMsAdditionalProperty] | None = None
