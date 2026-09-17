from __future__ import annotations

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from inventory_optimizer_api.canonical import canonical_hash
from inventory_optimizer_api.contracts import SyntheticConfig
from inventory_optimizer_api.engine_service import validation_report
from inventory_optimizer_api.synthetic import PROFILE_PRESETS, SCALE_PRESETS, generate_dataset


def test_same_complete_config_is_byte_identical() -> None:
    config = SyntheticConfig(seed=1234, profile="scarce", scale="medium")

    first = generate_dataset(config)
    second = generate_dataset(config)

    assert first.model_dump_json() == second.model_dump_json()
    assert first.request_hash == second.request_hash


def test_seed_change_changes_observations_not_schema() -> None:
    base = generate_dataset(SyntheticConfig(seed=1, profile="balanced", scale="small"))
    rerolled = generate_dataset(SyntheticConfig(seed=2, profile="balanced", scale="small"))

    assert base.request_hash != rerolled.request_hash
    assert base.summary.row_counts == rerolled.summary.row_counts
    assert set(base.request.keys()) == set(rerolled.request.keys())
    assert base.summary.total_lendable_shares != rerolled.summary.total_lendable_shares


@pytest.mark.parametrize("profile", sorted(PROFILE_PRESETS))
@pytest.mark.parametrize("scale", sorted(SCALE_PRESETS))
def test_profile_and_scale_presets_resolve_expected_shape(profile: str, scale: str) -> None:
    config = SyntheticConfig(seed=42, profile=profile, scale=scale)

    dataset = generate_dataset(config)

    expected = SCALE_PRESETS[scale]
    assert dataset.validation.valid, dataset.validation.issues
    assert dataset.summary.security_count == expected["security_count"]
    assert dataset.summary.row_counts["routes"] == (
        expected["security_count"] * expected["routes_per_security"]
    )
    assert dataset.summary.row_counts["entity_relationships"] == expected["borrower_count"]
    assert dataset.resolved_config is not None
    assert dataset.resolved_config["profile"] == profile
    assert dataset.resolved_config["scale"] == scale


@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    seed=st.integers(min_value=0, max_value=2**32 - 1),
    profile=st.sampled_from(sorted(PROFILE_PRESETS)),
    scale=st.sampled_from(["small", "medium"]),
)
def test_generated_requests_pass_domain_and_reconciliation_validation(
    seed: int, profile: str, scale: str
) -> None:
    config = SyntheticConfig(seed=seed, profile=profile, scale=scale)

    dataset = generate_dataset(config)
    report = validation_report(dataset)

    assert report.valid, report.issues
    assert dataset.request_hash == canonical_hash(dataset.request)
