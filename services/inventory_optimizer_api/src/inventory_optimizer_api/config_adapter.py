from __future__ import annotations

from inventory_optimizer.domain.requests import OptimizationRequest

from .contracts import LocatedIssue, RunConfig


class RunConfigurationError(ValueError):
    def __init__(self, issues: tuple[LocatedIssue, ...]):
        self.issues = issues
        super().__init__(f"run configuration rejected with {len(issues)} issue(s)")


def _requires_mip(request: OptimizationRequest) -> bool:
    return any(
        route.all_or_none
        or route.minimum_active_quantity_shares is not None
        or route.lot_size_shares is not None
        for route in request.routes
    ) or any(policy.maximum_active_routes is not None for policy in request.utilization_policies)


def engine_overrides(request: OptimizationRequest, config: RunConfig) -> dict[str, object]:
    issues: list[LocatedIssue] = []
    if _requires_mip(request) and config.allocation_stability_penalty > 0:
        issues.append(
            LocatedIssue(
                code="MIP_QP_CONFLICT",
                message="Discrete route features and allocation stability cannot be combined.",
                location="run_config.allocation_stability_penalty",
            )
        )
    if issues:
        raise RunConfigurationError(tuple(issues))
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
