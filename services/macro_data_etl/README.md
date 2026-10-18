# macro_data_etl — Global Macro Data ETL

A production-grade Python ETL that ingests **global inflation**, **central-bank
policy rates**, and **Fed Funds futures → FOMC probabilities** from free public
sources, lands them through a **raw → bronze → silver → gold** medallion
architecture, and serves analytical tables to the QIT Terminal.

```
World Bank ─┐
BIS ────────┤   extract → bronze → silver (macro_observations) → gold → DuckDB → terminal
IMF ────────┤        (Polars)        (unified, vintaged)        (analytical)
CME ────────┘
```

## Sources

| Source | What | API | Notes |
|--------|------|-----|-------|
| **World Bank** | CPI inflation (annual %, by country) | `api.worldbank.org/v2` | `FP.CPI.TOTL.ZG`; JSON, paginated; free, no key |
| **BIS** | Central-bank policy rates (monthly) | `data.bis.org/api/v2` | `WS_CBPOL` SDMX dataset; CSV |
| **IMF** | CPI inflation fallback | `imf.org/external/datamapper/api/v1` | `PCPIPCH`; fills World Bank gaps |
| **CME** | 30-Day Fed Funds Futures (product 305) | `cmegroup.com/CmeWS/mvc` | blocks non-browser clients → deterministic fallback curve |

## Architecture

```
macro_data_etl/
├── config/
│   ├── settings.yaml          # sources, storage, cache, quality bounds
│   └── series_catalog.yaml    # 38 countries × {inflation, policy_rate} mappings
├── src/
│   ├── connectors/            # world_bank, bis, imf, cme (httpx + tenacity retry)
│   ├── extract/               # connector orchestration → raw Parquet snapshots
│   ├── transform/             # bronze → silver → gold (Polars)
│   ├── load/                  # DuckDB (+ optional PostgreSQL) loaders
│   ├── analytics/             # FedProbabilityEngine (CME FedWatch methodology)
│   ├── orchestration/         # Pipeline + PipelineRun (manifests)
│   └── utils/                 # logging (rich), quality checks
├── data/  raw/ bronze/ silver/ gold/ manifest/
├── tests/                     # 22 tests, no network required
└── cli.py                     # Typer CLI (macro-etl)
```

### Silver — `macro_observations`

A single unified, vintaged fact table across every source:

`observation_id` (deterministic SHA-256 hash) · `source` · `country_iso3` ·
`country_name` · `region` · `indicator` (`cpi_yoy` | `policy_rate`) · `frequency` ·
`date` · `value` · `unit` · `prior_value` · `revision_from` · `vintage_date` ·
`is_preliminary` · `fetched_at` · `quality_flag`.

`observation_id` makes loads idempotent (delete-then-insert upsert in DuckDB).

### Gold — analytical tables

| Table | Shape | For |
|-------|-------|-----|
| `country_macro_latest` | one row / country: CPI, trend, streak, policy rate, cycle, real rate, vs-target, flag | terminal snapshot tiles |
| `inflation_timeseries` | wide: date × country CPI YoY | heat maps / comparison |
| `policy_rate_timeseries` | wide: date × central-bank rate | overlay charts |
| `real_rates` | rate − inflation, as-of-joined per country × date | restrictive/accommodative |
| `vintage_snapshots` | every (series, date) with vintage + revision delta | revision tracking |
| `fed_probabilities` | per FOMC meeting: cut/hold/hike %, expected rate, implied move | Rate Probabilities module |

## FedWatch probability engine

`FedProbabilityEngine` replicates the CME methodology:

1. `implied_rate = 100 − settlement_price` for each contract month.
2. **Day-weighting** recovers the post-meeting rate from the month average:
   `rate_after = (N·month_implied − D·rate_before) / (N − D)`.
   For late-month meetings (last 7 days, tiny denominator) it switches to the
   **next** month's contract — exactly as CME does.
3. Probability is distributed across a 25bp outcome ladder around the
   pre-meeting rate; forward meetings **chain** (expected rate → next
   `rate_before`).
4. `vintage_snapshot()` appends each run to `fed_probability_vintages.jsonl` so
   the terminal can show how the path has been re-priced over time.

## CLI

```bash
pip install -e .                      # or: pip install polars duckdb httpx tenacity pydantic typer rich pyyaml pyarrow

macro-etl run --source all --start-year 2000   # full pipeline
macro-etl extract bis                          # one source → raw
macro-etl transform all                        # bronze → silver → gold
macro-etl load duckdb                           # (re)load DuckDB from gold
macro-etl rebuild-gold                          # rebuild gold from existing silver
macro-etl fedwatch                              # CME futures → FOMC probabilities
macro-etl backfill world_bank 1990 2025         # historical backfill
macro-etl status                                # table counts + latest run
macro-etl query "SELECT * FROM country_macro_latest ORDER BY policy_rate DESC"
macro-etl export country_macro_latest --out ./data/export   # JSON for the terminal
```

Run from the repo root so `macro_data_etl` is importable, or `pip install -e .`.

## Quality gates

Every run records a manifest under `data/manifest/run_*.json` with per-stage
status and a quality block. Checks: null-rate thresholds, duplicate
`observation_id`, date-range validity, sanity bounds (inflation −20…500%, policy
rate −2…100%), and cross-source agreement. Error-severity failures fail the gate;
bounds/cross-source are warnings.

## Resilience

Each connector retries with exponential backoff (`tenacity`) and **degrades
gracefully** — a failed source is logged and skipped, the run continues with an
empty frame for that source, and the manifest records it. CME, which blocks
bots, falls back to a deterministic futures curve (gold rows flagged
`price_source = sim`) so downstream tables stay populated.

## Terminal integration

`macro-etl export <table>` writes gold tables to JSON. The QIT Terminal's
economics API reads a committed snapshot of `country_macro_latest`,
`inflation_timeseries`, `policy_rate_timeseries`, and `fed_probabilities`,
falling back to its built-in simulation when the snapshot is absent — the same
LIVE/SIM badge pattern used for FRED.
