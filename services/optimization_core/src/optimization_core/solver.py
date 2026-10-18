"""Solver port and SciPy's HiGHS LP/MIP adapter."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np
import scipy
from scipy.optimize import Bounds, LinearConstraint, linprog, milp
from scipy.sparse import csr_matrix, vstack

from optimization_core.model import LinearProblem, LinearSolution


@runtime_checkable
class SolverBackend(Protocol):
    @property
    def name(self) -> str: ...

    def solve(self, problem: LinearProblem) -> LinearSolution: ...


class HighsBackend:
    """LP/MIP backend backed by SciPy's bundled HiGHS implementation."""

    @property
    def name(self) -> str:
        return "scipy-highs"

    def solve(self, problem: LinearProblem) -> LinearSolution:
        if any(problem.variable_integrality):
            return self._solve_mip(problem)
        return self._solve_lp(problem)

    def _solve_mip(self, problem: LinearProblem) -> LinearSolution:
        sign = 1.0 if problem.objective_sense == "minimize" else -1.0
        result = milp(
            c=sign * problem.objective,
            integrality=np.asarray(problem.variable_integrality, dtype=np.int32),
            bounds=Bounds(problem.variable_lower, problem.variable_upper),
            constraints=LinearConstraint(problem.matrix, problem.row_lower, problem.row_upper),
        )
        status = {0: "optimal", 1: "limit", 2: "infeasible", 3: "unbounded"}.get(result.status, "error")
        primal = None if result.x is None else np.asarray(result.x, dtype=np.float64)
        return LinearSolution(
            status=status, primal=primal,
            objective_value=None if primal is None else float(problem.objective @ primal),
            message=str(result.message), backend=self.name,
            backend_version=scipy.__version__, iterations=getattr(result, "mip_node_count", None),
        )

    def _solve_lp(self, problem: LinearProblem) -> LinearSolution:
        matrix = problem.matrix
        eq_indices = np.flatnonzero(
            np.isfinite(problem.row_lower)
            & np.isfinite(problem.row_upper)
            & (problem.row_lower == problem.row_upper)
        )
        inequality_indices = np.flatnonzero(
            ~np.isin(np.arange(matrix.shape[0]), eq_indices)
        )

        eq_matrix = matrix[eq_indices] if len(eq_indices) else None
        eq_rhs = problem.row_lower[eq_indices] if len(eq_indices) else None

        ub_rows: list[csr_matrix] = []
        ub_rhs: list[float] = []
        ub_origins: list[tuple[int, str]] = []
        for row_index in inequality_indices:
            row = matrix[row_index]
            lower = problem.row_lower[row_index]
            upper = problem.row_upper[row_index]
            if np.isfinite(upper):
                ub_rows.append(row)
                ub_rhs.append(float(upper))
                ub_origins.append((int(row_index), "upper"))
            if np.isfinite(lower):
                ub_rows.append(-row)
                ub_rhs.append(float(-lower))
                ub_origins.append((int(row_index), "lower"))
        ub_matrix = vstack(ub_rows, format="csr") if ub_rows else None

        sign = 1.0 if problem.objective_sense == "minimize" else -1.0
        result = linprog(
            c=sign * problem.objective,
            A_ub=ub_matrix,
            b_ub=np.asarray(ub_rhs) if ub_rhs else None,
            A_eq=eq_matrix,
            b_eq=eq_rhs,
            bounds=list(zip(problem.variable_lower, problem.variable_upper, strict=True)),
            method="highs",
        )
        status_by_code = {0: "optimal", 1: "limit", 2: "infeasible", 3: "unbounded"}
        status = status_by_code.get(result.status, "error")
        primal = None if result.x is None else np.asarray(result.x, dtype=np.float64)
        objective = (
            None
            if primal is None
            else float(problem.objective @ primal)
        )
        marginals: list[tuple[str, float] | None] = [None] * matrix.shape[0]
        if status == "optimal":
            for position, row_index in enumerate(eq_indices):
                # SciPy minimizes sign*objective; convert back to the caller's sense.
                marginals[int(row_index)] = ("equality", float(sign * result.eqlin.marginals[position]))
            for position, (row_index, side) in enumerate(ub_origins):
                value = float(sign * result.ineqlin.marginals[position])
                if side == "lower":
                    value = -value  # The transformed RHS is -row_lower.
                if abs(value) > 1e-10 or marginals[row_index] is None:
                    marginals[row_index] = (side, value)
        return LinearSolution(
            status=status,
            primal=primal,
            objective_value=objective,
            message=str(result.message),
            backend=self.name,
            backend_version=scipy.__version__,
            iterations=getattr(result, "nit", None),
            row_marginals=tuple(marginals),
        )
