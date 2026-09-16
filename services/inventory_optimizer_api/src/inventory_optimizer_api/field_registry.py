from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class FieldSpec:
    name: str
    data_type: str
    required: bool
    unit: str
    description: str
    example: Any


def field(
    name: str,
    data_type: str,
    required: bool,
    unit: str,
    description: str,
    example: Any,
) -> FieldSpec:
    return FieldSpec(name, data_type, required, unit, description, example)


REQUEST_FIELDS = (
    field("template_schema_version", "string", True, "version", "Template contract version.", "1.0"),
    field("request_id", "string", True, "identifier", "Unique request identifier.", "SYN-REQ-1701"),
    field("as_of", "datetime", True, "ISO-8601 UTC", "Knowledge timestamp for the book.", "2026-09-14T12:00:00Z"),
    field("effective_date", "date", True, "ISO-8601 date", "Optimization effective date.", "2026-09-14"),
    field("problem_family", "string", True, "enum", "Must be securities_lending_inventory.", "securities_lending_inventory"),
)

INVENTORY_FIELDS = (
    field("inventory_id", "string", True, "identifier", "Unique inventory record identifier.", "SYN-INV-001"),
    field("inventory_pool_id", "string", True, "identifier", "Inventory pool identifier.", "SYN-POOL-01"),
    field("security_id", "string", True, "identifier", "Internal security identifier.", "SYN-SEC-001"),
    field("as_of", "datetime", True, "ISO-8601 UTC", "Inventory observation time.", "2026-09-14T12:00:00Z"),
    field("settlement_date", "date", True, "ISO-8601 date", "Settlement date.", "2026-09-14"),
    field("total_lendable_shares", "number", True, "shares", "Total lendable balance including on-loan shares.", 100000),
    field("on_loan_shares", "number", True, "shares", "Current on-loan balance.", 35000),
    field("reserved_shares", "number", True, "shares", "Reserved balance.", 5000),
    field("committed_out_shares", "number", True, "shares", "Committed-out balance.", 0),
    field("available_to_lend_shares", "number", True, "shares", "Must reconcile to total minus on-loan, reserved and committed.", 60000),
    field("price_usd", "number", True, "USD/share", "Security price in USD.", 42.5),
    field("currency", "string", True, "ISO currency", "Initial release requires USD.", "USD"),
    field("eligible", "boolean", True, "boolean", "Whether inventory is eligible.", True),
    field("source_version", "string", True, "version", "Source lineage version.", "upload-v1"),
)

ROUTE_FIELDS = (
    field("route_id", "string", True, "identifier", "Unique candidate route identifier.", "SYN-RT-0001"),
    field("inventory_id", "string", True, "identifier", "Referenced inventory identifier.", "SYN-INV-001"),
    field("security_id", "string", True, "identifier", "Must match referenced inventory security.", "SYN-SEC-001"),
    field("borrower_id", "string", True, "identifier", "Borrower identifier.", "SYN-BOR-001"),
    field("demand_group_id", "string", True, "identifier", "Referenced demand group.", "SYN-DG-0001"),
    field("current_quantity_shares", "number", True, "shares", "Current route allocation.", 12000),
    field("hard_minimum_quantity_shares", "number", False, "shares", "Hard allocation floor.", 0),
    field("minimum_active_quantity_shares", "number", False, "shares", "Minimum positive active quantity.", None),
    field("maximum_quantity_shares", "number", True, "shares", "Route quantity cap.", 40000),
    field("fee_rate", "number", True, "decimal annual rate", "Securities-lending fee rate; 0.02 means 2%.", 0.02),
    field("revenue_share", "number", True, "fraction", "Revenue retained, between 0 and 1.", 1.0),
    field("reinvestment_rate", "number", False, "decimal annual rate", "Optional reinvestment rate.", None),
    field("collateral_factor", "number", False, "multiple", "Optional collateral factor.", None),
    field("variable_cost_rate", "number", True, "decimal annual rate", "Variable cost rate.", 0.0),
    field("increase_cost_usd_per_share", "number", True, "USD/share", "Cost to increase allocation.", 0.0),
    field("decrease_cost_usd_per_share", "number", True, "USD/share", "Cost to decrease allocation.", 0.0),
    field("recall_notice_days", "integer", True, "calendar days", "Recall notice period.", 0),
    field("term_end_date", "date", False, "ISO-8601 date", "Optional route term end.", None),
    field("eligible", "boolean", True, "boolean", "Whether route can receive allocation.", True),
    field("all_or_none", "boolean", False, "boolean", "Enable all-or-none route activation.", False),
    field("lot_size_shares", "number", False, "shares", "Optional discrete lot size.", None),
    field("priority_class", "string", False, "label", "Optional route priority class.", None),
)

DEMAND_FIELDS = (
    field("demand_group_id", "string", True, "identifier", "Unique demand group identifier.", "SYN-DG-0001"),
    field("security_id", "string", True, "identifier", "Demanded security identifier.", "SYN-SEC-001"),
    field("borrower_id", "string", True, "identifier", "Borrower identifier.", "SYN-BOR-001"),
    field("as_of", "datetime", True, "ISO-8601 UTC", "Forecast observation time.", "2026-09-14T12:00:00Z"),
    field("reference_quantity_shares", "number", True, "shares", "Demand at the reference fee.", 40000),
    field("reference_fee_rate", "number", True, "decimal annual rate", "Reference fee rate.", 0.02),
    field("elasticity", "number", True, "nonnegative coefficient", "Demand elasticity coefficient.", 0.1),
    field("forecast_std_shares", "number", False, "shares", "Forecast standard deviation.", None),
    field("hard_max_quantity_shares", "number", False, "shares", "Optional hard demand cap.", None),
    field("source_model", "string", True, "name", "Forecast model name.", "user-upload"),
    field("source_version", "string", True, "version", "Forecast lineage version.", "upload-v1"),
    field("candidate_fee_rates", "json", False, "JSON array of decimal rates", "Optional fee tiers.", "[]"),
)

