"""Pydantic v2 configuration schemas for Market Lens Studio."""

from __future__ import annotations

import re
from datetime import date, datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Enums ────────────────────────────────────────────────────────────────

class EventType(str, Enum):
    """Supported event detection types."""
    ALL_TIME_HIGH = "all_time_high"
    DRAWDOWN_THRESHOLD = "drawdown_threshold"
    VOLATILITY_SPIKE = "volatility_spike"
    LARGEST_VIX_INCREASE = "largest_vix_increase"
    LARGEST_VIX_DECREASE = "largest_vix_decrease"
    YIELD_CURVE_INVERSION = "yield_curve_inversion"
    SPREAD_WIDENING = "spread_widening"
    INFLATION_SURPRISE = "inflation_surprise"
    ROLLING_RETURN_PERCENTILE = "rolling_return_percentile"
    ZSCORE_THRESHOLD = "zscore_threshold"
    MA_CROSSOVER = "ma_crossover"
    RELATIVE_STRENGTH_BREAKOUT = "relative_strength_breakout"
    CUSTOM = "custom"


class ChartType(str, Enum):
    """Supported front-end chart types."""
    TABLE = "table"
    LINE = "line"
    LINE_WITH_MARKERS = "line_with_markers"
    BAR = "bar"
    BOXPLOT = "boxplot"
    HEATMAP = "heatmap"
    SCATTER = "scatter"
    TEXT = "text"
    GAUGE = "gauge"
    WATERFALL = "waterfall"


class VixChangePeriod(str, Enum):
    """Periods for measuring VIX changes."""
    ONE_DAY = "1D"
    ONE_WEEK = "1W"
    TWO_WEEKS = "2W"
    ONE_MONTH = "1M"

    @property
    def trading_days(self) -> int:
        """Convert period to approximate trading days."""
        mapping = {
            "1D": 1,
            "1W": 5,
            "2W": 10,
            "1M": 21,
        }
        return mapping[self.value]


class ReturnType(str, Enum):
    """Return calculation methodology."""
    PRICE = "price"
    TOTAL = "total"
    EXCESS = "excess"
    REAL = "real"


# ── Forward Window ───────────────────────────────────────────────────────

_WINDOW_PATTERN = re.compile(r"^(\d+)([DWMY])$")

_UNIT_TO_TRADING_DAYS = {
    "D": 1,
    "W": 5,
    "M": 21,
    "Y": 252,
}


class ForwardWindow(BaseModel):
    """A forward-looking time window parsed from human-friendly strings."""

    label: str = Field(..., description="Original string like '1W', '3M', '1Y'")
    trading_days: int = Field(..., gt=0)

    @classmethod
    def from_str(cls, s: str) -> "ForwardWindow":
        """Parse a window string such as '1W', '3M', '5Y' into trading days."""
        s = s.strip().upper()
        m = _WINDOW_PATTERN.match(s)
        if not m:
            raise ValueError(f"Invalid window string: {s!r}. Expected format like '1W', '3M', '1Y'.")
        count = int(m.group(1))
        unit = m.group(2)
        return cls(label=s, trading_days=count * _UNIT_TO_TRADING_DAYS[unit])

    def __hash__(self) -> int:
        return hash(self.label)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ForwardWindow):
            return self.label == other.label
        return NotImplemented


# ── Series Config ────────────────────────────────────────────────────────

class SeriesConfig(BaseModel):
    """Configuration for a single data series."""

    series_id: str
    ticker: str = ""
    source: str = "yahoo"
    display_name: str = ""
    asset_class: str = "EQUITY"
    is_proxy: bool = False
    proxy_for: str = ""
    proxy_note: str = ""

    @model_validator(mode="after")
    def _default_display(self) -> "SeriesConfig":
        if not self.display_name:
            self.display_name = self.ticker or self.series_id
        return self


# ── Event Rule ───────────────────────────────────────────────────────────

class EventRule(BaseModel):
    """Configurable rule for detecting market events."""

    event_type: EventType
    threshold: Optional[float] = None
    cooldown_days: int = Field(default=5, ge=0)
    change_window: Optional[str] = None
    largest_event_count: int = Field(default=20, ge=1)
    percentile: Optional[float] = Field(default=None, ge=0, le=100)
    z_score: Optional[float] = None
    ma_short: Optional[int] = None
    ma_long: Optional[int] = None

    @field_validator("change_window")
    @classmethod
    def _validate_window(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            ForwardWindow.from_str(v)
        return v


# ── Proxy Policy ─────────────────────────────────────────────────────────

class ProxyPolicy(BaseModel):
    """Controls ETF proxy usage."""

    allow_etf_proxies: bool = True
    require_labeling: bool = True


# ── View Config ──────────────────────────────────────────────────────────

class ViewConfig(BaseModel):
    """Definition of a pre-canned analysis view."""

    view_id: str
    display_name: str
    category: str = ""
    description: str = ""
    default_series: list[str] = Field(default_factory=list)
    default_tiles: list[str] = Field(default_factory=list)
    configurable_fields: list[str] = Field(default_factory=list)
    compatible_series_types: list[str] = Field(default_factory=list)
    default_event_rule: Optional[EventRule] = None
    default_forward_windows: list[str] = Field(default_factory=lambda: ["1W", "1M", "3M", "6M", "1Y"])


# ── Tile Payload ─────────────────────────────────────────────────────────

class TilePayload(BaseModel):
    """A single tile/card returned in an analysis result."""

    tile_id: str
    chart_type: ChartType
    title: str
    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


# ── Analysis Request / Result ────────────────────────────────────────────

class AnalysisRequest(BaseModel):
    """Full request to run a Market Lens analysis."""

    view_id: str
    series: list[SeriesConfig] = Field(default_factory=list)
    event_rule: Optional[EventRule] = None
    forward_windows: list[str] = Field(default_factory=lambda: ["1W", "1M", "3M", "6M", "1Y"])
    selected_tiles: list[str] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)
    proxy_policy: ProxyPolicy = Field(default_factory=ProxyPolicy)
    return_type: ReturnType = ReturnType.PRICE
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    def parsed_windows(self) -> list[ForwardWindow]:
        """Parse forward_windows strings into ForwardWindow objects."""
        return [ForwardWindow.from_str(w) for w in self.forward_windows]


class AnalysisResult(BaseModel):
    """Complete result of a Market Lens analysis run."""

    view_id: str
    tiles: list[TilePayload] = Field(default_factory=list)
    series_used: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    narrative: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    run_timestamp: datetime = Field(default_factory=datetime.utcnow)
    as_of_date: Optional[date] = None
    sample_size: int = 0


# ── Preset Config ────────────────────────────────────────────────────────

class PresetConfig(BaseModel):
    """A saved user preset that can be recalled."""

    preset_id: str = ""
    user_id: str = "default"
    name: str
    description: str = ""
    request: AnalysisRequest
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tags: list[str] = Field(default_factory=list)
