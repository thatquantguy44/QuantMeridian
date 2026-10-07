# GENERATED from contracts/agent/formula-vectors.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Formula(StrEnum):
    days_act = 'days_act'
    leg_cost = 'leg_cost'
    net_financing_cost = 'net_financing_cost'
    funding_rate_bps = 'funding_rate_bps'
    shocked_net_cost = 'shocked_net_cost'
    pct_to_bps = 'pct_to_bps'
    spread_bps = 'spread_bps'
    share = 'share'
    aggregate = 'aggregate'


class Vector(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: Annotated[str, Field(min_length=1)]
    inputs: dict[str, Any]
    params: dict[str, Any] | None = None
    expected: float | dict[str, Any] | None
    decimals: Annotated[int, Field(ge=0, le=8)]
    note: str | None = None


class FormulaVectors(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['formula-vectors/1']
    formula: Formula
    description: str | None = None
    vectors: Annotated[list[Vector], Field(min_length=1)]
