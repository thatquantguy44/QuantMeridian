from __future__ import annotations

from typing import Any

from inventory_optimizer.config import InventoryOptimizerConfig
from inventory_optimizer.domain.requests import OptimizationRequest
from inventory_optimizer.facade import InventoryOptimizer
from inventory_optimizer.platform import PlatformInvocationContext

from inventory_optimizer_api.config_adapter import engine_overrides
from inventory_optimizer_api.contracts import RunConfig, RunRequest, SyntheticConfig
from inventory_optimizer_api.engine_service import solve
from inventory_optimizer_api.synthetic import generate_dataset

# Fields that are expected to vary between two otherwise-identical invocations: a fresh run
# identifier/timestamp per call, and the solver's wall-clock runtime.
_NONDETERMINISTIC_TOP_LEVEL = {"run_id", "created_at"}


def _strip_nondeterministic(result: dict[str, Any]) -> dict[str, Any]:
    stripped = {
        key: value for key, value in result.items() if key not in _NONDETERMINISTIC_TOP_LEVEL
    }
    stripped["solver"] = {
        key: value for key, value in stripped["solver"].items() if key != "runtime_seconds"
    }
    return stripped


def test_service_and_direct_facade_match_deterministic_fields() -> None:
    dataset = generate_dataset(SyntheticConfig(seed=314, profile="balanced", scale="small"))
    run_config = RunConfig(solver_time_limit_seconds=15)
    correlation_id = "9d6f6f1a-1111-4a11-8111-abcdefabcdef"
    idempotency_key = "9d6f6f1a-2222-4a11-8111-abcdefabcdef"

    service_response = solve(
        RunRequest(dataset=dataset, run_config=run_config),
        correlation_id=correlation_id,
        idempotency_key=idempotency_key,
    )

    request = OptimizationRequest.model_validate(dataset.request)
    config = InventoryOptimizerConfig.model_validate(engine_overrides(request, run_config))
    context = PlatformInvocationContext(
        request_id=request.request_id,
        correlation_id=correlation_id,
        idempotency_key=idempotency_key,
        problem_family=request.problem_family,
        as_of=request.as_of,
        authorization_reference="quantmeridian-service-boundary",
        schema_version="1.0.0",
        platform_tenant_id=None,
        actor_reference=None,
    )
    direct_result = InventoryOptimizer(config=config).optimize(request, platform=context)

    service_result = _strip_nondeterministic(service_response.result)
    facade_result = _strip_nondeterministic(direct_result.model_dump(mode="json"))

    assert service_result == facade_result
    assert service_response.result["status"] == "optimal"
