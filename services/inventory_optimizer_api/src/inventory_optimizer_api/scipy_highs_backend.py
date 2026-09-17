from __future__ import annotations

import time
from dataclasses import replace
from typing import Any

import numpy as np
from inventory_optimizer.domain.enums import Capability, SolverStatus
from inventory_optimizer.formulation.compiled import CompiledProblem
from inventory_optimizer.ports.solver import SolverOptions, SolverResult, SolverWarmStart
from scipy import __version__ as SCIPY_VERSION
from scipy.optimize import Bounds, LinearConstraint, linprog, milp

_CAPABILITIES = frozenset({Capability.LP, Capability.MIP})


def _effective_options(options: SolverOptions) -> SolverOptions:
    return replace(options, threads=None, seed=None)


def _scipy_options(options: SolverOptions) -> dict[str, Any]:
    payload: dict[str, Any] = {"disp": options.log_level == "debug"}
    if options.time_limit_seconds is not None:
        payload["time_limit"] = options.time_limit_seconds
    if options.relative_gap is not None:
        payload["mip_rel_gap"] = options.relative_gap
    return payload


def _objective(problem: CompiledProblem) -> tuple[np.ndarray, float, float]:
    sense = -1.0 if problem.objective_sense.value == "maximize" else 1.0
    scale = problem.scaling.objective_scale_usd if problem.scaling.applied else 1.0
    return problem.linear_objective * sense * scale, sense, scale


def _objective_value(
    fun: float | None, *, sense: float, scale: float
) -> tuple[float, float] | None:
    if fun is None:
        return None
    scaled = float(fun) * sense
    return scaled, scaled / scale


def _bounds(problem: CompiledProblem) -> Bounds:
    return Bounds(problem.variable_lower, problem.variable_upper)


def _linprog_constraints(
    problem: CompiledProblem,
) -> tuple[Any | None, np.ndarray | None, Any | None, np.ndarray | None]:
    lower = problem.row_lower
    upper = problem.row_upper
    matrix = problem.constraint_matrix
    equality_mask = np.isfinite(lower) & np.isfinite(upper) & np.isclose(lower, upper)

    equality_matrix = matrix[equality_mask] if np.any(equality_mask) else None
    equality_rhs = upper[equality_mask] if np.any(equality_mask) else None

    inequality_matrices = []
    inequality_rhs = []
    upper_mask = np.isfinite(upper) & ~equality_mask
    if np.any(upper_mask):
        inequality_matrices.append(matrix[upper_mask])
        inequality_rhs.append(upper[upper_mask])
    lower_mask = np.isfinite(lower) & ~equality_mask
    if np.any(lower_mask):
        inequality_matrices.append(-matrix[lower_mask])
        inequality_rhs.append(-lower[lower_mask])
    if not inequality_matrices:
        return None, None, equality_matrix, equality_rhs

    from scipy.sparse import vstack

    return (
        vstack(inequality_matrices),
        np.concatenate(inequality_rhs),
        equality_matrix,
        equality_rhs,
    )


def _status(status: int, primal: np.ndarray | None) -> SolverStatus:
    if status == 0:
        return SolverStatus.OPTIMAL
    if status == 1 and primal is not None:
        return SolverStatus.FEASIBLE_LIMIT
    if status == 2:
        return SolverStatus.INFEASIBLE
    if status == 3:
        return SolverStatus.UNBOUNDED
    return SolverStatus.SOLVER_ERROR


def _result(
    problem: CompiledProblem,
    options: SolverOptions,
    native: Any,
    *,
    runtime_seconds: float,
    sense: float,
    scale: float,
) -> SolverResult:
    primal = (
        np.array(native.x, dtype=np.float64) if getattr(native, "x", None) is not None else None
    )
    objective = _objective_value(getattr(native, "fun", None), sense=sense, scale=scale)
    has_integer_variables = bool(np.any(problem.integrality != 0))
    return SolverResult(
        status=_status(int(native.status), primal),
        primal=primal,
        dual=None,
        reduced_costs=None,
        objective_value_scaled=objective[0] if objective is not None else None,
        objective_value_unscaled=objective[1] if objective is not None else None,
        best_bound=getattr(native, "mip_dual_bound", None) if has_integer_variables else None,
        relative_gap=getattr(native, "mip_gap", None) if has_integer_variables else None,
        runtime_seconds=runtime_seconds,
        iterations=getattr(native, "nit", None),
        nodes=getattr(native, "mip_node_count", None) if has_integer_variables else None,
        termination_reason=str(native.message),
        backend_name="scipy_highs",
        backend_version=SCIPY_VERSION,
        effective_options=_effective_options(options),
        native_status=str(native.status),
    )


class ScipyHighsBackend:
    @property
    def capabilities(self) -> frozenset[Capability]:
        return _CAPABILITIES

    def solve(
        self,
        problem: CompiledProblem,
        options: SolverOptions,
        warm_start: SolverWarmStart | None = None,
    ) -> SolverResult:
        if problem.quadratic_objective is not None:
            return SolverResult(
                status=SolverStatus.INVALID_MODEL,
                primal=None,
                dual=None,
                reduced_costs=None,
                objective_value_scaled=None,
                objective_value_unscaled=None,
                best_bound=None,
                relative_gap=None,
                runtime_seconds=0.0,
                iterations=None,
                nodes=None,
                termination_reason="SciPy HiGHS fallback supports LP/MIP only; QP requires highspy",
                backend_name="scipy_highs",
                backend_version=SCIPY_VERSION,
                effective_options=_effective_options(options),
                native_status="unsupported_qp",
            )
        if warm_start is not None and warm_start.primal is not None:
            return SolverResult(
                status=SolverStatus.INVALID_MODEL,
                primal=None,
                dual=None,
                reduced_costs=None,
                objective_value_scaled=None,
                objective_value_unscaled=None,
                best_bound=None,
                relative_gap=None,
                runtime_seconds=0.0,
                iterations=None,
                nodes=None,
                termination_reason="SciPy HiGHS fallback does not accept warm starts",
                backend_name="scipy_highs",
                backend_version=SCIPY_VERSION,
                effective_options=_effective_options(options),
                native_status="unsupported_warm_start",
            )

        c, sense, scale = _objective(problem)
        start = time.perf_counter()
        if np.any(problem.integrality != 0):
            native = milp(
                c=c,
                integrality=problem.integrality,
                bounds=_bounds(problem),
                constraints=LinearConstraint(
                    problem.constraint_matrix,
                    problem.row_lower,
                    problem.row_upper,
                ),
                options=_scipy_options(options),
            )
        else:
            a_ub, b_ub, a_eq, b_eq = _linprog_constraints(problem)
            native = linprog(
                c,
                A_ub=a_ub,
                b_ub=b_ub,
                A_eq=a_eq,
                b_eq=b_eq,
                bounds=list(zip(problem.variable_lower, problem.variable_upper, strict=True)),
                method="highs",
                options=_scipy_options(options),
            )
        runtime_seconds = time.perf_counter() - start
        return _result(
            problem,
            options,
            native,
            runtime_seconds=runtime_seconds,
            sense=sense,
            scale=scale,
        )
