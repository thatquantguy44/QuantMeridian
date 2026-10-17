"""Shared solver-neutral linear optimization primitives."""

from optimization_core.builder import SparseProblemBuilder
from optimization_core.model import LinearProblem, LinearSolution, VerificationReport
from optimization_core.solver import HighsBackend, SolverBackend
from optimization_core.verify import verify_solution

__all__ = [
    "HighsBackend",
    "LinearProblem",
    "LinearSolution",
    "SolverBackend",
    "SparseProblemBuilder",
    "VerificationReport",
    "verify_solution",
]
