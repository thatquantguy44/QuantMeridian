from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import numpy as np
from inventory_optimizer.domain.requests import OptimizationRequest

from .contracts import DatasetEnvelope, SourceDisclosure, SyntheticConfig
from .datasets import envelope_from_request

GENERATOR_VERSION = "synthetic-v1"

SCALE_PRESETS: dict[str, dict[str, int]] = {
    "small": {"security_count": 8, "inventory_pool_count": 2, "borrower_count": 6, "parent_group_count": 3, "routes_per_security": 3},
    "medium": {"security_count": 30, "inventory_pool_count": 4, "borrower_count": 15, "parent_group_count": 5, "routes_per_security": 5},
    "large": {"security_count": 100, "inventory_pool_count": 8, "borrower_count": 40, "parent_group_count": 10, "routes_per_security": 8},
}

PROFILE_PRESETS: dict[str, dict[str, float]] = {
    "balanced": {},
    "scarce": {"starting_utilization": 0.62, "utilization_cap": 0.92, "fee_rate_mean": 0.045, "fee_rate_dispersion": 0.020},
    "concentrated": {"borrower_concentration": 0.80, "starting_utilization": 0.48},
    "specials": {"fee_rate_mean": 0.085, "fee_rate_dispersion": 0.040, "elasticity_mean": 0.25, "discrete_route_fraction": 0.10},
}


def starter_config() -> SyntheticConfig:
    return SyntheticConfig(
        as_of=datetime(2026, 9, 14, 12, 0, tzinfo=UTC),
        effective_date=date(2026, 9, 14),
    )


def resolve_config(config: SyntheticConfig) -> dict[str, Any]:
    resolved = config.model_dump(mode="json")
    if config.scale != "custom":
        resolved.update(SCALE_PRESETS[config.scale])
    resolved.update(PROFILE_PRESETS[config.profile])
    return resolved


def _weighted_borrowers(rng: np.random.Generator, count: int, concentration: float) -> np.ndarray:
    ranks = np.arange(1, count + 1, dtype=float)
    exponent = 0.25 + 2.75 * concentration
    weights = 1.0 / np.power(ranks, exponent)
    return weights / weights.sum()


