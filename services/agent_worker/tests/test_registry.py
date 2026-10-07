"""Metric registry loader (T-004): hash, lookups, and the QuantSmith 0008 SemanticLayer."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest
from conftest import REPO_ROOT, quantsmith_root

from agent_worker.registry import (
    Registry,
    RegistryError,
    UnknownMetricError,
    build_semantic_layer,
    canonical_json,
    desk_measures,
    load_registry,
    registry_version,
)

COMMITTED = REPO_ROOT / "contracts/agent/generated/metric_registry.json"


@pytest.fixture(scope="module")
def registry() -> Registry:
    return load_registry()


def doc() -> dict:
    return json.loads(COMMITTED.read_text(encoding="utf-8"))


# --- loading and integrity --------------------------------------------------------------------


def test_loads_and_agrees_with_the_node_generated_hash(registry: Registry) -> None:
    """The Node generator and this loader canonicalize identically (a cross-language check)."""
    assert registry.version == doc()["registry_version"]
    assert registry_version(doc()) == registry.version
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", registry.version)


def test_refuses_content_that_does_not_match_its_version(tmp_path: Path) -> None:
    tampered = doc()
    tampered["metrics"][0]["decimals"] += 1
    path = tmp_path / "metric_registry.json"
    path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(RegistryError, match="registry_version"):
        load_registry(path)


def test_refuses_an_incompatible_or_malformed_registry(tmp_path: Path) -> None:
    major = doc()
    major["schema_version"] = "metric-registry/2"
    path = tmp_path / "r.json"
    path.write_text(json.dumps(major), encoding="utf-8")
    with pytest.raises(RegistryError, match="not a valid registry"):
        load_registry(path)
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(RegistryError, match="cannot read"):
        load_registry(path)
    with pytest.raises(RegistryError, match="cannot read"):
        load_registry(tmp_path / "missing.json")


def test_refuses_synonyms_shared_by_two_metrics(tmp_path: Path) -> None:
    clash = doc()
    clash["metrics"][0]["synonyms"].append(clash["metrics"][1]["synonyms"][0])
    clash["registry_version"] = registry_version(clash)
    path = tmp_path / "r.json"
    path.write_text(json.dumps(clash), encoding="utf-8")
    with pytest.raises(RegistryError, match="claimed by"):
        load_registry(path)


def test_canonical_json_matches_the_node_implementation() -> None:
    assert (
        canonical_json({"b": 1, "a": {"d": [3, {"y": 1}], "c": "é"}})
        == '{"a":{"c":"é","d":[3,{"y":1}]},"b":1}'
    )


# --- lookups (AC-009) -------------------------------------------------------------------------


def test_every_metric_declares_the_ac009_fields(registry: Registry) -> None:
    assert len(registry.metrics) > 200
    for name, m in registry.metrics.items():
        for key in ("unit", "additivity", "grain", "source", "data_class", "domains"):
            assert m[key], f"{name}.{key}"


def test_plans_may_only_name_registry_metrics(registry: Registry) -> None:
    assert registry.metric("DGS10")["unit"] == "pct"
    with pytest.raises(UnknownMetricError):
        registry.metric("NOT_A_METRIC")


def test_resolve_by_name_and_synonym(registry: Registry) -> None:
    assert registry.resolve("10-year treasury") == "DGS10"
    assert registry.resolve("  10Y  Treasury ") == "DGS10"
    assert registry.resolve("sofr") == "SOFR"
    assert registry.resolve("DGS2") == "DGS2"
    assert registry.resolve("lending revenue") == "sl_daily_revenue"
    assert registry.resolve("definitely not a metric") is None


def test_data_class_listing_and_exclusions(registry: Registry) -> None:
    assert registry.names("desk_simulated") == [
        "sl_daily_revenue",
        "sl_inventory_value",
        "sl_on_loan_notional",
        "sl_utilization",
        "sl_weighted_fee_bps",
    ]
    assert "DGS10" in registry.names("public_market_data")
    assert registry.excluded == {
        "ISM-MFG": "sim_only",
        "ISM-SVC": "sim_only",
        "PCEPILFE_MOM": "sim_only",
    }
    assert set(registry.desk_datasets) == {"sl_inventory", "sl_loans", "sl_borrow_demand"}


# --- desk measures ----------------------------------------------------------------------------


def test_desk_measures_for_plain_and_ratio_metrics(registry: Registry) -> None:
    loan = {"revenueDay": 12.5, "notional": 1_000_000.0, "rateBps": 40.0}
    assert desk_measures(registry.metric("sl_daily_revenue"), loan) == {"sl_daily_revenue": 12.5}
    assert desk_measures(registry.metric("sl_weighted_fee_bps"), loan) == {
        "sl_weighted_fee_bps__num": 40_000_000.0,
        "sl_weighted_fee_bps__den": 1_000_000.0,
    }
    inventory = {"available": 60.0, "onLoan": 30.0, "restricted": 10.0}
    assert desk_measures(registry.metric("sl_utilization"), inventory) == {
        "sl_utilization__num": 30.0,
        "sl_utilization__den": 100.0,
    }


# --- building the 0008 layer (fake module: runs in hosted CI) -------------------------------------


class FakeLayer:
    def __init__(self) -> None:
        self.defined: dict[str, dict] = {}

    def define(self, **kwargs: object) -> None:
        self.defined[str(kwargs["name"])] = kwargs


class FakeModule:
    SemanticLayer = FakeLayer


def test_builds_a_definition_for_every_metric(registry: Registry) -> None:
    layer = build_semantic_layer(registry, FakeModule)
    assert set(layer.defined) == set(registry.metrics)
    dgs10 = layer.defined["DGS10"]
    assert (dgs10["source"], dgs10["agg"], dgs10["grain"], dgs10["dimensions"]) == (
        "DGS10",
        "mean",
        "day",
        (),
    )
    rev = layer.defined["sl_daily_revenue"]
    assert (rev["source"], rev["agg"]) == ("sl_daily_revenue", "sum")
    assert set(rev["dimensions"]) == {"borrower", "collateral_type", "ticker"}
    util = layer.defined["sl_utilization"]
    assert (util["numerator"], util["denominator"]) == (
        "sl_utilization__num",
        "sl_utilization__den",
    )
    assert "source" not in util


def test_refuses_a_ratio_that_is_not_a_sum_of_sums(registry: Registry) -> None:
    bad = copy.deepcopy(registry)
    bad.metrics["sl_utilization"]["source"]["measure"]["numerator"]["fn"] = "mean"
    with pytest.raises(RegistryError, match="must be a sum"):
        build_semantic_layer(bad, FakeModule)


# --- the real 0008 layer (owner's machine) ----------------------------------------------------


@pytest.mark.needs_quantsmith
def test_builds_the_real_semantic_layer_and_computes(
    registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = quantsmith_root()
    assert root is not None
    monkeypatch.syspath_prepend(str(root / "src"))
    from quantsmith.pipelines.metrics_semantic_layer import Fact, GovernanceError

    layer = build_semantic_layer(registry)

    # Gold series: a mean over observations in one period, point-in-time.
    facts = [
        Fact(period=1, measures={"DGS10": 4.0}),
        Fact(period=1, measures={"DGS10": 4.2}),
        Fact(period=2, measures={"DGS10": 9.9}),
    ]
    assert layer.compute("DGS10", facts, period=1) == pytest.approx(4.1)

    # Desk revenue is additive, and slicing reconciles to the total (0008 AC-003).
    loans = [
        {
            "borrower": "A",
            "ticker": "X",
            "collateralType": "CASH",
            "notional": 1000.0,
            "rateBps": 30.0,
            "revenueDay": 1.0,
        },
        {
            "borrower": "B",
            "ticker": "X",
            "collateralType": "NON_CASH",
            "notional": 3000.0,
            "rateBps": 50.0,
            "revenueDay": 3.0,
        },
    ]
    rev_metric = registry.metric("sl_daily_revenue")
    fee_metric = registry.metric("sl_weighted_fee_bps")
    rows = [
        Fact(
            period=1,
            dims={"borrower": r["borrower"]},
            measures={**desk_measures(rev_metric, r), **desk_measures(fee_metric, r)},
        )
        for r in loans
    ]
    total = layer.compute("sl_daily_revenue", rows, period=1)
    by_borrower = layer.compute("sl_daily_revenue", rows, period=1, group_by="borrower")
    assert total == pytest.approx(4.0)
    assert sum(by_borrower.values()) == pytest.approx(total)

    # Weighted fee is a ratio of sums, not a mean of rates: (30*1000 + 50*3000) / 4000 = 45.
    assert layer.compute("sl_weighted_fee_bps", rows, period=1) == pytest.approx(45.0)

    # Plans naming an undefined metric are refused by the layer too.
    with pytest.raises(GovernanceError):
        layer.compute("NOT_A_METRIC", rows)
    with pytest.raises(GovernanceError):
        layer.compute("sl_daily_revenue", rows, group_by="not_a_dimension")
