"""Orchestration — raw headlines → silver (scored) → gold (clusters)."""
from __future__ import annotations

import json
from pathlib import Path

import structlog

from . import entities, sentiment
from .cluster import cluster
from .schema import RawHeadline, ScoredHeadline
from .settings import settings
from .storage import write_gold

log = structlog.get_logger(__name__)

_CRYPTO = {"BTC", "ETH", "COIN"}
_RATES = {"TLT", "IEF", "SHY"}
_CREDIT = {"HYG", "LQD"}
_CMDTY = {"GLD", "USO"}


def _asset_class(tickers: list[str], text: str) -> str:
    s = set(tickers)
    if s & _CRYPTO:
        return "CRYPTO"
    if s & _RATES or "treasury" in text.lower() or "yield" in text.lower():
        return "RATES"
    if s & _CREDIT or "credit" in text.lower() or "spread" in text.lower():
        return "CREDIT"
    if s & _CMDTY or "oil" in text.lower() or "gold" in text.lower():
        return "COMMODITY"
    return "EQUITY"


def load_raw(path: Path | None = None) -> list[RawHeadline]:
    """Load raw headlines from a JSON file (array of {id, headline, ...})."""
    p = path or (settings.raw_dir / "headlines.json")
    if not p.exists():
        log.warning("no raw headlines found", path=str(p))
        return []
    return [RawHeadline(**row) for row in json.loads(p.read_text())]


def score_headlines(raw: list[RawHeadline]) -> list[ScoredHeadline]:
    items = sentiment.score_texts([r.headline for r in raw])
    scored: list[ScoredHeadline] = []
    for r, it in zip(raw, items):
        tickers, ents = entities.extract(r.headline)
        merged = sorted(set(r.tickers) | set(tickers))
        scored.append(
            ScoredHeadline(
                id=r.id,
                headline=r.headline,
                source=r.source,
                published_at=r.published_at,
                sentimentScore=it.score,
                sentiment=it.label,
                assetClass=_asset_class(merged, r.headline),  # type: ignore[arg-type]
                tickers=merged,
                entities=ents,
            )
        )
    return scored


def run(raw_path: Path | None = None) -> dict:
    """Full pass: load → score+NER → cluster → persist gold."""
    raw = load_raw(raw_path)
    scored = score_headlines(raw)
    clusters = cluster(scored)
    write_gold(scored, clusters)
    return {"model": sentiment.model_name(), "scored": len(scored), "clusters": len(clusters)}
