"""Model-neutral bridge to the shared optimization core."""

from __future__ import annotations

from dataclasses import dataclass

from optimization_core import (
    HighsBackend,
    LinearProblem,
    LinearSolution,
    SolverBackend,
    VerificationReport,
    verify_solution,
)


@dataclass(frozen=True, slots=True)
class VerifiedCandidate:
    """Candidate and independent check kept together before any product presentation."""

    solution: LinearSolution
    verification: VerificationReport

    @property
    def eligible_for_presentation(self) -> bool:
        return self.solution.status == "optimal" and self.verification.passed


def solve_verified(
    problem: LinearProblem,
    backend: SolverBackend | None = None,
) -> VerifiedCandidate:
    """Solve a caller-built LP through the shared backend and independently verify it."""

    active_backend = backend or HighsBackend()
    solution = active_backend.solve(problem)
    verification = verify_solution(problem, solution)
    return VerifiedCandidate(solution=solution, verification=verification)
