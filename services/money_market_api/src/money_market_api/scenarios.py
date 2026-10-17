"""Cash forecast scenario selection for practical treasury what-if runs."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .contracts import OptimizeRequest
from .optimizer import solve_request


_RESIDUAL_ATTRIBUTE = {
    "p10": "estimated_residual_p10",
    "p50": "estimated_residual_p50",
    "p90": "estimated_residual_p90",
}


def _scenario_request(payload: OptimizeRequest) -> OptimizeRequest:
    """Rebase account opening cash to the selected residual forecast quantile."""
    case = payload.policy.cash_forecast_case
    residual_attribute = _RESIDUAL_ATTRIBUTE[case]
    by_account: dict[tuple[str, str, str], list[Any]] = defaultdict(list)
    for point in payload.cash_forecast:
        by_account[(point.legal_entity_id, point.account_id, point.currency)].append(point)

    scenario_points = []
    for account_points in by_account.values():
        ordered = sorted(account_points, key=lambda point: point.period_date)
        opening_cash = ordered[0].opening_cash
        for point in ordered:
            residual = getattr(point, residual_attribute)
            scenario_points.append(
                point.model_copy(
                    update={
                        "opening_cash": opening_cash,
                        # The LP consumes p50; place the selected quantile there while
                        # retaining the submitted source bands in the original request.
                        "estimated_residual_p50": residual,
                    }
                )
            )
            opening_cash += point.known_net_flow + residual

    return payload.model_copy(update={"cash_forecast": scenario_points})


def solve_scenario_request(payload: OptimizeRequest) -> dict[str, Any]:
    """Solve the selected p10/p50/p90 cash scenario and label the result."""
    result = solve_request(_scenario_request(payload))
    case = payload.policy.cash_forecast_case
    case_label = {"p10": "downside", "p50": "base", "p90": "upside"}[case]
    result["cash_forecast_case"] = case
    result["assumptions"] = [
        (
            f"Estimated residual cash uses the submitted {case} forecast quantile "
            f"({case_label} case); "
            "account opening cash is rebased consistently across the horizon."
        ),
        *[item for item in result["assumptions"] if not item.startswith("Estimated residual cash uses")],
    ]
    return result
