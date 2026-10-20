"""Cross-field snapshot rules the JSON Schema cannot state (spec020 IND-001).

Mirrors snapshotIssues in src/lib/indemnificationContract.ts; the same negative cases run in both suites.
"""

import copy
import re

import pytest
from indemnification_api.validation import snapshot_issues


def mutated(snapshot, fn):
    s = copy.deepcopy(snapshot)
    fn(s)
    return s


def test_the_fixture_is_consistent(snapshot):
    assert snapshot_issues(snapshot) == []


CASES = [
    ("rho_w squared above rho_d", lambda s: s["model"].update(rho_w=0.6), r"rho_w\^2"),
    ("a duplicate loan id", lambda s: s["loans"][1].update(id="L1"), r"duplicate loan id L1"),
    ("a loan with an unknown borrower", lambda s: s["loans"][0].update(borrower_id="B9"), r"unknown borrower B9"),
    ("a loan with an unknown owner", lambda s: s["loans"][0].update(owner_id="O9"), r"unknown owner O9"),
    ("a loan with an unknown security", lambda s: s["loans"][0].update(security_id="XX"), r"unknown security XX"),
    ("collateral with an unknown security", lambda s: s["collateral"][1].update(security_id="XX"), r"unknown security XX"),
    ("pool shares that do not sum to one", lambda s: s["pool"]["owner_shares"][0].update(share=0.5), r"sum to 0\.9"),
    ("a pool share for an unknown owner", lambda s: s["pool"]["owner_shares"][0].update(owner_id="O9"), r"unknown owner O9"),
    (
        "a position override for an unknown position",
        lambda s: s["closeout_profile"]["position_overrides"].update(L9={"impact_k": 1}),
        r"unknown position L9",
    ),
    (
        "a borrower override for an unknown borrower",
        lambda s: s["closeout_profile"]["borrower_overrides"].update(B9={"addon_days": 1}),
        r"unknown borrower B9",
    ),
    (
        "an unknown pool bucket override",
        lambda s: s["closeout_profile"]["pool_bucket_overrides"].update(NOPE={"impact_k": 1}),
        r"unknown bucket NOPE",
    ),
    (
        "an unknown asset class override",
        lambda s: s["closeout_profile"]["asset_class_overrides"].update(NOPE={"impact_k": 1}),
        r"unknown asset class NOPE",
    ),
    (
        "a cost cap below the floor",
        lambda s: s["closeout_profile"]["defaults"].update(half_spread_floor_bps=20, cost_cap_bps=10),
        r"cost_cap_bps \(10\) is below",
    ),
    (
        "a PD table that decreases with worse credit",
        lambda s: s["rating_pd_table"]["pd_1y"].update(BBB=0.0001),
        r"PD for BBB(-)? is below",
    ),
]


@pytest.mark.parametrize("name, mutate, pattern", CASES, ids=[c[0] for c in CASES])
def test_reports(snapshot, name, mutate, pattern):
    issues = snapshot_issues(mutated(snapshot, mutate))
    assert any(re.search(pattern, m) for m in issues), issues


def test_valid_overrides_are_accepted(snapshot):
    s = mutated(snapshot, lambda s: None)
    s["closeout_profile"]["asset_class_overrides"]["EQUITY"] = {"impact_k": 0.7}
    s["closeout_profile"]["pool_bucket_overrides"]["TERM"] = {"mpor_pool_forced_sale_days": 8}
    assert snapshot_issues(s) == []
