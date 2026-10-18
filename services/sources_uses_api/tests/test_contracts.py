"""Sources & Uses contracts, canonical hashes and owner-decision checks (spec012 SU-002)."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from sources_uses_api.contracts import (
    ConfigurationContent,
    SolveRequest,
    configuration_hash,
    request_hash,
)

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts" / "sources_uses"
VECTORS = json.loads((CONTRACTS / "fixtures" / "canonical-vectors.json").read_text("utf-8"))
SCHEMA_PATH = CONTRACTS / "solve-request.schema.json"


def source(source_id: str = "S1", **overrides: Any) -> dict[str, Any]:
    record = {
        "id": source_id, "label": "Firm cash pool", "category": "Cash", "amount": 1400.0,
        "cost_bps": 8.0, "currency": "USD", "legal_entity": "QMS", "asset_class": "Cash",
        "tenor_days": 1.0, "priority_tier": 1, "minimum": None, "maximum": None,
        "lot_size": None, "haircut_pct": 0.0, "internality": "internal", "tags": [],
        "provenance": "user_input",
    }
    return {**record, **overrides}


def use(use_id: str = "U1", **overrides: Any) -> dict[str, Any]:
    record = {
        "id": use_id, "label": "CCP margin", "category": "Margin", "amount": 500.0,
        "bid_bps": 0.0, "currency": "USD", "legal_entity": "QMS", "asset_class": "Funding need",
        "tenor_days": 1.0, "priority_tier": 1, "minimum": None, "maximum": None,
        "lot_size": None, "policy": "hard", "shortfall_penalty_bps": 0.0, "tags": [],
        "provenance": "user_input",
    }
    return {**record, **overrides}


def rule(source_id: str = "S1", use_id: str = "U1", status: str = "allowed") -> dict[str, Any]:
    return {"source_id": source_id, "use_id": use_id, "status": status, "note": "",
            "provenance": "user_input"}


def content(**overrides: Any) -> dict[str, Any]:
    return {"schema_version": "1.0.0", "sources": [source()], "uses": [use()],
            "compatibility": [rule()], **overrides}


def request(config: dict[str, Any] | None = None, currency: str = "USD") -> dict[str, Any]:
    config = config if config is not None else content()
    return {
        "api_schema_version": "1.0.0",
        "currency": currency,
        "configuration": config,
        "configuration_hash": configuration_hash(ConfigurationContent.model_validate(config)),
    }


def hash_of(config: dict[str, Any]) -> str:
    return configuration_hash(ConfigurationContent.model_validate(config))


def errors(model: Any, payload: dict[str, Any]) -> str:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(payload)
    return str(caught.value)


class TestConfigurationHash:
    def test_empty_configuration_is_valid_and_hashable(self) -> None:
        empty = content(sources=[], uses=[], compatibility=[])
        assert len(hash_of(empty)) == 64

    def test_hash_ignores_record_and_rule_order(self) -> None:
        a = content(
            sources=[source("S1"), source("S2")],
            uses=[use("U1"), use("U2")],
            compatibility=[rule("S1", "U1"), rule("S2", "U2")],
        )
        b = content(
            sources=[source("S2"), source("S1")],
            uses=[use("U2"), use("U1")],
            compatibility=[rule("S2", "U2"), rule("S1", "U1")],
        )
        assert hash_of(a) == hash_of(b)

    def test_changing_a_source_haircut_changes_the_hash(self) -> None:
        # AC-009
        assert hash_of(content()) != hash_of(content(sources=[source(haircut_pct=2.0)]))

    def test_hash_keeps_full_precision(self) -> None:
        # Question 2: no rounding in the model or the hash.
        precise = content(sources=[source(amount=1400.0000000001)])
        assert hash_of(precise) != hash_of(content())

    def test_integer_and_float_amounts_hash_identically(self) -> None:
        assert hash_of(content(sources=[source(amount=1400)])) == hash_of(content())

    @pytest.mark.parametrize("vector", VECTORS["configurations"], ids=lambda v: v["name"])
    def test_typescript_vectors_match(self, vector: dict[str, Any]) -> None:
        assert hash_of(vector["content"]) == vector["configuration_hash"]


class TestConfigurationValidation:
    def test_rejects_duplicate_ids_within_a_record_type(self) -> None:
        config = content(sources=[source(), source()])
        assert "duplicate source id" in errors(ConfigurationContent, config)

    def test_rejects_rules_that_reference_unknown_records(self) -> None:
        message = errors(ConfigurationContent, content(compatibility=[rule("S9", "U1")]))
        assert "unknown source S9" in message

    def test_rejects_two_rules_for_the_same_pair(self) -> None:
        config = content(compatibility=[rule(), rule(status="denied")])
        message = errors(ConfigurationContent, config)
        assert "more than one rule for S1 -> U1" in message

    def test_rejects_an_allowed_rule_across_currencies(self) -> None:
        # Question 1: a currency mismatch is a hard block that no rule can override.
        config = content(uses=[use(currency="EUR")])
        assert "currency mismatch" in errors(ConfigurationContent, config)

    def test_accepts_a_denied_rule_across_currencies(self) -> None:
        config = content(uses=[use(currency="EUR")], compatibility=[rule(status="denied")])
        ConfigurationContent.model_validate(config)

    def test_accepts_a_cross_entity_pair_with_an_explicit_rule(self) -> None:
        # Question 1: legal entity is not a hard block.
        ConfigurationContent.model_validate(content(uses=[use(legal_entity="QMP")]))

    def test_rejects_minimum_above_maximum(self) -> None:
        config = content(sources=[source(minimum=10.0, maximum=5.0)])
        assert "minimum cannot exceed maximum" in errors(ConfigurationContent, config)

    @pytest.mark.parametrize(
        ("field", "value"),
        [("amount", -1.0), ("haircut_pct", 100.5), ("priority_tier", 0), ("currency", "usd"),
         ("id", "has space"), ("internality", "inferred"), ("provenance", "gold")],
    )
    def test_rejects_out_of_contract_source_fields(self, field: str, value: Any) -> None:
        errors(ConfigurationContent, content(sources=[source(**{field: value})]))

    def test_rejects_non_finite_amounts(self) -> None:
        errors(ConfigurationContent, content(uses=[use(amount=float("nan"))]))

    def test_rejects_unknown_fields_and_versions(self) -> None:
        errors(ConfigurationContent, content(sources=[source(color="red")]))
        errors(ConfigurationContent, content(schema_version="2.0.0"))


class TestSolveRequest:
    def test_accepts_a_single_currency_request(self) -> None:
        SolveRequest.model_validate(request())

    def test_rejects_a_run_spanning_more_than_one_currency_and_names_the_records(self) -> None:
        # Question 4: one currency per run, rejected before solving.
        config = content(
            sources=[source(), source("S2", currency="EUR")],
            uses=[use(), use("U2", currency="EUR")],
        )
        message = errors(SolveRequest, request(config))
        assert "sources S2" in message and "uses U2" in message

    def test_rejects_a_configuration_hash_that_does_not_match(self) -> None:
        payload = request()
        payload["configuration_hash"] = "0" * 64
        assert "configuration_hash does not match" in errors(SolveRequest, payload)

    def test_request_hash_is_stable_across_record_order(self) -> None:
        config = content(sources=[source(), source("S2")])
        reordered = copy.deepcopy(config)
        reordered["sources"].reverse()
        first = request_hash(SolveRequest.model_validate(request(config)))
        second = request_hash(SolveRequest.model_validate(request(reordered)))
        assert first == second

    def test_request_hash_changes_with_the_configuration(self) -> None:
        base = request_hash(SolveRequest.model_validate(request()))
        changed = request(content(uses=[use(amount=501.0)]))
        assert request_hash(SolveRequest.model_validate(changed)) != base


def test_published_json_schema_is_current() -> None:
    """The committed schema is what the TypeScript parity test reads.

    Regenerate after an intended contract change with:
        SXU_UPDATE_CONTRACT_SCHEMA=1 pytest tests/test_contracts.py
    """
    schema = json.dumps(SolveRequest.model_json_schema(), indent=2, sort_keys=True) + "\n"
    if os.environ.get("SXU_UPDATE_CONTRACT_SCHEMA") == "1":
        SCHEMA_PATH.write_text(schema, encoding="utf-8")
    assert SCHEMA_PATH.read_text(encoding="utf-8") == schema


class TestReviewFindings:
    def test_q4_names_off_currency_records_even_with_a_cross_currency_allowed_rule(self) -> None:
        config = content(
            sources=[source(), source("S2", currency="EUR")],
            uses=[use(), use("U2", currency="EUR")],
            compatibility=[rule(), rule("S1", "U2")],
        )
        payload = {**request(content()), "configuration": config}
        message = errors(SolveRequest, payload)
        assert "sources S2" in message and "uses U2" in message

    @pytest.mark.parametrize(
        ("field", "value"),
        [("amount", "1400"), ("amount", True), ("priority_tier", "2"), ("priority_tier", True)],
    )
    def test_rejects_values_that_would_need_type_coercion(self, field: str, value: Any) -> None:
        # A coerced value would hash differently from the client's raw payload.
        errors(ConfigurationContent, content(sources=[source(**{field: value})]))

    def test_version_fields_are_required(self) -> None:
        payload = request()
        del payload["api_schema_version"]
        errors(SolveRequest, payload)
        config = content()
        del config["schema_version"]
        errors(ConfigurationContent, config)

    def test_changing_a_source_haircut_changes_the_run_hash(self) -> None:
        # AC-009 is stated for the run hash.
        base = request_hash(SolveRequest.model_validate(request()))
        haircut = request(content(sources=[source(haircut_pct=2.0)]))
        assert request_hash(SolveRequest.model_validate(haircut)) != base

    def test_rejects_blank_labels(self) -> None:
        errors(ConfigurationContent, content(sources=[source(label="   ")]))

    def test_rejects_priority_tiers_beyond_exact_javascript_integers(self) -> None:
        errors(ConfigurationContent, content(uses=[use(priority_tier=9_007_199_254_740_993)]))