COUNTERPARTY_FIELDS = (
    field("limit_id", "string", True, "identifier", "Unique limit identifier.", "SYN-LIM-001"),
    field("borrower_id", "string", True, "identifier", "Borrower scope or placeholder for entity-scoped limits.", "SYN-BOR-001"),
    field("legal_entity_id", "string", False, "identifier", "Optional legal-entity scope.", None),
    field("ultimate_parent_id", "string", False, "identifier", "Optional ultimate-parent scope.", None),
    field("effective_from", "datetime", True, "ISO-8601 UTC", "Limit effective start.", "2026-09-14T12:00:00Z"),
    field("effective_to", "datetime", False, "ISO-8601 UTC", "Optional limit effective end.", None),
    field("security_id", "string", False, "identifier", "Optional security scope.", None),
    field("inventory_pool_id", "string", False, "identifier", "Optional inventory-pool scope.", None),
    field("maximum_notional_usd", "number", False, "USD", "Optional notional cap.", None),
    field("maximum_quantity_shares", "number", False, "shares", "Optional quantity cap.", 100000),
    field("hard", "boolean", False, "boolean", "Whether unresolved hierarchy fails closed.", True),
    field("risk_class", "string", False, "label", "Optional risk class.", None),
    field("source", "string", True, "name", "Limit source.", "user-upload"),
    field("source_version", "string", True, "version", "Limit source version.", "upload-v1"),
)

UTILIZATION_FIELDS = (
    field("policy_id", "string", True, "identifier", "Unique utilization policy identifier.", "SYN-UP-001"),
    field("inventory_pool_id", "string", False, "identifier", "Optional pool scope.", "SYN-POOL-01"),
    field("security_id", "string", False, "identifier", "Optional security scope.", None),
    field("effective_from", "datetime", True, "ISO-8601 UTC", "Policy effective start.", "2026-09-14T12:00:00Z"),
    field("effective_to", "datetime", False, "ISO-8601 UTC", "Optional policy effective end.", None),
    field("minimum_utilization", "number", False, "fraction", "Optional hard utilization floor.", None),
    field("target_utilization", "number", False, "fraction", "Optional utilization target.", None),
    field("maximum_utilization", "number", False, "fraction", "Optional utilization cap.", 0.9),
    field("reserve_buffer_shares", "number", False, "shares", "Additional policy reserve.", 0),
    field("reserve_buffer_fraction", "number", False, "fraction", "Additional fractional reserve.", 0),
    field("target_hard", "boolean", False, "boolean", "Whether target is hard.", False),
    field("target_penalty_usd_per_share", "number", False, "USD/share", "Penalty required for a soft target.", None),
    field("target_priority", "integer", False, "ordinal", "Optional target priority.", None),
    field("maximum_active_routes", "integer", False, "count", "Optional MIP route cardinality cap.", None),
    field("source", "string", True, "name", "Policy source.", "user-upload"),
    field("source_version", "string", True, "version", "Policy source version.", "upload-v1"),
)

ENTITY_FIELDS = (
    field("entity_id", "string", True, "identifier", "Borrower identifier being resolved.", "SYN-BOR-001"),
    field("legal_entity_id", "string", True, "identifier", "Resolved legal entity.", "SYN-LE-001"),
    field("ultimate_parent_id", "string", True, "identifier", "Resolved ultimate parent.", "SYN-PARENT-001"),
    field("relationship_type", "string", True, "label", "Relationship classification.", "borrower_to_parent"),
    field("ownership_confidence", "number", True, "fraction", "Resolution confidence from 0 to 1.", 0.99),
    field("observed_at", "datetime", True, "ISO-8601 UTC", "Time the relationship became known.", "2026-09-14T12:00:00Z"),
    field("effective_from", "datetime", True, "ISO-8601 UTC", "Economic effective start.", "2026-09-14T12:00:00Z"),
    field("effective_to", "datetime", False, "ISO-8601 UTC", "Optional economic effective end.", None),
    field("source", "string", True, "name", "Relationship source.", "user-upload"),
    field("source_version", "string", True, "version", "Relationship source version.", "upload-v1"),
    field("field_mapping_version", "string", True, "version", "Mapping version.", "upload-v1"),
    field("quality", "string", True, "enum", "verified, estimated, stale, or conflicting.", "verified"),
)

SHEETS: dict[str, tuple[FieldSpec, ...]] = {
    "request": REQUEST_FIELDS,
    "inventory": INVENTORY_FIELDS,
    "routes": ROUTE_FIELDS,
    "demand": DEMAND_FIELDS,
    "counterparty_limits": COUNTERPARTY_FIELDS,
    "utilization_policies": UTILIZATION_FIELDS,
    "entity_relationships": ENTITY_FIELDS,
}

ROW_LIMITS = {
    "inventory": 500,
    "routes": 10_000,
    "demand": 5_000,
    "counterparty_limits": 5_000,
    "utilization_policies": 5_000,
    "entity_relationships": 5_000,
}
