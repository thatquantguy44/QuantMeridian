"""Request/result contract parity with the TypeScript client (spec013 IBAL-003).

`contracts/ibal/run-response.shape.json` records the field structure of a `/v1/runs` response:
every object's keys, nested to the leaves, with `null` for a scalar, `"*"` for an open-ended map,
and a one-element list for an array. It is derived from the pinned engine's `OptimizationResult`
schema, so fields that happen to be empty in one solve are still listed. The frontend's
`src/lib/inventoryOptimizer.contract.test.ts` checks the TypeScript types against the same file,
so a field added or removed on either side fails a test instead of silently going unrendered.

After a reviewed engine pin bump changes the result, regenerate the file with:

    IBAL_UPDATE_CONTRACT_SHAPE=1 .venv/bin/pytest tests/test_ts_contract_shape.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from conftest import auth_headers
from fastapi.testclient import TestClient
from inventory_optimizer.domain.results import OptimizationResult

from inventory_optimizer_api.contracts import RunResponse

SHAPE_PATH = Path(__file__).resolve().parents[3] / "contracts" / "ibal" / "run-response.shape.json"
OPEN_MAP = "*"


def _schema_shape(node: dict[str, Any], defs: dict[str, Any], seen: tuple[str, ...] = ()) -> Any:
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        return OPEN_MAP if name in seen else _schema_shape(defs[name], defs, (*seen, name))
    for key in ("anyOf", "oneOf"):
        if key in node:
            options = [option for option in node[key] if option.get("type") != "null"]
            # A union of several non-null forms has no single field structure to pin.
            return _schema_shape(options[0], defs, seen) if len(options) == 1 else OPEN_MAP
    kind = node.get("type")
    if kind == "object":
        properties = node.get("properties")
        if not properties:
            return OPEN_MAP
        return {name: _schema_shape(child, defs, seen) for name, child in properties.items()}
    if kind == "array":
        items = node.get("items") or (node.get("prefixItems") or [{}])[0]
        return [_schema_shape(items, defs, seen)]
    return None


def _model_shape(model: Any) -> Any:
    schema = model.model_json_schema(mode="serialization")
    return _schema_shape(schema, schema.get("$defs", {}))


def expected_shape() -> dict[str, Any]:
    shape = _model_shape(RunResponse)
    shape["result"] = _model_shape(OptimizationResult)
    return shape


def _assert_value_fits(value: Any, shape: Any, path: str) -> None:
    """A real response value must fit the recorded shape wherever it carries data."""
    if shape == OPEN_MAP or value is None:
        return
    if isinstance(shape, dict):
        assert isinstance(value, dict), f"{path}: expected an object"
        assert set(value) == set(shape), f"{path}: keys {sorted(set(value) ^ set(shape))} differ"
        for key, child in shape.items():
            _assert_value_fits(value[key], child, f"{path}.{key}")
    elif isinstance(shape, list):
        assert isinstance(value, list), f"{path}: expected an array"
        for index, item in enumerate(value):
            _assert_value_fits(item, shape[0], f"{path}[{index}]")
    else:
        assert not isinstance(value, dict | list), f"{path}: expected a scalar"


def test_committed_shape_matches_the_pinned_engine_schema() -> None:
    shape = expected_shape()
    if os.getenv("IBAL_UPDATE_CONTRACT_SHAPE"):
        SHAPE_PATH.parent.mkdir(parents=True, exist_ok=True)
        SHAPE_PATH.write_text(json.dumps(shape, indent=2) + "\n", encoding="utf-8")

    assert json.loads(SHAPE_PATH.read_text(encoding="utf-8")) == shape, (
        "contracts/ibal/run-response.shape.json is stale; regenerate it (see module docstring) "
        "and update src/lib/inventoryOptimizer.ts to match."
    )


def test_a_real_run_response_fits_the_shape(api_client: TestClient) -> None:
    dataset = api_client.post("/v1/datasets/synthetic", json={}, headers=auth_headers()).json()
    response = api_client.post(
        "/v1/runs",
        json={"dataset": dataset, "run_config": {"solver_time_limit_seconds": 30}},
        headers=auth_headers(idempotency=True),
    )
    assert response.status_code == 200

    _assert_value_fits(response.json(), expected_shape(), "$")
