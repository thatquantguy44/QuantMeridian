"""Indemnification cost against fee (spec020 decision 6, IND-012).

For each borrower, in the annual view over 252 business days:

    cost (bps a year) = (EL + cost of capital * economic capital) / average loan value * 10,000

* Economic capital is the program's unexpected loss, ``VaR99.9 - EL`` of total annual loss, split
  among borrowers in proportion to their Euler expected-shortfall contributions (or their expected
  losses if the sample has no tail loss to split).
* The cost is shown beside the fee the borrower pays; a borrower is flagged when cost exceeds
  ``flag_threshold`` times the fee. Only the economic cost decides the flag.
* The regulatory proxy (Basel comprehensive-approach exposure x rating risk weight x 8%) goes
  through the same formula for comparison. It cannot see wrong-way risk or reinvestment losses and
  never decides.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .validation import RATING_ORDER

CAPITAL_RATIO = 0.08
BPS = 1e4


def risk_weight(rating: str, weights: dict[str, float]) -> float:
    if rating == "NR":
        return weights["unrated"]
    index = RATING_ORDER.index(rating)
    if index <= 3:  # AAA to AA-
        return weights["aaa_to_aa_minus"]
    if index <= 6:  # A+ to A-
        return weights["a_plus_to_a_minus"]
    if index <= 12:  # BBB+ to BB-
        return weights["bbb_plus_to_bb_minus"]
    return weights["below_bb_minus"]  # B+ and below


def allocate_capital(
    *, var999: float, program_el: float, euler: np.ndarray, el: np.ndarray
) -> np.ndarray:
    """Split the program's unexpected loss by Euler share (else by expected loss)."""
    unexpected = max(0.0, var999 - program_el)
    basis = euler if euler.sum() > 0 else el
    if unexpected == 0.0 or basis.sum() <= 0:
        return np.zeros(len(el))
    return unexpected * basis / basis.sum()


def price_borrower(
    *,
    el: float,
    capital: float,
    avg_loan_value: float,
    fee_bps: float,
    proxy_exposure: float,
    rating: str,
    pricing: dict[str, Any],
) -> dict[str, Any]:
    coc = pricing["cost_of_capital"]
    to_bps = BPS / avg_loan_value
    economic_cost = (el + coc * capital) * to_bps
    proxy_capital = proxy_exposure * risk_weight(rating, pricing["risk_weights"]) * CAPITAL_RATIO
    return {
        "average_loan_value": float(avg_loan_value),
        "fee_bps": float(fee_bps),
        "expected_loss_bps": float(el * to_bps),
        "economic_capital": float(capital),
        "economic_capital_cost_bps": float(coc * capital * to_bps),
        "indemnification_cost_bps": float(economic_cost),
        "regulatory_proxy_cost_bps": float((el + coc * proxy_capital) * to_bps),
        "flagged": bool(economic_cost > pricing["flag_threshold"] * fee_bps),
    }
