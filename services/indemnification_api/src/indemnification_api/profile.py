"""Close-out profile resolution (spec020 decision 4, IND-020).

Every close-out and liquidity-cost setting for a position comes from the snapshot's profile. Overrides
resolve position, then borrower, then asset class (loans and security collateral) or pool bucket (pool
positions), then the profile defaults. The close-out period for a position is

* ``mpor_fixed_days`` when one is set at any level, else
* the pool forced-sale period for a pool position, else the liquid or other period for the security,
  lengthened to the concentrated period when the position is above the concentration threshold (percent
  of average daily volume) or the security is hard to borrow and the profile says that counts,

plus ``addon_days``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SETTING_KEYS = (
    "mpor_liquid_days", "mpor_other_days", "mpor_concentrated_days", "mpor_pool_forced_sale_days",
    "mpor_fixed_days", "addon_days", "concentration_threshold_pct_adv", "htb_uses_concentrated_period",
    "impact_k", "impact_alpha", "half_spread_floor_bps", "cost_cap_bps", "stress_beta", "stress_factor",
    "unwind", "margin_call_every_days",
)  # fmt: skip


@dataclass(frozen=True)
class EffectiveSettings:
    position_id: str
    kind: str  # loan | collateral | pool_position
    borrower_id: str | None
    mpor_days: int
    settings: dict[str, Any]
    source_levels: dict[str, str]
    adv_units: float | None
    daily_vol: float | None

    def as_dict(self) -> dict[str, Any]:
        """The result contract's EffectiveSettings object."""
        return {
            "position_id": self.position_id,
            "kind": self.kind,
            "mpor_days": self.mpor_days,
            "settings": dict(self.settings),
            "source_levels": dict(self.source_levels),
        }


def _merge(profile: dict[str, Any], layers: list[tuple[str, dict[str, Any]]]) -> tuple[dict, dict]:
    """Defaults, then each (level, override) from lowest to highest precedence."""
    values = {key: profile["defaults"][key] for key in SETTING_KEYS}
    levels = dict.fromkeys(SETTING_KEYS, "default")
    for level, override in layers:
        for key in SETTING_KEYS:
            if key in override:
                values[key] = override[key]
                levels[key] = level
    return values, levels


def _mpor(settings: dict[str, Any], *, pool: bool, security: dict | None, pct_adv: float | None) -> int:
    if settings["mpor_fixed_days"] is not None:
        base = settings["mpor_fixed_days"]
    elif pool:
        base = settings["mpor_pool_forced_sale_days"]
    else:
        liquid = security is None or security["liquidity_class"] == "liquid"
        base = settings["mpor_liquid_days"] if liquid else settings["mpor_other_days"]
        concentrated = pct_adv is not None and pct_adv > settings["concentration_threshold_pct_adv"]
        hard = security is not None and security["hard_to_borrow"] and settings["htb_uses_concentrated_period"]
        if concentrated or hard:
            base = max(base, settings["mpor_concentrated_days"])
    return int(base) + int(settings["addon_days"])


def resolve_all(snapshot: dict[str, Any]) -> list[EffectiveSettings]:
    profile = snapshot["closeout_profile"]
    securities = {s["id"]: s for s in snapshot["securities"]}
    rows: list[EffectiveSettings] = []

    def build(position_id: str, kind: str, borrower_id: str | None, security_id: str | None,
              quantity: float | None, bucket: str | None) -> None:
        security = securities.get(security_id) if security_id else None
        layers: list[tuple[str, dict[str, Any]]] = []
        if security is not None:
            layers.append(("asset_class", profile["asset_class_overrides"].get(security["asset_class"], {})))
        if bucket is not None:
            layers.append(("pool_bucket", profile["pool_bucket_overrides"].get(bucket, {})))
        if borrower_id is not None:
            layers.append(("borrower", profile["borrower_overrides"].get(borrower_id, {})))
        position_override = profile["position_overrides"].get(position_id, {})
        layers.append(("position", position_override))
        settings, levels = _merge(profile, layers)
        adv = position_override.get("adv_units", security["adv_units"] if security else None)
        vol = position_override.get("daily_vol", security["daily_vol"] if security else None)
        pct_adv = (quantity / adv * 100.0) if (quantity is not None and adv) else None
        mpor = _mpor(settings, pool=kind == "pool_position", security=security, pct_adv=pct_adv)
        rows.append(EffectiveSettings(position_id, kind, borrower_id, mpor, settings, levels, adv, vol))

    for loan in snapshot["loans"]:
        build(loan["id"], "loan", loan["borrower_id"], loan["security_id"], loan["quantity"], None)
    for holding in snapshot["collateral"]:
        build(holding["id"], "collateral", holding["borrower_id"], holding["security_id"],
              holding["quantity"], None)
    for position in snapshot["pool"]["positions"]:
        build(position["id"], "pool_position", None, None, None, position["liquidity_bucket"])
    return rows


def effective_settings(snapshot: dict[str, Any], position_id: str) -> EffectiveSettings:
    for row in resolve_all(snapshot):
        if row.position_id == position_id:
            return row
    raise KeyError(position_id)
