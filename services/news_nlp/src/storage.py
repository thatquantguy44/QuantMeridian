"""Gold-table persistence — parquet + a DuckDB view layer the API/Next can read."""
from __future__ import annotations

import json

import structlog

from .schema import NewsCluster, ScoredHeadline
from .settings import settings

log = structlog.get_logger(__name__)


def _ensure_dirs() -> None:
    for d in (settings.raw_dir, settings.silver_dir, settings.gold_dir):
        d.mkdir(parents=True, exist_ok=True)


def write_gold(scored: list[ScoredHeadline], clusters: list[NewsCluster]) -> None:
    """Write silver (scored headlines) + gold (clusters) as parquet and register DuckDB views."""
    _ensure_dirs()
    import polars as pl

    headlines_df = pl.DataFrame([s.model_dump() for s in scored])
    clusters_df = pl.DataFrame([c.model_dump() for c in clusters])

    headlines_path = settings.silver_dir / "news_scored.parquet"
    clusters_path = settings.gold_dir / "news_clusters.parquet"
    headlines_df.write_parquet(headlines_path)
    clusters_df.write_parquet(clusters_path)

    # Also drop a JSON export the Next route can read via a file mount (NEWS_NLP_DIR).
    (settings.gold_dir / "news_scored.json").write_text(json.dumps([s.model_dump() for s in scored]))

    try:
        import duckdb

        con = duckdb.connect(str(settings.duckdb_path))
        con.execute(
            f"CREATE OR REPLACE VIEW analytics_news_sentiment AS SELECT * FROM read_parquet('{headlines_path}')"
        )
        con.execute(
            f"CREATE OR REPLACE VIEW analytics_news_clusters AS SELECT * FROM read_parquet('{clusters_path}')"
        )
        con.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("duckdb view registration skipped", error=str(exc))

    log.info("wrote gold tables", scored=len(scored), clusters=len(clusters))
