"""Data quality checks for the macro ETL pipeline.

Each check returns a :class:`QualityResult`. The :class:`QualityChecker`
accumulates results so a single pipeline stage can produce one consolidated
report (and a pass/fail gate) for the manifest.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl


@dataclass
class QualityResult:
    """Outcome of a single quality check."""

    check_name: str
    passed: bool
    details: str
    rows_affected: int = 0
    severity: str = "error"  # error | warning

    def __str__(self) -> str:
        mark = "PASS" if self.passed else ("WARN" if self.severity == "warning" else "FAIL")
        return f"[{mark}] {self.check_name}: {self.details} (rows={self.rows_affected})"


class QualityChecker:
    """Runs a configurable suite of data-quality checks over Polars frames."""

    def __init__(self, config: dict | None = None) -> None:
        self.config = config or {}
        self.results: list[QualityResult] = []

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def check_nulls(
        self, df: pl.DataFrame, column: str, threshold: float = 0.05
    ) -> QualityResult:
        """Fail if the null rate in ``column`` exceeds ``threshold``."""
        if column not in df.columns:
            res = QualityResult("null_check", False, f"column '{column}' missing", 0)
            self.results.append(res)
            return res
        n = df.height
        nulls = int(df.select(pl.col(column).is_null().sum()).item()) if n else 0
        rate = (nulls / n) if n else 0.0
        passed = rate <= threshold
        res = QualityResult(
            check_name=f"null_check[{column}]",
            passed=passed,
            details=f"null rate {rate:.2%} vs threshold {threshold:.2%}",
            rows_affected=nulls,
        )
        self.results.append(res)
        return res

    def check_duplicates(
        self, df: pl.DataFrame, key_columns: list[str]
    ) -> QualityResult:
        """Fail if duplicate rows exist on ``key_columns``."""
        missing = [c for c in key_columns if c not in df.columns]
        if missing:
            res = QualityResult("duplicate_check", False, f"missing keys: {missing}", 0)
            self.results.append(res)
            return res
        dup = df.height - df.unique(subset=key_columns).height
        res = QualityResult(
            check_name=f"duplicate_check[{','.join(key_columns)}]",
            passed=dup == 0,
            details=f"{dup} duplicate rows on key",
            rows_affected=dup,
        )
        self.results.append(res)
        return res

    def check_date_range(
        self, df: pl.DataFrame, date_col: str, min_date: str, max_date: str
    ) -> QualityResult:
        """Fail if any value in ``date_col`` falls outside [min_date, max_date]."""
        if date_col not in df.columns or df.height == 0:
            res = QualityResult("date_range_check", True, "no rows / column to check", 0)
            self.results.append(res)
            return res
        col = pl.col(date_col).cast(pl.Utf8)
        out = df.filter((col < min_date) | (col > max_date))
        res = QualityResult(
            check_name=f"date_range_check[{date_col}]",
            passed=out.height == 0,
            details=f"{out.height} rows outside [{min_date}, {max_date}]",
            rows_affected=out.height,
        )
        self.results.append(res)
        return res

    def check_bounds(
        self, df: pl.DataFrame, column: str, min_val: float, max_val: float
    ) -> QualityResult:
        """Fail if non-null values in ``column`` fall outside sanity bounds."""
        if column not in df.columns or df.height == 0:
            res = QualityResult("bounds_check", True, "no rows / column to check", 0)
            self.results.append(res)
            return res
        out = df.filter(
            pl.col(column).is_not_null()
            & ((pl.col(column) < min_val) | (pl.col(column) > max_val))
        )
        res = QualityResult(
            check_name=f"bounds_check[{column}]",
            passed=out.height == 0,
            details=f"{out.height} rows outside [{min_val}, {max_val}]",
            rows_affected=out.height,
            severity="warning",
        )
        self.results.append(res)
        return res

    def check_cross_source(
        self,
        df1: pl.DataFrame,
        df2: pl.DataFrame,
        join_keys: list[str],
        value_col: str,
        tolerance: float = 1.0,
    ) -> QualityResult:
        """Cross-validate ``value_col`` between two sources within ``tolerance``."""
        if value_col not in df1.columns or value_col not in df2.columns:
            res = QualityResult("cross_source_check", True, "value column absent", 0)
            self.results.append(res)
            return res
        joined = df1.join(df2, on=join_keys, how="inner", suffix="_b")
        if joined.height == 0:
            res = QualityResult("cross_source_check", True, "no overlapping keys", 0)
            self.results.append(res)
            return res
        disc = joined.filter(
            (pl.col(value_col) - pl.col(f"{value_col}_b")).abs() > tolerance
        )
        res = QualityResult(
            check_name=f"cross_source_check[{value_col}]",
            passed=disc.height == 0,
            details=f"{disc.height}/{joined.height} obs differ > {tolerance}",
            rows_affected=disc.height,
            severity="warning",
        )
        self.results.append(res)
        return res

    # ------------------------------------------------------------------
    # Suite / reporting
    # ------------------------------------------------------------------

    def run_all(
        self, df: pl.DataFrame, checks: list[str] | None = None
    ) -> list[QualityResult]:
        """Run a standard suite over a unified ``macro_observations`` frame."""
        checks = checks or ["nulls", "duplicates", "dates", "bounds"]
        before = len(self.results)
        q = self.config.get("quality", {})
        threshold = q.get("null_threshold", 0.05)
        bounds = q.get("sanity_bounds", {})

        if "nulls" in checks and "value" in df.columns:
            self.check_nulls(df, "value", threshold)
        if "duplicates" in checks:
            keys = [c for c in ("observation_id",) if c in df.columns]
            if not keys:
                keys = [c for c in ("source", "country_iso3", "indicator", "date") if c in df.columns]
            if keys:
                self.check_duplicates(df, keys)
        if "dates" in checks and "date" in df.columns:
            self.check_date_range(df, "date", "1950-01-01", "2100-12-31")
        if "bounds" in checks and "indicator" in df.columns and "value" in df.columns:
            infl = df.filter(pl.col("indicator").str.contains("cpi|inflation|deflator"))
            if infl.height:
                self.check_bounds(
                    infl,
                    "value",
                    bounds.get("inflation_yoy_min", -20.0),
                    bounds.get("inflation_yoy_max", 500.0),
                )
            rate = df.filter(pl.col("indicator").str.contains("policy_rate|rate"))
            if rate.height:
                self.check_bounds(
                    rate,
                    "value",
                    bounds.get("policy_rate_min", -2.0),
                    bounds.get("policy_rate_max", 100.0),
                )
        return self.results[before:]

    @property
    def passed(self) -> bool:
        """True if no error-severity check failed."""
        return all(r.passed or r.severity == "warning" for r in self.results)

    def report(self) -> str:
        """Render a plain-text report of all accumulated results."""
        if not self.results:
            return "No quality checks run."
        lines = [str(r) for r in self.results]
        n_fail = sum(1 for r in self.results if not r.passed and r.severity == "error")
        n_warn = sum(1 for r in self.results if not r.passed and r.severity == "warning")
        lines.append(
            f"— {len(self.results)} checks · {n_fail} failures · {n_warn} warnings · "
            f"gate={'PASS' if self.passed else 'FAIL'}"
        )
        return "\n".join(lines)

    def to_dicts(self) -> list[dict]:
        """Serialize results for the manifest."""
        return [
            {
                "check": r.check_name,
                "passed": r.passed,
                "details": r.details,
                "rows_affected": r.rows_affected,
                "severity": r.severity,
            }
            for r in self.results
        ]