def generate_request(config: SyntheticConfig) -> tuple[OptimizationRequest, dict[str, Any]]:
    resolved = resolve_config(config)
    rng = np.random.Generator(np.random.PCG64(config.seed))
    as_of = config.as_of
    effective = config.effective_date
    security_count = int(resolved["security_count"])
    pool_count = int(resolved["inventory_pool_count"])
    borrower_count = int(resolved["borrower_count"])
    parent_count = int(resolved["parent_group_count"])
    routes_per_security = int(resolved["routes_per_security"])
    borrower_weights = _weighted_borrowers(rng, borrower_count, float(resolved["borrower_concentration"]))

    borrower_ids = [f"SYN-BOR-{i + 1:03d}" for i in range(borrower_count)]
    parent_ids = [f"SYN-PARENT-{i + 1:03d}" for i in range(parent_count)]
    relationships = []
    for index, borrower_id in enumerate(borrower_ids):
        parent_id = parent_ids[index % parent_count]
        relationships.append(
            {
                "value": {
                    "entity_id": borrower_id,
                    "legal_entity_id": f"SYN-LE-{index + 1:03d}",
                    "ultimate_parent_id": parent_id,
                    "relationship_type": "borrower_to_parent",
                    "ownership_confidence": 0.99,
                },
                "observed_at": as_of,
                "effective_from": as_of,
                "source": "synthetic",
                "source_version": GENERATOR_VERSION,
                "field_mapping_version": GENERATOR_VERSION,
                "quality": "verified",
            }
        )

    inventory: list[dict[str, Any]] = []
    routes: list[dict[str, Any]] = []
    demand: list[dict[str, Any]] = []
    route_index = 0
    for sec_index in range(security_count):
        security_id = f"SYN-SEC-{sec_index + 1:03d}"
        inventory_id = f"SYN-INV-{sec_index + 1:03d}"
        pool_id = f"SYN-POOL-{(sec_index % pool_count) + 1:02d}"
        total = float(rng.integers(20, 250) * 1000)
        reserve = float(round(total * float(resolved["reserve_fraction"]), 6))
        utilization_noise = float(rng.normal(0.0, 0.035))
        starting_utilization = min(
            float(resolved["utilization_cap"]) - 0.08,
            max(0.0, float(resolved["starting_utilization"]) + utilization_noise),
        )
        on_loan = float(round(total * starting_utilization, 6))
        available = float(round(total - on_loan - reserve, 6))
        price = float(round(rng.lognormal(mean=3.7, sigma=0.55), 2))
        inventory.append(
            {
                "inventory_id": inventory_id,
                "inventory_pool_id": pool_id,
                "security_id": security_id,
                "as_of": as_of,
                "settlement_date": effective,
                "total_lendable_shares": total,
                "on_loan_shares": on_loan,
                "reserved_shares": reserve,
                "committed_out_shares": 0.0,
                "available_to_lend_shares": available,
                "price_usd": price,
                "currency": "USD",
                "eligible": True,
                "source_version": GENERATOR_VERSION,
            }
        )

        eligible_flags = rng.random(routes_per_security) >= float(resolved["ineligible_fraction"])
        if not eligible_flags.any():
            eligible_flags[0] = True
        current_weights = rng.dirichlet(np.ones(int(eligible_flags.sum())))
        eligible_cursor = 0
        assigned_current = 0.0
        for local_index in range(routes_per_security):
            route_index += 1
            borrower_pos = int(rng.choice(borrower_count, p=borrower_weights))
            borrower_id = borrower_ids[borrower_pos]
            route_id = f"SYN-RT-{route_index:05d}"
            demand_id = f"SYN-DG-{route_index:05d}"
            eligible = bool(eligible_flags[local_index])
            if eligible:
                if eligible_cursor == int(eligible_flags.sum()) - 1:
                    current = float(round(on_loan - assigned_current, 6))
                else:
                    current = float(round(on_loan * current_weights[eligible_cursor], 6))
                    assigned_current += current
                eligible_cursor += 1
            else:
                current = 0.0
            expansion = available / max(1, int(eligible_flags.sum()))
            maximum = float(round(current + expansion * rng.uniform(0.8, 1.5), 6)) if eligible else 0.0
            fee = float(
                np.clip(
                    rng.normal(float(resolved["fee_rate_mean"]), float(resolved["fee_rate_dispersion"])),
                    0.0001,
                    0.25,
                )
            )
            discrete = eligible and rng.random() < float(resolved["discrete_route_fraction"])
            routes.append(
                {
                    "route_id": route_id,
                    "inventory_id": inventory_id,
                    "security_id": security_id,
                    "borrower_id": borrower_id,
                    "demand_group_id": demand_id,
                    "current_quantity_shares": current,
                    "hard_minimum_quantity_shares": 0.0,
                    "minimum_active_quantity_shares": None,
                    "maximum_quantity_shares": maximum,
                    "fee_rate": fee,
                    "revenue_share": 1.0,
                    "reinvestment_rate": None,
                    "collateral_factor": None,
                    "variable_cost_rate": 0.0,
                    "increase_cost_usd_per_share": 0.0,
                    "decrease_cost_usd_per_share": 0.0,
                    "recall_notice_days": 0,
                    "term_end_date": None,
                    "eligible": eligible,
                    "all_or_none": False,
                    "lot_size_shares": 100.0 if discrete else None,
                    "priority_class": "SPECIAL" if config.profile == "specials" else None,
                }
            )
            demand.append(
                {
                    "demand_group_id": demand_id,
                    "security_id": security_id,
                    "borrower_id": borrower_id,
                    "as_of": as_of,
                    "reference_quantity_shares": maximum,
                    "reference_fee_rate": fee,
                    "elasticity": max(0.0, float(rng.normal(float(resolved["elasticity_mean"]), 0.03))),
                    "forecast_std_shares": float(round(maximum * 0.10, 6)),
                    "hard_max_quantity_shares": maximum,
                    "source_model": "synthetic-pcg64",
                    "source_version": GENERATOR_VERSION,
                    "candidate_fee_rates": [],
                }
            )

    counterparty_limits: list[dict[str, Any]] = []
    for parent_id in parent_ids:
        scoped_max = sum(
            float(route["maximum_quantity_shares"])
            for route in routes
            if relationships[borrower_ids.index(str(route["borrower_id"]))]["value"]["ultimate_parent_id"] == parent_id
        )
        counterparty_limits.append(
            {
                "limit_id": f"SYN-LIM-{parent_id.rsplit('-', 1)[-1]}",
                "borrower_id": "ENTITY-SCOPED",
                "ultimate_parent_id": parent_id,
                "effective_from": as_of,
                "maximum_quantity_shares": max(1.0, scoped_max * 0.85),
                "hard": True,
                "source": "synthetic",
                "source_version": GENERATOR_VERSION,
            }
        )

    utilization_policies = [
        {
            "policy_id": f"SYN-UP-{index + 1:03d}",
            "security_id": row["security_id"],
            "effective_from": as_of,
            "maximum_utilization": float(resolved["utilization_cap"]),
            "reserve_buffer_shares": 0.0,
            "reserve_buffer_fraction": 0.0,
            "source": "synthetic",
            "source_version": GENERATOR_VERSION,
        }
        for index, row in enumerate(inventory)
    ]
    payload = {
        "request_id": f"SYN-REQ-{config.seed}",
        "as_of": as_of,
        "effective_date": effective,
        "problem_family": "securities_lending_inventory",
        "inventory": inventory,
        "routes": routes,
        "demand": demand,
        "counterparty_limits": counterparty_limits,
        "utilization_policies": utilization_policies,
        "entity_relationships": relationships,
        "metadata": {"source_mode": "synthetic", "generator_version": GENERATOR_VERSION},
    }
    return OptimizationRequest.model_validate(payload), resolved


def generate_dataset(config: SyntheticConfig) -> DatasetEnvelope:
    request, resolved = generate_request(config)
    return envelope_from_request(
        request,
        source=SourceDisclosure(
            mode="synthetic",
            label="Synthetic",
            seed=config.seed,
            generator_version=GENERATOR_VERSION,
        ),
        resolved_config=resolved,
    )
