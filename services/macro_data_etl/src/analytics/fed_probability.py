"""Fed Funds Futures -> FOMC meeting probability engine.

Replicates the CME FedWatch methodology:

1. From 30-day Fed Funds Futures settlement prices, derive the implied average
   effective rate for each contract month: ``implied_rate = 100 - settle_price``.
2. For each FOMC meeting, the contract month that brackets the meeting date has a
   monthly-average rate that blends the pre-meeting rate (for the days before the
   meeting) and the post-meeting rate (for the days after). Day-weighting inverts
   that blend to recover the implied post-meeting rate.
3. From the implied post-meeting rate we distribute probability across the
   discrete 25bp target outcomes the FOMC can choose.
4. Forward meetings chain: the expected rate resolved at one meeting becomes the
   pre-meeting rate for the next.
"""

from __future__ import annotations

import calendar
import json
from dataclasses import dataclass
from datetime import date


@dataclass
class FOMCMeeting:
    """A scheduled FOMC decision."""

    date: date
    month_contract: str  # e.g. "Jul2026"
    current_rate: float  # effective rate going into this meeting


@dataclass
class MeetingProbability:
    """Probability distribution of outcomes for a single meeting."""

    meeting_date: date
    outcomes: dict[float, float]  # target midpoint rate -> probability
    expected_rate: float
    cut_prob: float
    hold_prob: float
    hike_prob: float
    implied_move_bps: float


