"""Capability manifest parity (spec013 IBAL-002/003, AC-002).

`capability-manifest.json` is the single source for which input features and output sections
the pinned engine supports. `/v1/capabilities` must report exactly what the manifest says, the
advertised limits must be the limits the service actually enforces, and every input feature the
manifest disables must be rejected at upload -- otherwise the UI could gate on one answer while
the service applies another.
"""

from __future__ import annotations

import pytest
from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api import upload
from inventory_optimizer_api.capabilities import capability_payload, manifest
from inventory_optimizer_api.field_registry import MAX_UPLOAD_BYTES, ROW_LIMITS
from inventory_optimizer_api.templates import json_template


def _starter_request() -> OptimizationRequest:
    return OptimizationRequest.model_validate_json(json_template())


def test_capabilities_report_manifest_features_and_sections() -> None:
    payload = capability_payload()
    expected = manifest()

    assert payload["input_features"] == expected["input_features"]
    assert payload["output_sections"] == expected["output_sections"]


def test_advertised_limits_are_the_enforced_limits() -> None:
    limits = capability_payload()["limits"]

    assert limits["upload_bytes"] == MAX_UPLOAD_BYTES == upload.MAX_UPLOAD_BYTES
    assert limits["inventory_rows"] == ROW_LIMITS["inventory"]
    assert limits["route_rows"] == ROW_LIMITS["routes"]
    assert limits["demand_rows"] == ROW_LIMITS["demand"]
    assert limits["optional_rows"] <= min(
        ROW_LIMITS["counterparty_limits"],
        ROW_LIMITS["utilization_policies"],
        ROW_LIMITS["entity_relationships"],
    )


def test_every_disabled_input_feature_has_an_upload_gate() -> None:
    """A feature the manifest disables but upload does not detect would reach the engine."""
    disabled = {name for name, enabled in manifest()["input_features"].items() if not enabled}

    assert disabled <= set(upload._GATED_INPUT_FEATURES)


@pytest.mark.parametrize(
    ("feature", "update"),
    [
        ("multi_period", {"planning_periods": ("2026-09-15",)}),
        ("known_future_events", {"known_future_events": ("event",)}),
        ("expected_economics", {"expected_economics": ("row",)}),
        ("dynamic_buffers", {"dynamic_buffers": ("row",)}),
    ],
)
def test_disabled_feature_is_rejected_and_enabled_feature_is_admitted(
    feature: str, update: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    # model_copy skips validation, so a placeholder value is enough to mark the feature present;
    # the gate only asks whether the request carries it.
    request = _starter_request().model_copy(update=update)
    code = upload._GATED_INPUT_FEATURES[feature][1]
    assert upload._unsupported_feature_issues(_starter_request()) == ()

    assert [issue.code for issue in upload._unsupported_feature_issues(request)] == [code]

    enabled = manifest()
    enabled["input_features"] = {**enabled["input_features"], feature: True}
    monkeypatch.setattr(upload, "manifest", lambda: enabled)
    assert upload._unsupported_feature_issues(request) == ()


def test_fee_tiers_are_rejected_while_disabled() -> None:
    request = _starter_request()
    demand = (request.demand[0].model_copy(update={"candidate_fee_rates": (0.01, 0.02)}),)
    request = request.model_copy(update={"demand": demand + request.demand[1:]})

    codes = [issue.code for issue in upload._unsupported_feature_issues(request)]

    assert codes == ["CAPABILITY_FEE_TIERS_DISABLED"]
