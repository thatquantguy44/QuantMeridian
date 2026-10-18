"""Adapter for reading from the Gold DB (fred-bronze-to-gold-pipeline)."""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)


class GoldAdapter:
    """Bridge between Market Lens Studio and the Gold DB (SQLite/Postgres)."""

    def __init__(self):
        """Initialize with MACRO_DB_URL from environment."""
        self._db_url = os.environ.get("MACRO_DB_URL", "")
        self._backend = self._detect_backend()
        self._connection = None

    def _detect_backend(self) -> str:
        """Detect DB backend from MACRO_DB_URL."""
        if not self._db_url:
            return "none"
        if self._db_url.startswith("postgres"):
            return "postgres"
        if self._db_url.startswith("sqlite"):
            return "sqlite"
        return "unknown"

    def _get_connection(self):
        """Get a database connection (lazy initialization)."""
        if self._connection is not None:
            return self._connection

        if self._backend == "sqlite":
            try:
                import sqlite3

                db_path = self._db_url.replace("sqlite:", "").strip()
                self._connection = sqlite3.connect(db_path)
                self._connection.row_factory = sqlite3.Row
                return self._connection
            except Exception as exc:
                logger.error("Failed to connect to SQLite: %s", exc)
                return None

        elif self._backend == "postgres":
            try:
                import psycopg2

                # Parse postgres://user:pass@host:port/dbname
                url = self._db_url.replace("postgres://", "").replace("postgresql://", "")
                # Simple parsing; production code should use urlparse
                self._connection = psycopg2.connect(self._db_url)
                return self._connection
            except Exception as exc:
                logger.error("Failed to connect to Postgres: %s", exc)
                return None

        return None

    def fetch_series(
        self,
        ticker: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> tuple[list[date], list[float]]:
        """Fetch an equity series from the Gold DB.

        Queries gold_equity_return_daily or gold_equity_total_return_index.

        Args:
            ticker: Equity ticker (e.g. 'SPY', 'QQQ')
            start_date: Optional start date filter
            end_date: Optional end date filter

        Returns:
            (dates, values) tuples, or ([], []) if not found
        """
        conn = self._get_connection()
        if not conn:
            logger.error("No database connection available")
            return [], []

        try:
            if self._backend == "sqlite":
                return self._fetch_sqlite(conn, ticker, start_date, end_date)
            elif self._backend == "postgres":
                return self._fetch_postgres(conn, ticker, start_date, end_date)
            else:
                logger.error("Unsupported backend: %s", self._backend)
                return [], []
        except Exception as exc:
            logger.error("Failed to fetch %s from Gold DB: %s", ticker, exc)
            return [], []

    def _fetch_sqlite(
        self,
        conn,
        ticker: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> tuple[list[date], list[float]]:
        """Fetch from SQLite Gold DB.

        Queries gold_equity_total_return_index (or gold_equity_return_daily).
        Uses close price, with fallback to price_return_index or total_return_index.
        """
        cursor = conn.cursor()

        # Query equity_total_return_index table
        # Try to get close, price_return_index, or total_return_index (in order of preference for returns analysis)
        query = """
            SELECT date,
                   COALESCE(close, price_return_index, total_return_index) as value
            FROM gold_equity_total_return_index
            WHERE ticker = ?
        """
        params = [ticker]

        if start_date:
            query += " AND date >= ?"
            params.append(start_date.isoformat())
        if end_date:
            query += " AND date <= ?"
            params.append(end_date.isoformat())

        query += " ORDER BY date ASC"

        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()

            if rows:
                dates = []
                values = []
                for row in rows:
                    try:
                        date_str = row[0]
                        value = row[1]
                        if value is None:
                            continue
                        d = date.fromisoformat(date_str) if isinstance(date_str, str) else date_str
                        v = float(value)
                        dates.append(d)
                        values.append(v)
                    except (ValueError, TypeError, IndexError):
                        continue
                if dates:
                    return dates, values
        except Exception as e:
            logger.debug("Query against equity_total_return_index failed: %s", e)

        return [], []

    def _fetch_postgres(
        self,
        conn,
        ticker: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> tuple[list[date], list[float]]:
        """Fetch from Postgres Gold DB.

        Queries gold.equity_total_return_index table.
        Uses close price, with fallback to price_return_index or total_return_index.
        """
        cursor = conn.cursor()

        # Postgres uses schema.table notation: gold.equity_total_return_index
        query = """
            SELECT date,
                   COALESCE(close, price_return_index, total_return_index) as value
            FROM gold.equity_total_return_index
            WHERE ticker = %s
        """
        params = [ticker]

        if start_date:
            query += " AND date >= %s"
            params.append(start_date.isoformat())
        if end_date:
            query += " AND date <= %s"
            params.append(end_date.isoformat())

        query += " ORDER BY date ASC"

        try:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()

            if rows:
                dates = []
                values = []
                for row in rows:
                    try:
                        date_str = row[0]
                        value = row[1]
                        if value is None:
                            continue
                        d = date.fromisoformat(date_str) if isinstance(date_str, str) else date_str
                        v = float(value)
                        dates.append(d)
                        values.append(v)
                    except (ValueError, TypeError, IndexError):
                        continue
                if dates:
                    return dates, values
        except Exception as e:
            logger.debug("Query against equity_total_return_index failed: %s", e)

        return [], []

    def is_available(self) -> bool:
        """Check if Gold DB is available."""
        return self._backend in ("sqlite", "postgres") and self._get_connection() is not None
