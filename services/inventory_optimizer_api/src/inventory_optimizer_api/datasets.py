from __future__ import annotations

from typing import Any

from inventory_optimizer.domain.requests import OptimizationRequest
from inventory_optimizer.validation import validate_request

from .canonical import canonical_hash
from .contracts import (
    DatasetEnvelope,
    DatasetSummary,
    LocatedIssue,
    SourceDisclosure,
    ValidationReport,
)


def summarize(request: OptimizationRequest) -> DatasetSummary:
    return DatasetSummary(
        row_counts={
            "inventory": len(request.inventory),
            "routes": len(request.routes),
            "demand": len(request.demand),
            "counterparty_limits": len(request.counterparty_limits),
            "utilization_policies": len(request.utilization_policies),
            "entity_relationships": len(request.entity_relationships),
        },
        total_lendable_shares=sum(row.total_lendable_shares for row in request.inventory),
        total_available_shares=sum(row.available_to_lend_shares for row in request.inventory),
        total_current_on_loan_shares=sum(row.on_loan_shares for row in request.inventory),
        total_demand_shares=sum(row.reference_quantity_shares for row in request.demand),
        borrower_count=len({row.borrower_id for row in request.routes}),
        security_count=len({row.security_id for row in request.inventory}),
        as_of=request.as_of,
        effective_date=request.effective_date,
    )


def envelope_from_request(
    request: OptimizationRequest,
    *,
    source: SourceDisclosure,
    resolved_config: dict[str, Any] | None = None,
    max_staleness_hours: float = 24.0,
) -> DatasetEnvelope:
    request_payload = request.model_dump(mode="json")
    issues = tuple(
        LocatedIssue(code=item.code, message=item.message, location=item.location)
        for item in validate_request(request, max_staleness_hours=max_staleness_hours)
    )
    return DatasetEnvelope(
        source=source,
        request=request_payload,
        request_hash=canonical_hash(request_payload),
        summary=summarize(request),
        validation=ValidationReport(valid=not issues, issues=issues),
        resolved_config=resolved_config,
    )
