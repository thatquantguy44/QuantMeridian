"""Load layer — write gold/silver Parquet into DuckDB (PostgreSQL optional).

DuckDB reads Parquet natively, so loading is mostly a matter of upserting the
silver observations into a durable table and registering the gold tables as
queryable views/tables for the terminal's API.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import polars as pl

from macro_data_etl.src.utils.logging import get_logger

logger = get_logger(__name__)


class DuckDBLoader:
    """Loads silver + gold Parquet into a DuckDB database."""

    def __init__(self, db_path: str = "./data/macro.duckdb") -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = duckdb.connect(db_path)
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS macro_observations (
                observation_id VARCHAR PRIMARY KEY,
                source VARCHAR NOT NULL,
                country_iso3 VARCHAR NOT NULL,
                country_name VARCHAR,
                region VARCHAR,
                indicator VARCHAR NOT NULL,
                frequency VARCHAR,
                date DATE NOT NULL,
                value DOUBLE,
                unit VARCHAR,
                prior_value DOUBLE,
                revision_from DOUBLE,
                vintage_date DATE,
                is_preliminary BOOLEAN DEFAULT FALSE,
                fetched_at VARCHAR,
                quality_flag VARCHAR
            )
            """
        )

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def load_silver(self, silver_path: Path) -> int:
        """Upsert silver observations (idempotent on observation_id)."""
        silver_path = Path(silver_path)
        if not silver_path.exists():
            logger.warning("silver path missing: %s", silver_path)
            return 0
        safe = str(silver_path).replace("'", "''")
        self.conn.execute(
            f"CREATE OR REPLACE TEMP VIEW _incoming AS SELECT * FROM read_parquet('{safe}')"
        )
        # delete-then-insert upsert keyed on observation_id
        self.conn.execute(
            """
            DELETE FROM macro_observations
            WHERE observation_id IN (SELECT observation_id FROM _incoming)
            """
        )
        self.conn.execute(
            "INSERT INTO macro_observations BY NAME SELECT * FROM _incoming"
        )
        n = self.conn.execute("SELECT count(*) FROM _incoming").fetchone()[0]
        logger.info("load_silver: upserted %d observations", n)
        return int(n)

    def load_gold(self, gold_paths: dict[str, Path]) -> None:
        """Register each gold Parquet as a DuckDB table."""
        for name, path in gold_paths.items():
            path = Path(path)
            if not path.exists():
                logger.warning("gold table %s missing at %s", name, path)
                continue
            safe = str(path).replace("'", "''")
            self.conn.execute(
                f'CREATE OR REPLACE TABLE "{name}" AS SELECT * FROM read_parquet(\'{safe}\')'
            )
            n = self.conn.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            logger.info("load_gold: %s -> %d rows", name, n)

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def query(self, sql: str) -> pl.DataFrame:
        """Run arbitrary SQL and return a Polars DataFrame."""
        return self.conn.execute(sql).pl()

    def get_latest_by_country(self) -> pl.DataFrame:
        """Latest snapshot per country from the gold table if present, else silver."""
        tables = [r[0] for r in self.conn.execute("SHOW TABLES").fetchall()]
        if "country_macro_latest" in tables:
            return self.query("SELECT * FROM country_macro_latest ORDER BY policy_rate DESC")
        return self.query(
            """
            SELECT country_iso3, country_name, region, indicator,
                   last(value ORDER BY date) AS value,
                   max(date) AS as_of
            FROM macro_observations
            GROUP BY country_iso3, country_name, region, indicator
            """
        )

    def table_counts(self) -> dict[str, int]:
        """Row counts for every table — used by `status`."""
        out: dict[str, int] = {}
        for (t,) in self.conn.execute("SHOW TABLES").fetchall():
            out[t] = int(self.conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0])
        return out

    def export_json(self, table: str, out_path: Path) -> Path:
        """Export a gold table to JSON for the terminal's static data feed."""
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        df = self.query(f'SELECT * FROM "{table}"')
        df.write_json(out_path)
        logger.info("export_json: %s -> %s (%d rows)", table, out_path, df.height)
        return out_path

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> DuckDBLoader:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class PostgresLoader:
    """Optional PostgreSQL loader (requires the ``postgres`` extra)."""

    def __init__(self, dsn: str) -> None:
        try:
            import psycopg  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "PostgreSQL support requires `pip install macro-data-etl[postgres]`"
            ) from e
        self.dsn = dsn

    def load_silver(self, silver_path: Path) -> int:  # pragma: no cover - optional
        import psycopg

        df = pl.read_parquet(silver_path)
        rows = df.to_dicts()
        if not rows:
            return 0
        cols = list(rows[0].keys())
        placeholders = ", ".join(["%s"] * len(cols))
        collist = ", ".join(cols)
        sql = (
            f"INSERT INTO macro_observations ({collist}) VALUES ({placeholders}) "
            f"ON CONFLICT (observation_id) DO UPDATE SET "
            f"value = EXCLUDED.value, vintage_date = EXCLUDED.vintage_date"
        )
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.executemany(sql, [[r[c] for c in cols] for r in rows])
            conn.commit()
        return len(rows)
