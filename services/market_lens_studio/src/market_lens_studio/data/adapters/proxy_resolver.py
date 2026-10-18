"""ETF proxy resolution and validation."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ProxyMapping:
    """Maps an index/asset to its ETF proxy."""

    index_name: str
    proxy_ticker: str
    proxy_display_name: str
    inception_date: str
    proxy_note: str


# Master mapping of index names to ETF proxies
_PROXY_MAP: dict[str, ProxyMapping] = {
    "S&P 500 Index": ProxyMapping(
        "S&P 500 Index", "SPY", "SPDR S&P 500 ETF", "1993-01-22",
        "SPY tracks S&P 500; data starts Jan 1993",
    ),
    "Nasdaq 100 Index": ProxyMapping(
        "Nasdaq 100 Index", "QQQ", "Invesco QQQ Trust", "1999-03-10",
        "QQQ tracks Nasdaq 100; data starts Mar 1999",
    ),
    "Russell 2000 Index": ProxyMapping(
        "Russell 2000 Index", "IWM", "iShares Russell 2000 ETF", "2000-05-22",
        "IWM tracks Russell 2000; data starts May 2000",
    ),
    "Dow Jones Industrial Average": ProxyMapping(
        "Dow Jones Industrial Average", "DIA", "SPDR Dow Jones ETF", "1998-01-14",
        "DIA tracks DJIA; data starts Jan 1998",
    ),
    "S&P 500 Equal Weight Index": ProxyMapping(
        "S&P 500 Equal Weight Index", "RSP", "Invesco S&P 500 Equal Weight ETF", "2003-04-24",
        "RSP tracks S&P 500 Equal Weight; data starts Apr 2003",
    ),
    "US 20+ Year Treasury Bonds": ProxyMapping(
        "US 20+ Year Treasury Bonds", "TLT", "iShares 20+ Year Treasury Bond ETF", "2002-07-22",
        "TLT tracks long-duration Treasuries; data starts Jul 2002",
    ),
    "US 7-10 Year Treasury Bonds": ProxyMapping(
        "US 7-10 Year Treasury Bonds", "IEF", "iShares 7-10 Year Treasury Bond ETF", "2002-07-22",
        "IEF tracks intermediate Treasuries; data starts Jul 2002",
    ),
    "US 1-3 Year Treasury Bonds": ProxyMapping(
        "US 1-3 Year Treasury Bonds", "SHY", "iShares 1-3 Year Treasury Bond ETF", "2002-07-22",
        "SHY tracks short-duration Treasuries; data starts Jul 2002",
    ),
    "US Treasury Bills": ProxyMapping(
        "US Treasury Bills", "BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "2007-05-25",
        "BIL tracks T-Bills; data starts May 2007",
    ),
    "High Yield Corporate Bonds": ProxyMapping(
        "High Yield Corporate Bonds", "HYG", "iShares iBoxx High Yield Corporate Bond ETF", "2007-04-04",
        "HYG tracks HY corporate bonds; data starts Apr 2007",
    ),
    "High Yield Bonds (JNK)": ProxyMapping(
        "High Yield Bonds (JNK)", "JNK", "SPDR Bloomberg High Yield Bond ETF", "2007-11-28",
        "JNK tracks HY bonds; data starts Nov 2007",
    ),
    "Investment Grade Corporate Bonds": ProxyMapping(
        "Investment Grade Corporate Bonds", "LQD", "iShares iBoxx IG Corporate Bond ETF", "2002-07-22",
        "LQD tracks IG corporate bonds; data starts Jul 2002",
    ),
    "Gold": ProxyMapping(
        "Gold", "GLD", "SPDR Gold Shares", "2004-11-18",
        "GLD tracks gold price; data starts Nov 2004",
    ),
    "Crude Oil": ProxyMapping(
        "Crude Oil", "USO", "United States Oil Fund", "2006-04-10",
        "USO tracks front-month WTI crude; contango drag caveat; data starts Apr 2006",
    ),
    "International Developed Markets": ProxyMapping(
        "International Developed Markets", "EFA", "iShares MSCI EAFE ETF", "2001-08-14",
        "EFA tracks developed ex-US equities; data starts Aug 2001",
    ),
    "Emerging Markets": ProxyMapping(
        "Emerging Markets", "EEM", "iShares MSCI Emerging Markets ETF", "2003-04-07",
        "EEM tracks emerging market equities; data starts Apr 2003",
    ),
    "Global All-Country Equities": ProxyMapping(
        "Global All-Country Equities", "ACWI", "iShares MSCI ACWI ETF", "2008-03-26",
        "ACWI tracks global equities; data starts Mar 2008",
    ),
    "US REITs": ProxyMapping(
        "US REITs", "VNQ", "Vanguard Real Estate ETF", "2004-09-23",
        "VNQ tracks US REITs; data starts Sep 2004",
    ),
    "CBOE Volatility Index": ProxyMapping(
        "CBOE Volatility Index", "^VIX", "CBOE VIX Index", "1990-01-02",
        "VIX is not directly investable; VIXY/VXX are futures-based and suffer decay",
    ),
}


@dataclass
class ProxyResult:
    """Result of proxy resolution."""

    ticker: str
    display_name: str
    is_proxy: bool
    proxy_for: str = ""
    proxy_note: str = ""
    warnings: list[str] = field(default_factory=list)


class ProxyResolver:
    """Resolves index names to ETF proxies and generates warnings."""

    def __init__(self, allow_proxies: bool = True, require_labeling: bool = True):
        self.allow_proxies = allow_proxies
        self.require_labeling = require_labeling

    def resolve(self, name_or_ticker: str) -> ProxyResult:
        """Resolve a name or ticker to its proxy (if applicable).

        Args:
            name_or_ticker: Index name like 'S&P 500 Index' or ticker like 'SPY'.

        Returns:
            ProxyResult with resolution details.
        """
        # Direct lookup by index name
        if name_or_ticker in _PROXY_MAP:
            mapping = _PROXY_MAP[name_or_ticker]
            warnings = []
            if self.require_labeling:
                warnings.append(
                    f"Using {mapping.proxy_ticker} as proxy for {name_or_ticker}. "
                    f"{mapping.proxy_note}"
                )
            return ProxyResult(
                ticker=mapping.proxy_ticker,
                display_name=mapping.proxy_display_name,
                is_proxy=True,
                proxy_for=name_or_ticker,
                proxy_note=mapping.proxy_note,
                warnings=warnings,
            )

        # Check if it's already a proxy ticker
        for idx_name, mapping in _PROXY_MAP.items():
            if mapping.proxy_ticker.upper() == name_or_ticker.upper():
                return ProxyResult(
                    ticker=mapping.proxy_ticker,
                    display_name=mapping.proxy_display_name,
                    is_proxy=True,
                    proxy_for=idx_name,
                    proxy_note=mapping.proxy_note,
                    warnings=[],
                )

        # Not a known proxy - treat as direct ticker
        return ProxyResult(
            ticker=name_or_ticker,
            display_name=name_or_ticker,
            is_proxy=False,
        )

    def get_all_proxies(self) -> dict[str, ProxyMapping]:
        """Return the full proxy mapping dictionary."""
        return dict(_PROXY_MAP)

    def validate_proxy(self, ticker: str) -> bool:
        """Check if a ticker is a known proxy."""
        for mapping in _PROXY_MAP.values():
            if mapping.proxy_ticker.upper() == ticker.upper():
                return True
        return False

    def get_lineage(self, ticker: str) -> dict:
        """Return lineage information for a proxy ticker."""
        for idx_name, mapping in _PROXY_MAP.items():
            if mapping.proxy_ticker.upper() == ticker.upper():
                return {
                    "ticker": mapping.proxy_ticker,
                    "proxy_for": idx_name,
                    "inception_date": mapping.inception_date,
                    "note": mapping.proxy_note,
                    "is_proxy": True,
                }
        return {"ticker": ticker, "is_proxy": False}
