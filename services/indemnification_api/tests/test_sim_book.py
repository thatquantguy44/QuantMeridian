"""The TypeScript-built SIM book (108 loans, 16 borrowers) through the Python service (spec020
IND-002).
"""

import json

import pytest
from conftest import CONTRACTS

from indemnification_api.contracts import seal, snapshot_hash
from indemnification_api.engine import GAUSSIAN_NO_WW, GAUSSIAN_WW, STUDENT_T_WW, simulate
from indemnification_api.metrics import channel_metrics
from indemnification_api.schema import validate_snapshot


@pytest.fixture(scope="module")
def book():
    return json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))


def test_the_book_passes_schema_cross_field_rules_and_hash_on_real_floating_point_values(book):
    assert validate_snapshot(book) == []
    assert snapshot_hash(book) == book["snapshot_hash"]


def test_a_desk_run_on_the_book_produces_finite_sensible_metrics(book):
    snap = seal({**book, "run": {**book["run"], "paths": 1000}})
    out = simulate(snap)
    assert set(out.variants) == {GAUSSIAN_WW, GAUSSIAN_NO_WW, STUDENT_T_WW}
    assert out.exposure.shape == (1000, 16, 22)
    program_exposure = out.exposure.sum(axis=1)
    assert program_exposure.max() > 0 and (program_exposure[:, 0] == 0).all()
    for variant in out.variants.values():
        assert variant.cond.min() >= 0 and variant.sampled.min() >= 0
    m = channel_metrics(
        cond=out.variants[GAUSSIAN_WW].cond.sum(axis=1),
        sampled=out.variants[GAUSSIAN_WW].sampled.sum(axis=1),
        exposure=program_exposure,
        grid=out.grid,
    )
    assert m["pfe99"].value >= m["pfe95"].value > 0 and m["epe"].value > 0
    assert all(x.value == x.value for x in m.values())  # no NaN
