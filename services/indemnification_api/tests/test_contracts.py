"""Python half of the INDEM contract parity check (spec020 IND-T03).

The TypeScript tests (src/lib/indemnificationContract.test.ts) check the same schemas, fixtures and
hash vectors, so a hash or schema change that only one language notices fails the other's suite.
"""

import copy

from conftest import load
from indemnification_api.contracts import profile_hash, snapshot_hash

VECTORS = load("fixtures/hash-vectors.json")


def errors(validator, value):
    return [f"{'/'.join(map(str, e.path))}: {e.message}" for e in validator.iter_errors(value)]


def test_fixtures_validate(validator_for, snapshot):
    assert errors(validator_for("snapshot-1.0.schema.json"), snapshot) == []
    result = load("fixtures/result.example.json")
    assert errors(validator_for("result-1.0.schema.json"), result) == []
    assert errors(validator_for("model-card-1.0.schema.json"), result["model_card"]) == []
    assert errors(validator_for("closeout-profile-1.0.schema.json"), load("closeout-profile.default.json")) == []


def test_snapshot_hash_matches_the_shared_vector(snapshot):
    assert snapshot_hash(snapshot) == VECTORS["snapshot"]["hash"] == snapshot["snapshot_hash"]


def test_snapshot_hash_ignores_record_order_but_not_values(snapshot):
    shuffled = copy.deepcopy(snapshot)
    for name in ("loans", "borrowers", "securities", "owners", "collateral"):
        shuffled[name].reverse()
    shuffled["pool"]["positions"].reverse()
    shuffled["pool"]["owner_shares"].reverse()
    assert snapshot_hash(shuffled) == snapshot["snapshot_hash"]
    changed = copy.deepcopy(snapshot)
    changed["loans"][0]["quantity"] += 1
    assert snapshot_hash(changed) != snapshot["snapshot_hash"]


def test_profile_hashes_match_the_shared_vectors(snapshot):
    assert profile_hash(load("closeout-profile.default.json")) == VECTORS["profiles"][0]["hash"]
    assert profile_hash(snapshot["closeout_profile"]) == VECTORS["profiles"][1]["hash"]


def test_canonical_numbers_match_the_spec012_vectors():
    from indemnification_api.canonical import canonical_json

    vectors = load("../sources_uses/fixtures/canonical-vectors.json")
    for case in vectors["numbers"]:
        assert canonical_json(case["value"]) == case["canonical"], case
