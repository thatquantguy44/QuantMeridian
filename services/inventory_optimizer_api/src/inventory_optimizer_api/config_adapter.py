from __future__ import annotations

from inventory_optimizer.domain.requests import OptimizationRequest

from .contracts import LocatedIssue, RunConfig


class RunConfigurationError(ValueError):
    def __init__(self, issues: tuple[LocatedIssue, ...]):
        self.issues = issues
        super().__init__(f"run configuration rejected with {len(issues)} issue(s)")


def engine_overrides(request: OptimizationRequest, config: RunConfig) -> dict[str, object]:
    # Discrete route features with a positive stability penalty used to be refused here
    # (MIP_QP_CONFLICT). The pinned engine solves that combination itself as a stability-linearized
    # MIP (variant ``mip_linearized_stability``) and verifies it, so the service adds no guard
    # (InventoryBallast 0018 T-020 / AC-011). ``request`` stays in the signature for callers.
    del request
    return {
        "formulation": {
            "planning_horizon_days": config.planning_horizon_days,
            "day_count_basis": config.day_count_basis,
        },
        "validation": {
            "max_staleness_hours": config.max_staleness_hours,
            "minimum_entity_confidence": config.minimum_entity_confidence,
        },
        "solver": {
            "backend": "highs",
            "time_limit_seconds": config.solver_time_limit_seconds,
            "relative_gap": config.relative_gap,
            "threads": config.threads,
            "seed": config.solver_seed,
            "log_level": "warning",
        },
        "objective": {
            "allocation_stability_penalty": config.allocation_stability_penalty,
        },
    }
