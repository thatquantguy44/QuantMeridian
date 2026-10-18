"""Market Lens Studio analytics engine."""

from .returns import compute_forward_returns, compute_rolling_returns, unconditional_baseline
from .drawdowns import detect_drawdowns, DrawdownEvent
from .event_study import run_event_study, EventStudyResult
from .all_time_highs import detect_all_time_highs, ath_forward_returns
from .volatility import detect_vix_spikes, panic_regime_detection
from .vix_event_studies import largest_vix_changes, vix_event_forward_returns

__all__ = [
    "compute_forward_returns", "compute_rolling_returns", "unconditional_baseline",
    "detect_drawdowns", "DrawdownEvent",
    "run_event_study", "EventStudyResult",
    "detect_all_time_highs", "ath_forward_returns",
    "detect_vix_spikes", "panic_regime_detection",
    "largest_vix_changes", "vix_event_forward_returns",
]