class FedProbabilityEngine:
    """Derives FOMC hike/cut/hold probabilities from Fed Funds Futures.

    Two distribution methods:

    * :meth:`two_outcome_probability` — assumes the meeting resolves to one of two
      adjacent 25bp outcomes (the classic CME binary interpolation).
    * :meth:`multi_outcome_distribution` — spreads probability across a ladder of
      25bp outcomes around the pre-meeting rate.
    """

    STEP_BPS = 25  # standard Fed move increment (basis points)

    def __init__(
        self, current_target_low: float = 4.00, current_target_high: float = 4.25
    ) -> None:
        self.target_low = current_target_low
        self.target_high = current_target_high
        # Effective fed funds typically trades a few bp inside the target midpoint.
        self.effective_rate = (current_target_low + current_target_high) / 2 + 0.08
        self.meetings: list[date] = []

    # ------------------------------------------------------------------
    # Calendar / conversions
    # ------------------------------------------------------------------

    def set_fomc_calendar(self, meetings: list[date]) -> None:
        """Register the FOMC meeting dates used for the probability chain."""
        self.meetings = sorted(meetings)

    def implied_rate_from_futures(self, settlement_price: float) -> float:
        """Convert a futures settlement price to the implied average rate."""
        return 100.0 - settlement_price

    @staticmethod
    def _next_month_label(d: date) -> str:
        """Contract label ("%b%Y") for the month after ``d``."""
        year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
        return date(year, month, 1).strftime("%b%Y")

    def day_weighted_rate(
        self,
        meeting_day: int,
        days_in_month: int,
        month_implied: float,
        rate_before: float,
    ) -> float:
        """Recover the implied post-meeting rate via day-weighting.

        ``month_implied`` is a weighted average of ``rate_before`` (for the
        ``meeting_day`` days before the decision takes effect) and ``rate_after``
        (for the remaining days). Inverting::

            rate_after = (N * month_implied - meeting_day * rate_before)
                         / (N - meeting_day)

        where ``N = days_in_month``.
        """
        days_after = days_in_month - meeting_day
        if days_after <= 0:
            return month_implied
        return (days_in_month * month_implied - meeting_day * rate_before) / days_after

    # ------------------------------------------------------------------
    # Distribution methods
    # ------------------------------------------------------------------

    def two_outcome_probability(
        self,
        rate_before: float,
        rate_after: float,
        outcome_high: float,
        outcome_low: float,
    ) -> tuple[float, float]:
        """Binary interpolation between two adjacent outcomes.

        Returns ``(prob_high, prob_low)``.
        """
        if abs(outcome_high - outcome_low) < 1e-10:
            return (1.0, 0.0)
        p_low = (outcome_high - rate_after) / (outcome_high - outcome_low)
        p_low = max(0.0, min(1.0, p_low))
        return (1.0 - p_low, p_low)

    def multi_outcome_distribution(
        self, rate_before: float, rate_after: float, n_outcomes: int = 7
    ) -> dict[float, float]:
        """Distribute probability across a 25bp ladder around ``rate_before``.

        The ladder is centred on ``rate_before`` (so for ``n_outcomes=7`` it spans
        -75bp..+75bp). ``rate_after`` is located within the ladder and the two
        bracketing rungs split the probability by linear interpolation.
        """
        step = self.STEP_BPS / 100
        mid_idx = n_outcomes // 2
        outcomes = [round(rate_before + (i - mid_idx) * step, 4) for i in range(n_outcomes)]
        probs = {o: 0.0 for o in outcomes}

        if rate_after <= outcomes[0]:
            probs[outcomes[0]] = 1.0
        elif rate_after >= outcomes[-1]:
            probs[outcomes[-1]] = 1.0
        else:
            for i in range(len(outcomes) - 1):
                lo, hi = outcomes[i], outcomes[i + 1]
                if lo <= rate_after <= hi:
                    p_upper = (rate_after - lo) / (hi - lo)
                    probs[lo] += 1.0 - p_upper
                    probs[hi] += p_upper
                    break

        return {k: round(v, 6) for k, v in probs.items() if v > 0.0001}

    # ------------------------------------------------------------------
    # Full chain
    # ------------------------------------------------------------------

    def compute_meeting_probabilities(
        self,
        futures_prices: dict[str, float],
        meetings: list[date] | None = None,
    ) -> list[MeetingProbability]:
        """Compute the full probability chain across FOMC meetings.

        ``futures_prices`` maps a contract-month label (``"%b%Y"``, e.g.
        ``"Jul2026"``) to the futures settlement price.
        """
        if meetings is None:
            meetings = self.meetings

        results: list[MeetingProbability] = []
        rate_before = self.effective_rate

        for mtg_date in sorted(meetings):
            month_label = mtg_date.strftime("%b%Y")
            if month_label not in futures_prices:
                continue

            settlement = futures_prices[month_label]
            month_implied = self.implied_rate_from_futures(settlement)
            days_in_month = calendar.monthrange(mtg_date.year, mtg_date.month)[1]
            days_after = days_in_month - mtg_date.day

            # Day-weighting is numerically unstable when a meeting sits in the
            # last week of the month (tiny denominator). Following CME's
            # methodology, for late-month meetings use the *next* month's
            # contract — which fully reflects the post-meeting rate — directly.
            next_label = self._next_month_label(mtg_date)
            if days_after < 7 and next_label in futures_prices:
                rate_after = self.implied_rate_from_futures(futures_prices[next_label])
            else:
                rate_after = self.day_weighted_rate(
                    mtg_date.day, days_in_month, month_implied, rate_before
                )

            distribution = self.multi_outcome_distribution(rate_before, rate_after)
            expected = sum(rate * prob for rate, prob in distribution.items())
            implied_move = (expected - rate_before) * 100  # bps

            cut_prob = sum(p for r, p in distribution.items() if r < rate_before - 0.001)
            hold_prob = sum(p for r, p in distribution.items() if abs(r - rate_before) <= 0.001)
            hike_prob = sum(p for r, p in distribution.items() if r > rate_before + 0.001)

            results.append(
                MeetingProbability(
                    meeting_date=mtg_date,
                    outcomes=distribution,
                    expected_rate=round(expected, 4),
                    cut_prob=round(cut_prob, 4),
                    hold_prob=round(hold_prob, 4),
                    hike_prob=round(hike_prob, 4),
                    implied_move_bps=round(implied_move, 1),
                )
            )
            rate_before = expected

        return results

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_dataframe(self, results: list[MeetingProbability], as_of: date | None = None):
        """Convert results to a Polars DataFrame for the gold layer.

        ``as_of`` stamps the futures-pricing date the probabilities were derived
        from (defaults to today) so the terminal can show a clear data-as-of.
        """
        import polars as pl

        stamp = (as_of or date.today()).isoformat()
        rows = [
            {
                "meeting_date": r.meeting_date,
                "expected_rate": r.expected_rate,
                "cut_prob": r.cut_prob,
                "hold_prob": r.hold_prob,
                "hike_prob": r.hike_prob,
                "implied_move_bps": r.implied_move_bps,
                "outcomes_json": json.dumps({f"{k:.2f}": v for k, v in r.outcomes.items()}),
                "as_of": stamp,
            }
            for r in results
        ]
        return pl.DataFrame(rows)

    def vintage_snapshot(
        self, results: list[MeetingProbability], as_of: date | None = None
    ) -> dict:
        """Create a vintage snapshot of the full curve for historical tracking."""
        as_of = as_of or date.today()
        return {
            "as_of": as_of.isoformat(),
            "target_range": f"{self.target_low:.2f}-{self.target_high:.2f}%",
            "effective_rate": round(self.effective_rate, 4),
            "meetings": [
                {
                    "date": r.meeting_date.isoformat(),
                    "cut": r.cut_prob,
                    "hold": r.hold_prob,
                    "hike": r.hike_prob,
                    "expected_rate": r.expected_rate,
                    "move_bps": r.implied_move_bps,
                    "outcomes": {f"{k:.2f}": v for k, v in r.outcomes.items()},
                }
                for r in results
            ],
        }


# Reference 2025-2026 FOMC meeting calendar (decision dates).
FOMC_CALENDAR_2025_2026: list[date] = [
    date(2025, 1, 29),
    date(2025, 3, 19),
    date(2025, 5, 7),
    date(2025, 6, 18),
    date(2025, 7, 30),
    date(2025, 9, 17),
    date(2025, 10, 29),
    date(2025, 12, 10),
    date(2026, 1, 28),
    date(2026, 3, 18),
    date(2026, 4, 29),
    date(2026, 6, 17),
    date(2026, 7, 29),
    date(2026, 9, 16),
    date(2026, 10, 28),
    date(2026, 12, 9),
]
