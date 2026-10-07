# GENERATED from contracts/agent/verification.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel


class Verdict(StrEnum):
    VERIFIED = 'VERIFIED'
    FLAGGED = 'FLAGGED'
    DROPPED = 'DROPPED'


class Reason(StrEnum):
    value_mismatch = 'value_mismatch'
    revised_since_job = 'revised_since_job'
    unknown_series = 'unknown_series'
    unknown_dataset = 'unknown_dataset'
    DATA_CLASS_NOT_APPROVED = 'DATA_CLASS_NOT_APPROVED'
    non_db_provenance = 'non_db_provenance'
    no_observation = 'no_observation'
    dropped_input = 'dropped_input'
    unknown_formula = 'unknown_formula'
    params_mismatch = 'params_mismatch'
    assumption_mismatch = 'assumption_mismatch'
    unsupported_claim = 'unsupported_claim'
    ungrounded_text = 'ungrounded_text'
    series_not_in_registry = 'series_not_in_registry'
    extra_series = 'extra_series'
    no_data = 'no_data'


class SourceAsOf(RootModel[str]):
    root: Annotated[str, Field(pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$')]


class Claim(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Annotated[str, Field(pattern='^[A-Za-z][A-Za-z0-9_.\\-]{0,31}$')]
    verdict: Verdict
    reason: Reason | None = None
    source_value: float | None = None
    source_as_of: SourceAsOf | None = None


class Verdict1(StrEnum):
    VERIFIED = 'VERIFIED'
    DROPPED = 'DROPPED'


class Provenance(StrEnum):
    DB = 'DB'
    SIM = 'SIM'
    ERR = 'ERR'


class Flag(StrEnum):
    value_mismatch = 'value_mismatch'
    revised_since_job = 'revised_since_job'
    unknown_series = 'unknown_series'
    unknown_dataset = 'unknown_dataset'
    DATA_CLASS_NOT_APPROVED = 'DATA_CLASS_NOT_APPROVED'
    non_db_provenance = 'non_db_provenance'
    no_observation = 'no_observation'
    dropped_input = 'dropped_input'
    unknown_formula = 'unknown_formula'
    params_mismatch = 'params_mismatch'
    assumption_mismatch = 'assumption_mismatch'
    unsupported_claim = 'unsupported_claim'
    ungrounded_text = 'ungrounded_text'
    series_not_in_registry = 'series_not_in_registry'
    extra_series = 'extra_series'
    no_data = 'no_data'


class TextItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    block_index: Annotated[int, Field(ge=0)]
    rule_passed: bool
    replaced_with_template: bool
    flags: list[Flag] | None = None


class Summary(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    verified: Annotated[int, Field(ge=0)]
    flagged: Annotated[int, Field(ge=0)]
    dropped: Annotated[int, Field(ge=0)]


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


class Series(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    ref: SeriesRef
    provenance: Provenance
    observations: Annotated[int, Field(ge=0)]


class Chart(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    block_index: Annotated[int, Field(ge=0)]
    verdict: Verdict1
    reason: Reason | None = None
    series: list[Series] | None = None


class AgentVerification(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['agent-verification/1']
    job_id: Annotated[str, Field(pattern='^[A-Za-z0-9\\-]{8,64}$')]
    verified_at: AwareDatetime
    registry_version: Annotated[str | None, Field(pattern='^sha256:[0-9a-f]{64}$')] = (
        None
    )
    claims: list[Claim]
    charts: list[Chart]
    text: list[TextItem]
    summary: Summary
