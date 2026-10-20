"""Rules the JSON Schema cannot state (spec020 IND-001).

Mirrors ``snapshotIssues`` in src/lib/indemnificationContract.ts. Returns one message per problem;
the service rejects a snapshot with any issue before simulating.
"""

from __future__ import annotations

from typing import Any

import numpy as np

RATING_ORDER = [
    "AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-",
    "BB+", "BB", "BB-", "B+", "B", "B-", "CCC",
]  # fmt: skip
POOL_BUCKETS = ("T+0", "T+1", "T+7", "TERM")


def snapshot_issues(snapshot: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    model = snapshot["model"]
    profile = snapshot["closeout_profile"]
    if model["rho_w"] ** 2 > model["rho_d"]:
        issues.append(f"rho_w^2 ({model['rho_w'] ** 2}) must not exceed rho_d ({model['rho_d']})")

    corr = np.array(model["market"]["factor_corr"], dtype=float)
    corr_ok = True
    for i in range(corr.shape[0]):
        if abs(corr[i, i] - 1) > 1e-12:
            issues.append(f"market.factor_corr diagonal [{i}] must be 1")
            corr_ok = False
        for j in range(i + 1, corr.shape[0]):
            if abs(corr[i, j] - corr[j, i]) > 1e-12:
                issues.append(f"market.factor_corr is not symmetric at [{i}][{j}]")
                corr_ok = False
    if corr_ok and np.linalg.eigvalsh(corr).min() < -1e-10:
        issues.append("market.factor_corr is not positive semi-definite")

    pd = snapshot["rating_pd_table"]["pd_1y"]
    for better, worse in zip(RATING_ORDER, RATING_ORDER[1:], strict=False):
        if pd[worse] < pd[better]:
            issues.append(f"rating_pd_table: PD for {worse} is below PD for {better}")

    ids: dict[str, set[str]] = {}

    def collect(name: str, records: list[dict[str, Any]]) -> None:
        seen: set[str] = set()
        for record in records:
            if record["id"] in seen:
                issues.append(f"duplicate {name} id {record['id']}")
            seen.add(record["id"])
        ids[name] = seen

    collect("security", snapshot["securities"])
    collect("borrower", snapshot["borrowers"])
    collect("owner", snapshot["owners"])
    collect("loan", snapshot["loans"])
    collect("collateral", snapshot["collateral"])
    collect("pool position", snapshot["pool"]["positions"])

    for loan in snapshot["loans"]:
        if loan["borrower_id"] not in ids["borrower"]:
            issues.append(f"loan {loan['id']} names unknown borrower {loan['borrower_id']}")
        if loan["owner_id"] not in ids["owner"]:
            issues.append(f"loan {loan['id']} names unknown owner {loan['owner_id']}")
        if loan["security_id"] not in ids["security"]:
            issues.append(f"loan {loan['id']} names unknown security {loan['security_id']}")
    for holding in snapshot["collateral"]:
        if holding["borrower_id"] not in ids["borrower"]:
            issues.append(
                f"collateral {holding['id']} names unknown borrower {holding['borrower_id']}"
            )
        if holding["security_id"] is not None and holding["security_id"] not in ids["security"]:
            issues.append(
                f"collateral {holding['id']} names unknown security {holding['security_id']}"
            )

    shares = snapshot["pool"]["owner_shares"]
    for share in shares:
        if share["owner_id"] not in ids["owner"]:
            issues.append(f"pool share names unknown owner {share['owner_id']}")
    total = sum(share["share"] for share in shares)
    if snapshot["pool"]["positions"] and abs(total - 1) > 1e-9:
        issues.append(f"pool owner shares sum to {total}, not 1")

    positions = ids["loan"] | ids["collateral"] | ids["pool position"]
    for key in profile["position_overrides"]:
        if key not in positions:
            issues.append(f"profile position override names unknown position {key}")
    for key in profile["borrower_overrides"]:
        if key not in ids["borrower"]:
            issues.append(f"profile borrower override names unknown borrower {key}")
    for key in profile["pool_bucket_overrides"]:
        if key not in POOL_BUCKETS:
            issues.append(f"profile pool bucket override names unknown bucket {key}")
    asset_classes = {s["asset_class"] for s in snapshot["securities"]}
    for key in profile["asset_class_overrides"]:
        if key not in asset_classes:
            issues.append(f"profile asset class override names unknown asset class {key}")

    levels = [("defaults", profile["defaults"])]
    for level in (
        "asset_class_overrides",
        "pool_bucket_overrides",
        "borrower_overrides",
        "position_overrides",
    ):
        levels.extend(profile[level].items())
    for where, settings in levels:
        cap = settings.get("cost_cap_bps")
        floor = settings.get("half_spread_floor_bps")
        if cap is not None and floor is not None and cap < floor:
            issues.append(
                f"profile {where}: cost_cap_bps ({cap}) is below half_spread_floor_bps ({floor})"
            )
    return issues
