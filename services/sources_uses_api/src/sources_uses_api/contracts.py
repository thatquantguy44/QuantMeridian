"""Versioned, strict Sources & Uses request contracts (spec012 SU-002).

The browser keeps configurations in its own camelCase v1 schema (`src/data/sourcesUses.ts`);
`src/lib/sourcesUsesContract.ts` maps them onto these models. Amounts are native currency units
and are never rounded (question 2). The result contract is defined with the LP (SU-004).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator

from sources_uses_api.canonical import canonical_hash

API_SCHEMA_VERSION = "1.0.0"
CONFIGURATION_SCHEMA_VERSION = "1.0.0"

# Printable ASCII keeps record ordering identical in Python and JavaScript.
RecordId = Annotated[str, StringConstraints(pattern=r"^[\x21-\x7e]{1,128}$")]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
Text = Annotated[str, StringConstraints(max_length=256)]
RequiredText = Annotated[str, StringConstraints(min_length=1, max_length=256)]
NonNegative = Annotated[FiniteFloat, Field(ge=0)]
# Where a record came from (SU-009). `sim` marks records copied from the SU-SIM showcase.
Provenance = Literal["user_input", "sim"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Record(StrictModel):
    id: RecordId
    label: RequiredText
    category: RequiredText
    amount: NonNegative
    currency: Currency
    legal_entity: Text
    asset_class: Text
    tenor_days: NonNegative | None
    priority_tier: int = Field(ge=1)
    minimum: NonNegative | None
    maximum: NonNegative | None
    lot_size: NonNegative | None
    tags: list[Annotated[str, StringConstraints(max_length=128)]]
    provenance: Provenance

    @model_validator(mode="after")
    def minimum_within_maximum(self) -> _Record:
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError(f"{self.id}: minimum cannot exceed maximum")
        return self


class SourceRecord(_Record):
    cost_bps: NonNegative
    haircut_pct: FiniteFloat = Field(ge=0, le=100)
    # Set by the user, never inferred (question 3); `unclassified` makes internalization n/a.
    internality: Literal["internal", "external", "unclassified"]


class UseRecord(_Record):
    bid_bps: NonNegative
    policy: Literal["hard", "soft"]
    shortfall_penalty_bps: NonNegative


class CompatibilityRule(StrictModel):
    source_id: RecordId
    use_id: RecordId
    status: Literal["unspecified", "allowed", "denied"]
    note: Annotated[str, StringConstraints(max_length=2000)]
    provenance: Provenance


class ConfigurationContent(StrictModel):
    """The model-relevant part of a configuration. Its name, ID and timestamps are not hashed."""

    schema_version: Literal["1.0.0"] = CONFIGURATION_SCHEMA_VERSION
    sources: list[SourceRecord]
    uses: list[UseRecord]
    compatibility: list[CompatibilityRule]

    @model_validator(mode="after")
    def consistent_references(self) -> ConfigurationContent:
        sources = _unique(self.sources, "source")
        uses = _unique(self.uses, "use")
        seen: set[tuple[str, str]] = set()
        for rule in self.compatibility:
            pair = (rule.source_id, rule.use_id)
            if rule.source_id not in sources:
                raise ValueError(f"rule references unknown source {rule.source_id}")
            if rule.use_id not in uses:
                raise ValueError(f"rule references unknown use {rule.use_id}")
            if pair in seen:
                raise ValueError(f"more than one rule for {rule.source_id} -> {rule.use_id}")
            seen.add(pair)
            source_currency = sources[rule.source_id].currency
            use_currency = uses[rule.use_id].currency
            # Question 1: a currency mismatch is a hard block; no rule may allow it.
            if rule.status == "allowed" and source_currency != use_currency:
                raise ValueError(
                    f"currency mismatch: {rule.source_id} ({source_currency}) cannot be allowed "
                    f"to fund {rule.use_id} ({use_currency})"
                )
        return self


class SolveRequest(StrictModel):
    api_schema_version: Literal["1.0.0"] = API_SCHEMA_VERSION
    currency: Currency
    configuration: ConfigurationContent
    configuration_hash: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def single_currency_and_matching_hash(self) -> SolveRequest:
        # Question 4: every record in a run is in the run currency; nothing is converted.
        other_sources = [s.id for s in self.configuration.sources if s.currency != self.currency]
        other_uses = [u.id for u in self.configuration.uses if u.currency != self.currency]
        if other_sources or other_uses:
            named = "; ".join(
                f"{kind} {', '.join(ids)}"
                for kind, ids in (("sources", other_sources), ("uses", other_uses))
                if ids
            )
            raise ValueError(
                f"a run has exactly one currency ({self.currency}); not in it: {named}"
            )
        if configuration_hash(self.configuration) != self.configuration_hash:
            raise ValueError("configuration_hash does not match the configuration")
        return self


def configuration_hash(configuration: ConfigurationContent) -> str:
    """SHA-256 of the canonical configuration; the order of records and rules does not matter."""
    payload = configuration.model_dump(mode="json")
    for key in ("sources", "uses"):
        payload[key] = sorted(payload[key], key=lambda record: record["id"])
    payload["compatibility"] = sorted(
        payload["compatibility"], key=lambda rule: (rule["source_id"], rule["use_id"])
    )
    return canonical_hash(payload)


def request_hash(request: SolveRequest) -> str:
    """The run hash: every request field, with the configuration represented by its hash."""
    return canonical_hash(request.model_dump(mode="json", exclude={"configuration"}))


def _unique(records: list[Any], kind: str) -> dict[str, Any]:
    by_id: dict[str, Any] = {}
    for record in records:
        if record.id in by_id:
            raise ValueError(f"duplicate {kind} id {record.id}")
        by_id[record.id] = record
    return by_id
