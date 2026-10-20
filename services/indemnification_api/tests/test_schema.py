"""Runtime validation: schema plus cross-field rules, before any simulation (AC-013, IND-001)."""

import copy

import pytest

from indemnification_api.schema import SnapshotRejected, require_valid_snapshot, validate_snapshot


def mutated(snapshot, fn):
    s = copy.deepcopy(snapshot)
    fn(s)
    return s


def test_the_fixture_is_valid(snapshot):
    assert validate_snapshot(snapshot) == []
    require_valid_snapshot(snapshot)


@pytest.mark.parametrize(
    "name, mutate",
    [
        (
            "a close-out period of zero",
            lambda s: s["closeout_profile"]["defaults"].update(mpor_liquid_days=0),
        ),
        (
            "a close-out period above 60",
            lambda s: s["closeout_profile"]["defaults"].update(mpor_other_days=61),
        ),
        (
            "an impact exponent of zero",
            lambda s: s["closeout_profile"]["defaults"].update(impact_alpha=0),
        ),
        (
            "an unknown profile setting",
            lambda s: s["closeout_profile"]["defaults"].update(impact_kappa=1),
        ),
        (
            "an unknown override setting",
            lambda s: s["closeout_profile"]["borrower_overrides"].update(B1={"nope": 1}),
        ),
        ("fewer than 1,000 paths", lambda s: s["run"].update(paths=999)),
        ("a horizon over five years", lambda s: s["run"].update(horizon_days=1261)),
        ("an unknown top-level field", lambda s: s.update(extra=1)),
        ("a term loan with no maturity", lambda s: s["loans"][1].update(maturity_days=None)),
        ("a malformed hash", lambda s: s.update(snapshot_hash="abc")),
        (
            "a probability of one in the PD table",
            lambda s: s["rating_pd_table"]["pd_1y"].update(CCC=1),
        ),
    ],
)
def test_schema_violations_are_rejected_with_a_path(snapshot, name, mutate):
    issues = validate_snapshot(mutated(snapshot, mutate))
    assert issues, name
    assert all(isinstance(m, str) and m for m in issues)


def test_cross_field_violations_are_rejected(snapshot):
    issues = validate_snapshot(mutated(snapshot, lambda s: s["model"].update(rho_w=0.6)))
    assert any("rho_w^2" in m for m in issues)


def test_a_wrong_hash_is_rejected(snapshot):
    issues = validate_snapshot(mutated(snapshot, lambda s: s["loans"][0].update(quantity=1)))
    assert any("snapshot_hash does not match" in m for m in issues)


def test_require_valid_snapshot_raises_with_all_issues(snapshot):
    bad = mutated(snapshot, lambda s: (s["run"].update(paths=5), s["run"].update(horizon_days=5)))
    with pytest.raises(SnapshotRejected) as error:
        require_valid_snapshot(bad)
    assert len(error.value.issues) == 2


def test_cross_field_rules_run_only_once_the_schema_passes(snapshot):
    bad = mutated(snapshot, lambda s: (s["model"].update(rho_w=0.6), s["run"].update(paths=5)))
    issues = validate_snapshot(bad)
    assert len(issues) == 1 and "paths" in issues[0]
