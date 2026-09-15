"""Master series catalog with proxy mappings and metadata."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class CatalogEntry:
    """A single entry in the series catalog."""

    series_id: str
    ticker: str
    yahoo_ticker: str = ""
    fred_id: str = ""
    display_name: str = ""
    asset_class: str = "EQUITY"
    is_proxy: bool = False
    proxy_for: str = ""
    proxy_note: str = ""
    preferred_source: str = "yahoo"
    fallback_source: str = ""


def _e(
    series_id: str,
    ticker: str,
    display_name: str,
    asset_class: str = "EQUITY",
    yahoo_ticker: str = "",
    fred_id: str = "",
    is_proxy: bool = False,
    proxy_for: str = "",
    proxy_note: str = "",
    preferred_source: str = "yahoo",
    fallback_source: str = "",
) -> CatalogEntry:
    """Helper to build catalog entries."""
    return CatalogEntry(
        series_id=series_id,
        ticker=ticker,
        yahoo_ticker=yahoo_ticker or ticker,
        fred_id=fred_id,
        display_name=display_name,
        asset_class=asset_class,
        is_proxy=is_proxy,
        proxy_for=proxy_for,
        proxy_note=proxy_note,
        preferred_source=preferred_source,
        fallback_source=fallback_source,
    )


SERIES_CATALOG: dict[str, CatalogEntry] = {
    # ── Broad Equity ETFs ─────────────────────────────────────────────
    "SPY": _e("SPY", "SPY", "SPDR S&P 500 ETF", "EQUITY",
              is_proxy=True, proxy_for="S&P 500 Index",
              proxy_note="Tracks S&P 500; inception Jan 1993",
              preferred_source="gold"),
    "QQQ": _e("QQQ", "QQQ", "Invesco QQQ Trust", "EQUITY",
              is_proxy=True, proxy_for="Nasdaq 100 Index",
              proxy_note="Tracks Nasdaq 100; inception Mar 1999",
              preferred_source="gold"),
    "IWM": _e("IWM", "IWM", "iShares Russell 2000 ETF", "EQUITY",
              is_proxy=True, proxy_for="Russell 2000 Index",
              proxy_note="Tracks Russell 2000; inception May 2000",
              preferred_source="gold"),
    "DIA": _e("DIA", "DIA", "SPDR Dow Jones ETF", "EQUITY",
              is_proxy=True, proxy_for="Dow Jones Industrial Average",
              proxy_note="Tracks DJIA; inception Jan 1998",
              preferred_source="gold"),
    "RSP": _e("RSP", "RSP", "Invesco S&P 500 Equal Weight ETF", "EQUITY",
              is_proxy=True, proxy_for="S&P 500 Equal Weight Index",
              proxy_note="Tracks S&P 500 Equal Weight; inception Apr 2003",
              preferred_source="gold"),

    # ── International Equity ──────────────────────────────────────────
    "EFA": _e("EFA", "EFA", "iShares MSCI EAFE ETF", "EQUITY",
              is_proxy=True, proxy_for="International Developed Markets",
              proxy_note="Tracks developed ex-US; inception Aug 2001",
              preferred_source="gold"),
    "EEM": _e("EEM", "EEM", "iShares MSCI Emerging Markets ETF", "EQUITY",
              is_proxy=True, proxy_for="Emerging Markets",
              proxy_note="Tracks EM equities; inception Apr 2003",
              preferred_source="gold"),
    "ACWI": _e("ACWI", "ACWI", "iShares MSCI ACWI ETF", "EQUITY",
               is_proxy=True, proxy_for="Global All-Country Equities",
               proxy_note="Tracks global equities; inception Mar 2008",
               preferred_source="gold"),

    # ── Sector ETFs ───────────────────────────────────────────────────
    "XLK": _e("XLK", "XLK", "Technology Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLF": _e("XLF", "XLF", "Financial Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLE": _e("XLE", "XLE", "Energy Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLV": _e("XLV", "XLV", "Health Care Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLI": _e("XLI", "XLI", "Industrial Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLP": _e("XLP", "XLP", "Consumer Staples Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLU": _e("XLU", "XLU", "Utilities Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLY": _e("XLY", "XLY", "Consumer Discretionary Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLC": _e("XLC", "XLC", "Communication Services Select Sector SPDR", "EQUITY",
              preferred_source="gold"),
    "XLRE": _e("XLRE", "XLRE", "Real Estate Select Sector SPDR", "EQUITY",
               preferred_source="gold"),
    "XLB": _e("XLB", "XLB", "Materials Select Sector SPDR", "EQUITY",
              preferred_source="gold"),

    # ── Bond ETFs ─────────────────────────────────────────────────────
    "TLT": _e("TLT", "TLT", "iShares 20+ Year Treasury Bond ETF", "BOND",
              is_proxy=True, proxy_for="US 20+ Year Treasury Bonds",
              proxy_note="Tracks long-duration Treasuries; inception Jul 2002",
              preferred_source="gold"),
    "IEF": _e("IEF", "IEF", "iShares 7-10 Year Treasury Bond ETF", "BOND",
              is_proxy=True, proxy_for="US 7-10 Year Treasury Bonds",
              proxy_note="Tracks intermediate Treasuries; inception Jul 2002",
              preferred_source="gold"),
    "SHY": _e("SHY", "SHY", "iShares 1-3 Year Treasury Bond ETF", "BOND",
              is_proxy=True, proxy_for="US 1-3 Year Treasury Bonds",
              proxy_note="Tracks short-duration Treasuries; inception Jul 2002",
              preferred_source="gold"),
    "BIL": _e("BIL", "BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "BOND",
              is_proxy=True, proxy_for="US Treasury Bills",
              proxy_note="Tracks T-Bills; inception May 2007",
              preferred_source="gold"),

    # ── Credit ETFs ───────────────────────────────────────────────────
    "HYG": _e("HYG", "HYG", "iShares iBoxx High Yield Corporate Bond ETF", "CREDIT",
              is_proxy=True, proxy_for="High Yield Corporate Bonds",
              proxy_note="Tracks HY corporate bonds; inception Apr 2007",
              preferred_source="gold"),
    "JNK": _e("JNK", "JNK", "SPDR Bloomberg High Yield Bond ETF", "CREDIT",
              is_proxy=True, proxy_for="High Yield Bonds",
              proxy_note="Tracks HY bonds; inception Nov 2007",
              preferred_source="gold"),
    "LQD": _e("LQD", "LQD", "iShares iBoxx IG Corporate Bond ETF", "CREDIT",
              is_proxy=True, proxy_for="Investment Grade Corporate Bonds",
              proxy_note="Tracks IG corporate bonds; inception Jul 2002",
              preferred_source="gold"),

    # ── Commodity ETFs ────────────────────────────────────────────────
    "GLD": _e("GLD", "GLD", "SPDR Gold Shares", "COMMODITY",
              is_proxy=True, proxy_for="Gold",
              proxy_note="Tracks gold price; inception Nov 2004",
              preferred_source="gold"),
    "USO": _e("USO", "USO", "United States Oil Fund", "COMMODITY",
              is_proxy=True, proxy_for="Crude Oil",
              proxy_note="Tracks front-month WTI; contango drag; inception Apr 2006",
              preferred_source="gold"),

    # ── Real Estate ───────────────────────────────────────────────────
    "VNQ": _e("VNQ", "VNQ", "Vanguard Real Estate ETF", "EQUITY",
              is_proxy=True, proxy_for="US REITs",
              proxy_note="Tracks US REITs; inception Sep 2004",
              preferred_source="gold"),

    # ── Volatility ────────────────────────────────────────────────────
    "CBOE_VIX": _e("CBOE_VIX", "^VIX", "CBOE Volatility Index", "VOLATILITY",
                    yahoo_ticker="^VIX",
                    proxy_note="VIX is not directly investable",
                    preferred_source="gold"),
    "VIXY": _e("VIXY", "VIXY", "ProShares VIX Short-Term Futures ETF", "VOLATILITY",
               is_proxy=True, proxy_for="VIX Short-Term Futures",
               proxy_note="Futures-based; suffers contango decay",
               preferred_source="gold"),

    # ── FRED Macro Series ─────────────────────────────────────────────
    "FEDFUNDS": _e("FEDFUNDS", "FEDFUNDS", "Federal Funds Effective Rate", "MACRO_RATE",
                    fred_id="FEDFUNDS", preferred_source="fred"),
    "CPIAUCSL": _e("CPIAUCSL", "CPIAUCSL", "Consumer Price Index (All Urban)", "MACRO_INFLATION",
                    fred_id="CPIAUCSL", preferred_source="fred"),
    "DGS10": _e("DGS10", "DGS10", "10-Year Treasury Constant Maturity Rate", "MACRO_RATE",
                fred_id="DGS10", preferred_source="fred"),
    "DGS2": _e("DGS2", "DGS2", "2-Year Treasury Constant Maturity Rate", "MACRO_RATE",
               fred_id="DGS2", preferred_source="fred"),
    "T10Y2Y": _e("T10Y2Y", "T10Y2Y", "10-Year Minus 2-Year Treasury Spread", "MACRO_RATE",
                  fred_id="T10Y2Y", preferred_source="fred"),
    "BAMLH0A0HYM2": _e("BAMLH0A0HYM2", "BAMLH0A0HYM2",
                         "ICE BofA US High Yield OAS", "MACRO_CREDIT",
                         fred_id="BAMLH0A0HYM2", preferred_source="fred"),
    "UNRATE": _e("UNRATE", "UNRATE", "Unemployment Rate", "MACRO_LABOR",
                  fred_id="UNRATE", preferred_source="fred"),
    "GDP": _e("GDP", "GDP", "Gross Domestic Product", "MACRO_GROWTH",
              fred_id="GDP", preferred_source="fred"),
    "DXY": _e("DXY", "DX-Y.NYB", "US Dollar Index", "CURRENCY",
              yahoo_ticker="DX-Y.NYB"),
    "DTWEXBGS": _e("DTWEXBGS", "DTWEXBGS", "Trade Weighted Dollar Index (Broad)", "CURRENCY",
                    fred_id="DTWEXBGS", preferred_source="fred"),
}


class SeriesCatalog:
    """Object-oriented interface to the series catalog."""

    def __init__(self):
        self._entries = SERIES_CATALOG

    def get(self, series_id: str) -> CatalogEntry | None:
        return self._entries.get(series_id)

    def all_entries(self) -> list[CatalogEntry]:
        return list(self._entries.values())

    def search(self, query: str) -> list[CatalogEntry]:
        q = query.lower()
        return [
            e for e in self._entries.values()
            if q in e.series_id.lower()
            or q in e.ticker.lower()
            or q in e.display_name.lower()
            or q in e.asset_class.lower()
        ]

    def list_by_asset_class(self, asset_class: str) -> list[CatalogEntry]:
        return [e for e in self._entries.values() if e.asset_class == asset_class]


def get_entry(series_id: str) -> CatalogEntry | None:
    """Look up a catalog entry by series_id."""
    return SERIES_CATALOG.get(series_id)


def get_yahoo_ticker(series_id: str) -> str:
    """Get the Yahoo Finance ticker for a series."""
    entry = SERIES_CATALOG.get(series_id)
    if entry:
        return entry.yahoo_ticker
    return series_id


def get_fred_id(series_id: str) -> str:
    """Get the FRED series ID."""
    entry = SERIES_CATALOG.get(series_id)
    if entry and entry.fred_id:
        return entry.fred_id
    return series_id


def list_by_asset_class(asset_class: str) -> list[CatalogEntry]:
    """List all catalog entries matching an asset class."""
    return [e for e in SERIES_CATALOG.values() if e.asset_class == asset_class]


def list_all() -> list[CatalogEntry]:
    """List all catalog entries."""
    return list(SERIES_CATALOG.values())
