"""Typed, solver-neutral representation of a continuous linear program."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.sparse import csr_matrix

FloatArray = NDArray[np.float64]
ObjectiveSense = Literal["minimize", "maximize"]


@dataclass(frozen=True, slots=True)
class LinearProblem:
    """Canonical LP in ranged-row form: ``row_lower <= A @ x <= row_upper``."""

    objective: FloatArray
    matrix: csr_matrix
    row_lower: FloatArray
    row_upper: FloatArray
    variable_lower: FloatArray
    variable_upper: FloatArray
    objective_sense: ObjectiveSense = "minimize"
    variable_names: tuple[str, ...] = ()
    row_names: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        objective = np.asarray(self.objective, dtype=np.float64).copy()
        row_lower = np.asarray(self.row_lower, dtype=np.float64).copy()
        row_upper = np.asarray(self.row_upper, dtype=np.float64).copy()
        variable_lower = np.asarray(self.variable_lower, dtype=np.float64).copy()
        variable_upper = np.asarray(self.variable_upper, dtype=np.float64).copy()
        matrix = csr_matrix(self.matrix, dtype=np.float64, copy=True)

        if matrix.shape != (len(row_lower), len(objective)):
            raise ValueError("constraint matrix shape must match row and variable counts")
        if np.any(~np.isfinite(matrix.data)):
            raise ValueError("constraint coefficients must be finite")
        if len(row_upper) != matrix.shape[0]:
            raise ValueError("row bounds must have the same length")
        if len(variable_lower) != matrix.shape[1] or len(variable_upper) != matrix.shape[1]:
            raise ValueError("variable bounds must have the same length as the objective")
        if np.any(~np.isfinite(objective)):
            raise ValueError("objective coefficients must be finite")
        if np.any(np.isnan(row_lower)) or np.any(np.isnan(row_upper)):
            raise ValueError("row bounds cannot contain NaN")
        if np.any(np.isnan(variable_lower)) or np.any(np.isnan(variable_upper)):
            raise ValueError("variable bounds cannot contain NaN")
        if np.any(row_lower > row_upper) or np.any(variable_lower > variable_upper):
            raise ValueError("lower bounds must not exceed upper bounds")
        if self.objective_sense not in ("minimize", "maximize"):
            raise ValueError("objective_sense must be 'minimize' or 'maximize'")
        if self.variable_names and len(self.variable_names) != matrix.shape[1]:
            raise ValueError("variable_names length must match variable count")
        if self.row_names and len(self.row_names) != matrix.shape[0]:
            raise ValueError("row_names length must match row count")

        for array in (objective, row_lower, row_upper, variable_lower, variable_upper):
            array.flags.writeable = False
        matrix.data.flags.writeable = False
        matrix.indices.flags.writeable = False
        matrix.indptr.flags.writeable = False
        object.__setattr__(self, "objective", objective)
        object.__setattr__(self, "row_lower", row_lower)
        object.__setattr__(self, "row_upper", row_upper)
        object.__setattr__(self, "variable_lower", variable_lower)
        object.__setattr__(self, "variable_upper", variable_upper)
        object.__setattr__(self, "matrix", matrix)


@dataclass(frozen=True, slots=True)
class LinearSolution:
    """Normalized LP result. Objective and primal values use the caller's original units."""

    status: Literal["optimal", "infeasible", "unbounded", "limit", "error"]
    primal: FloatArray | None
    objective_value: float | None
    message: str
    backend: str
    backend_version: str
    iterations: int | None = None


@dataclass(frozen=True, slots=True)
class VerificationReport:
    has_primal: bool
    max_variable_bound_violation: float
    max_row_violation: float
    objective_delta: float
    passed: bool
