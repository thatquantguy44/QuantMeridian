# GENERATED from contracts/agent/metric-registry.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class Reason(StrEnum):
    sim_only = 'sim_only'
    lin_unit_unreviewed = 'lin_unit_unreviewed'


class ExcludedItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: str
    reason: Reason


class DataClass(StrEnum):
    public_market_data = 'public_market_data'
    desk_simulated = 'desk_simulated'


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


class ChartUnit(StrEnum):
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


class UnitReview(StrEnum):
    catalog = 'catalog'
    reviewed = 'reviewed'


class Grain(StrEnum):
    day = 'day'
    week = 'week'
    month = 'month'
    quarter = 'quarter'


class Agg(StrEnum):
    sum = 'sum'
    mean = 'mean'
    count = 'count'
    last = 'last'
    ratio = 'ratio'


class Additivity(StrEnum):
    additive = 'additive'
    semi_additive = 'semi_additive'
    non_additive = 'non_additive'
    ratio = 'ratio'


class Dimension(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class Domain(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]


class Synonym(RootModel[str]):
    root: Annotated[str, Field(max_length=60, min_length=1)]


class Source(StrEnum):
    econ = 'econ'
    fred = 'fred'
    market = 'market'


class GoldSource(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['gold_series']
    source: Source
    id: Annotated[str, Field(pattern='^[A-Za-z0-9_.\\-^=]{1,64}$')]
    units: Literal['lin']


class Fn(StrEnum):
    sum = 'sum'
    mean = 'mean'
    count = 'count'


class TermItem(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_]*$')]


class Term(RootModel[list[TermItem]]):
    root: Annotated[list[TermItem], Field(min_length=1)]


class DeskExpr(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    fn: Fn
    terms: Annotated[list[Term], Field(min_length=1)]


class Fields(StrEnum):
    string = 'string'
    number = 'number'
    boolean = 'boolean'


class DeskDataset(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]
    module: Annotated[str, Field(pattern='^[A-Z][A-Z0-9]{1,7}$')]
    getter: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9]*$')]
    fields: Annotated[dict[str, Fields], Field(min_length=1)]
    dimensions: dict[str, str]


class Measure(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    numerator: DeskExpr
    denominator: DeskExpr


class DeskSource(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['desk_dataset']
    dataset: Annotated[str, Field(pattern='^[a-z][a-z0-9_]*$')]
    measure: DeskExpr | Measure


class Metric(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: Annotated[str, Field(pattern='^[A-Za-z0-9_.\\-]{1,64}$')]
    label: Annotated[str, Field(max_length=120, min_length=1)]
    short: Annotated[str | None, Field(max_length=40)] = None
    source: GoldSource | DeskSource
    data_class: DataClass
    unit: Unit
    display_unit: Annotated[str | None, Field(max_length=24)] = None
    chart_unit: ChartUnit | None = None
    chart_display_unit: Annotated[str | None, Field(max_length=24)] = None
    unit_review: UnitReview | None = None
    decimals: Annotated[int, Field(ge=0, le=8)]
    grain: Grain
    agg: Agg
    snapshot: bool | None = None
    additivity: Additivity
    additivity_rationale: Annotated[str | None, Field(max_length=300)] = None
    dimensions: list[Dimension]
    domains: Annotated[list[Domain], Field(min_length=1)]
    synonyms: list[Synonym]
    owner: Annotated[str, Field(max_length=120)]


class MetricRegistry(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['metric-registry/1']
    registry_version: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$')]
    metrics: Annotated[list[Metric], Field(min_length=1)]
    excluded: list[ExcludedItem]
    desk_datasets: list[DeskDataset]
