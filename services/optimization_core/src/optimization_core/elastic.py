"""Opt-in utilization-only elastic diagnostics for otherwise hard LP models."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Sequence

import numpy as np
from scipy.sparse import coo_matrix, hstack

from optimization_core.model import LinearProblem, VerificationReport
from optimization_core.solver import SolverBackend
from optimization_core.verify import verify_solution

UtilizationBound = Literal["minimum", "maximum"]


@dataclass(frozen=True, slots=True)
class UtilizationSlack:
    """Relaxation reported for one explicitly allow-listed utilization row."""

    row_name: str
    bound: UtilizationBound
    raw_slack_shares: float
    normalized_slack: float


@dataclass(frozen=True, slots=True)
class UtilizationElasticDiagnostic:
    """Separate diagnostic outcome; it is not a replacement for the original solve."""

    status: str
    normalized_slack_total: float | None
    slacks: tuple[UtilizationSlack, ...]
    verification: VerificationReport
    message: str
    backend: str
    backend_version: str


def diagnose_utilization_elastic(
    problem: LinearProblem,
    backend: SolverBackend,
    *,
    utilization_min_rows: Sequence[str],
    utilization_max_rows: Sequence[str],
    inventory_total_lendable_shares: float,
) -> UtilizationElasticDiagnostic:
    """Minimize one-tier normalized slack on allow-listed utilization rows only.

    Original decision variables and all non-target row bounds remain in the diagnostic LP.
    Each requested minimum row receives a nonnegative slack added to its activity; each
    requested maximum row receives a nonnegative slack subtracted from its activity. All
    original objective coefficients are zeroed in this separate diagnostic problem, while
    each slack is charged ``1 / inventory_total_lendable_shares``. The input problem and
    its solve result are never modified.
    """

    if (
        not math.isfinite(inventory_total_lendable_shares)
        or inventory_total_lendable_shares <= 0
    ):
        raise ValueError("inventory_total_lendable_shares must be finite and positive")

    minimum_rows = tuple(utilization_min_rows)
    maximum_rows = tuple(utilization_max_rows)
    if not minimum_rows and not maximum_rows:
        raise ValueError("at least one utilization row must be allow-listed")
    if len(set(minimum_rows)) != len(minimum_rows):
        raise ValueError("utilization_min_rows must not contain duplicates")
    if len(set(maximum_rows)) != len(maximum_rows):
        raise ValueError("utilization_max_rows must not contain duplicates")
    if set(minimum_rows) & set(maximum_rows):
        raise ValueError("a utilization row cannot be both a minimum and maximum row")

    names = problem.row_names
    if not names and (minimum_rows or maximum_rows):
        raise ValueError("allow-listed utilization rows require named problem rows")
    row_index = {name: index for index, name in enumerate(names)}
    if len(row_index) != len(names):
        raise ValueError("problem row names must be unique for elastic diagnostics")
    unknown = (set(minimum_rows) | set(maximum_rows)) - row_index.keys()
    if unknown:
        raise ValueError(f"unknown utilization row(s): {', '.join(sorted(unknown))}")
    if any(not name.startswith("utilization_min") for name in minimum_rows):
        raise ValueError("minimum allowlist may contain utilization_min rows only")
    if any(not name.startswith("utilization_max") for name in maximum_rows):
        raise ValueError("maximum allowlist may contain utilization_max rows only")

    rows: list[tuple[str, UtilizationBound, int, float]] = []
    for name in minimum_rows:
        index = row_index[name]
        if not math.isfinite(float(problem.row_lower[index])):
            raise ValueError(f"minimum utilization row {name!r} has no finite lower bound")
        if math.isfinite(float(problem.row_upper[index])):
            raise ValueError(f"minimum utilization row {name!r} must not have an upper bound")
        rows.append((name, "minimum", index, 1.0))
    for name in maximum_rows:
        index = row_index[name]
        if not math.isfinite(float(problem.row_upper[index])):
            raise ValueError(f"maximum utilization row {name!r} has no finite upper bound")
        if math.isfinite(float(problem.row_lower[index])):
            raise ValueError(f"maximum utilization row {name!r} must not have a lower bound")
        rows.append((name, "maximum", index, -1.0))

    slack_columns = len(rows)
    slack_matrix = coo_matrix(
        (
            np.asarray([entry[3] for entry in rows], dtype=np.float64),
            (
                np.asarray([entry[2] for entry in rows], dtype=np.int32),
                np.arange(slack_columns, dtype=np.int32),
            ),
        ),
        shape=(problem.matrix.shape[0], slack_columns),
    ).tocsr()
    diagnostic_problem = LinearProblem(
        objective=np.concatenate(
            (
                np.zeros_like(problem.objective),
                np.full(slack_columns, 1.0 / inventory_total_lendable_shares),
            )
        ),
        matrix=hstack((problem.matrix, slack_matrix), format="csr"),
        row_lower=problem.row_lower,
        row_upper=problem.row_upper,
        variable_lower=np.concatenate((problem.variable_lower, np.zeros(slack_columns))),
        variable_upper=np.concatenate((problem.variable_upper, np.full(slack_columns, np.inf))),
        objective_sense="minimize",
        variable_names=(
            problem.variable_names
            or tuple(f"x{index}" for index in range(len(problem.objective)))
        )
        + tuple(f"elastic_slack:{name}" for name, _, _, _ in rows),
        row_names=problem.row_names,
    )
    solution = backend.solve(diagnostic_problem)
    verification = verify_solution(diagnostic_problem, solution)

    slacks: tuple[UtilizationSlack, ...] = ()
    total = None
    if (
        solution.status == "optimal" and verification.passed
        and solution.primal is not None
        and len(solution.primal) == len(diagnostic_problem.objective)
        and np.all(np.isfinite(solution.primal))
    ):
        entries = tuple(
            UtilizationSlack(
                row_name=name,
                bound=bound,
                raw_slack_shares=max(0.0, float(solution.primal[len(problem.objective) + i])),
                normalized_slack=max(0.0, float(solution.primal[len(problem.objective) + i]))
                / inventory_total_lendable_shares,
            )
            for i, (name, bound, _, _) in enumerate(rows)
        )
        slacks = entries
        total = float(sum(item.normalized_slack for item in entries))

    return UtilizationElasticDiagnostic(
        status=solution.status,
        normalized_slack_total=total,
        slacks=slacks,
        verification=verification,
        message=solution.message,
        backend=solution.backend,
        backend_version=solution.backend_version,
    )
