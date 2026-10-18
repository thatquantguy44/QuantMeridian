"""Configuration for the news_nlp stage (env-driven, pydantic-settings)."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NEWS_NLP_", env_file=".env", extra="ignore")

    # Medallion data root (raw → silver → gold parquet, + a DuckDB file).
    data_dir: Path = Path("data")
    duckdb_path: Path = Path("data/news_nlp.duckdb")

    # Models (only loaded when the `nlp` extra is installed; else lexicon fallback).
    finbert_model: str = "ProsusAI/finbert"
    spacy_model: str = "en_core_web_sm"
    embed_model: str = "sentence-transformers/all-MiniLM-L6-v2"

    # Clustering: cosine-distance threshold for grouping related headlines.
    cluster_distance: float = 0.45

    # API
    host: str = "0.0.0.0"
    port: int = 8088

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def silver_dir(self) -> Path:
        return self.data_dir / "silver"

    @property
    def gold_dir(self) -> Path:
        return self.data_dir / "gold"


settings = Settings()
