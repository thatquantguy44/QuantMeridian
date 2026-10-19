"""Independent primal, integrality, row and objective checks."""

from __future__ import annotations

import math

import numpy as np

from optimization_core.model import LinearProblem, LinearSolution, VerificationReport


def verify_solution(
    problem: LinearProblem,
    solution: LinearSolution,
    *,
    tolerance: float = 1e-7,
) -> VerificationReport:
    if not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError("tolerance must be finite and positive")
    if solution.primal is None:
        return VerificationReport(False, math.inf, math.inf, math.inf, False)
    primal = np.asarray(solution.primal, dtype=np.float64)
    if primal.shape != problem.objective.shape or np.any(~np.isfinite(primal)):
        return VerificationReport(True, math.inf, math.inf, math.inf, False)

    lower_violation = np.maximum(problem.variable_lower - primal, 0.0)
    upper_violation = np.maximum(primal - problem.variable_upper, 0.0)
    bound_error = max(
        float(np.max(lower_violation, initial=0.0)),
        float(np.max(upper_violation, initial=0.0)),
    )

    activity = np.asarray(problem.matrix @ primal).reshape(-1)
    row_lower_error = np.maximum(problem.row_lower - activity, 0.0)
    row_upper_error = np.maximum(activity - problem.row_upper, 0.0)
    row_error = max(
        float(np.max(row_lower_error, initial=0.0)),
        float(np.max(row_upper_error, initial=0.0)),
    )

    reconstructed = float(problem.objective @ primal)
    objective_error = (
        math.inf
        if solution.objective_value is None or not math.isfinite(solution.objective_value)
        else abs(reconstructed - solution.objective_value)
    )
    integer_indices = np.flatnonzero(problem.variable_integrality)
    integer_error = (
        float(np.max(np.abs(primal[integer_indices] - np.rint(primal[integer_indices])), initial=0.0))
        if len(integer_indices) else 0.0
    )
    return VerificationReport(
        has_primal=True,
        max_variable_bound_violation=bound_error,
        max_row_violation=row_error,
        objective_delta=objective_error,
        passed=max(bound_error, row_error, objective_error, integer_error) <= tolerance,
        max_integrality_violation=integer_error,
    )
