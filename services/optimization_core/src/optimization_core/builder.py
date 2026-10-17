"""Incremental sparse construction for continuous LPs."""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from scipy.sparse import coo_matrix

from optimization_core.model import LinearProblem, ObjectiveSense


class SparseProblemBuilder:
    """Build a named ranged-row LP without materializing a dense constraint matrix."""

    def __init__(self, *, objective_sense: ObjectiveSense = "minimize") -> None:
        self._objective_sense = objective_sense
        self._variables: list[tuple[str, float, float, float]] = []
        self._rows: list[tuple[str, dict[int, float], float, float]] = []
        self._variable_names: set[str] = set()
        self._row_names: set[str] = set()

    def add_variable(
        self,
        name: str,
        *,
        objective: float = 0.0,
        lower: float = 0.0,
        upper: float = np.inf,
    ) -> int:
        if not name or name in self._variable_names:
            raise ValueError(f"variable name must be non-empty and unique: {name!r}")
        if not np.isfinite(objective) or np.isnan(lower) or np.isnan(upper) or lower > upper:
            raise ValueError(f"invalid objective or bounds for variable {name!r}")
        index = len(self._variables)
        self._variables.append((name, objective, lower, upper))
        self._variable_names.add(name)
        return index

    def add_row(
        self,
        name: str,
        coefficients: Mapping[int, float],
        *,
        lower: float = -np.inf,
        upper: float = np.inf,
    ) -> int:
        if not name or name in self._row_names:
            raise ValueError(f"row name must be non-empty and unique: {name!r}")
        if np.isnan(lower) or np.isnan(upper) or lower > upper:
            raise ValueError(f"invalid bounds for row {name!r}")
        cleaned: dict[int, float] = {}
        for column, value in coefficients.items():
            if not isinstance(column, int) or not 0 <= column < len(self._variables):
                raise ValueError(f"row {name!r} references unknown variable index {column!r}")
            if not np.isfinite(value):
                raise ValueError(f"row {name!r} contains a non-finite coefficient")
            if value != 0.0:
                cleaned[column] = cleaned.get(column, 0.0) + float(value)
        index = len(self._rows)
        self._rows.append((name, cleaned, float(lower), float(upper)))
        self._row_names.add(name)
        return index

    def build(self) -> LinearProblem:
        row_indices: list[int] = []
        column_indices: list[int] = []
        values: list[float] = []
        for row_index, (_, coefficients, _, _) in enumerate(self._rows):
            for column_index, value in coefficients.items():
                row_indices.append(row_index)
                column_indices.append(column_index)
                values.append(value)
        shape = (len(self._rows), len(self._variables))
        matrix = coo_matrix((values, (row_indices, column_indices)), shape=shape).tocsr()
        variables = self._variables
        rows = self._rows
        return LinearProblem(
            objective=np.asarray([v[1] for v in variables]),
            matrix=matrix,
            row_lower=np.asarray([r[2] for r in rows]),
            row_upper=np.asarray([r[3] for r in rows]),
            variable_lower=np.asarray([v[2] for v in variables]),
            variable_upper=np.asarray([v[3] for v in variables]),
            objective_sense=self._objective_sense,
            variable_names=tuple(v[0] for v in variables),
            row_names=tuple(r[0] for r in rows),
        )
