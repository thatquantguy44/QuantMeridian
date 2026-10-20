import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts" / "indemnification"
SCHEMA_FILES = [
    "closeout-profile-1.0.schema.json",
    "rating-pd-table-1.0.schema.json",
    "model-card-1.0.schema.json",
    "snapshot-1.0.schema.json",
    "result-1.0.schema.json",
]


def load(relative: str):
    return json.loads((CONTRACTS / relative).read_text("utf-8"))


@pytest.fixture(scope="session")
def schemas():
    return {name: load(name) for name in SCHEMA_FILES}


@pytest.fixture(scope="session")
def validator_for(schemas):
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )

    def build(name: str) -> Draft202012Validator:
        return Draft202012Validator(schemas[name], registry=registry)

    return build


@pytest.fixture(scope="session")
def snapshot():
    return load("fixtures/snapshot.example.json")


def mini_snapshot(base, *, loans, collateral=None, securities=None, borrowers=None, profile=None):
    """A small controlled book built from the fixture: one owner, hand-set loans and collateral."""
    import copy

    s = copy.deepcopy(base)
    s["securities"] = securities or [
        {"id": "EQ", "label": "Test equity", "asset_class": "EQUITY", "liquidity_class": "liquid",
         "hard_to_borrow": False, "currency": "USD", "price": 100.0, "adv_units": 1_000_000.0,
         "daily_vol": 0.02, "equity_beta": 0.0, "rate_duration": 0.0, "spread_duration": 0.0},
        {"id": "GV", "label": "Test government bond", "asset_class": "GOVT", "liquidity_class": "liquid",
         "hard_to_borrow": False, "currency": "USD", "price": 100.0, "adv_units": 5_000_000.0,
         "daily_vol": 0.003, "equity_beta": 0.0, "rate_duration": 0.0, "spread_duration": 0.0},
    ]
    s["borrowers"] = borrowers or [
        {"id": "B1", "name": "Alderwood Capital", "rating": "A", "spread_bps": None, "recovery": None,
         "credit_provenance": "sim"}
    ]
    s["owners"] = [{"id": "O1", "name": "Summitline Index Partners"}]
    s["loans"] = loans
    s["collateral"] = collateral or []
    s["pool"] = {"positions": [], "owner_shares": [], "rescaled": False, "source_total": None, "note": None}
    if profile:
        s["closeout_profile"] = profile
    else:
        s["closeout_profile"]["borrower_overrides"] = {}
        s["closeout_profile"]["position_overrides"] = {}
        s["closeout_profile"]["asset_class_overrides"] = {}
    return s


def loan(loan_id="L1", *, borrower="B1", security="EQ", quantity=1000.0, margin=102.0, cash=True,
         term="open", maturity=None):
    return {"id": loan_id, "borrower_id": borrower, "owner_id": "O1", "security_id": security,
            "quantity": quantity, "rate_bps": 30.0, "collateral_type": "CASH" if cash else "NON_CASH",
            "margin_pct": margin, "term": term, "maturity_days": maturity, "recallable": False,
            "provenance": "sim"}


def cash_holding(holding_id="C1", *, borrower="B1", amount=1.0):
    return {"id": holding_id, "borrower_id": borrower, "kind": "CASH", "security_id": None,
            "quantity": None, "cash_amount": amount, "provenance": "sim"}


def security_holding(holding_id="C2", *, borrower="B1", security="GV", quantity=1000.0):
    return {"id": holding_id, "borrower_id": borrower, "kind": "SECURITY", "security_id": security,
            "quantity": quantity, "cash_amount": None, "provenance": "sim"}
