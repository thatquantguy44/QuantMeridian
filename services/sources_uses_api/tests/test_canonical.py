"""Canonical JSON and hashing parity with the TypeScript client (spec012 SU-002).

`contracts/sources_uses/fixtures/canonical-vectors.json` holds number vectors whose expected text
is what JavaScript's `JSON.stringify` produces. `src/lib/sourcesUsesContract.test.ts` checks the
same vectors, so both sides serialize numbers identically; `test_contracts.py` checks whole
configuration hashes.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from sources_uses_api.canonical import canonical_json

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "contracts" / "sources_uses" / "fixtures"
     / "canonical-vectors.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("vector", VECTORS["numbers"], ids=lambda v: v["canonical"])
def test_numbers_serialize_like_javascript(vector: dict) -> None:
    assert canonical_json(vector["value"]) == vector["canonical"]


def test_negative_zero_serializes_as_zero() -> None:
    assert canonical_json(-0.0) == "0"


def test_object_keys_are_sorted_and_whitespace_free() -> None:
    assert canonical_json({"b": 1, "a": [True, None, "x"]}) == '{"a":[true,null,"x"],"b":1}'


@pytest.mark.parametrize("text", ["line\nbreak", 'quote " and \\ slash', "tab\tcontrol\x01", "é €"])
def test_strings_escape_like_javascript(text: str) -> None:
    # JSON.stringify keeps non-ASCII characters raw and escapes the same control characters.
    assert canonical_json(text) == json.dumps(text, ensure_ascii=False)


def test_lone_surrogate_is_escaped_like_javascript() -> None:
    assert canonical_json("a\ud800b") == '"a\\ud800b"'


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_numbers_are_rejected(value: float) -> None:
    with pytest.raises(ValueError):
        canonical_json(value)


def test_integral_floats_serialize_without_a_decimal_point() -> None:
    # Pydantic stores amounts as floats; JavaScript has no int/float split.
    assert canonical_json(125_000_000.0) == canonical_json(125_000_000) == "125000000"
