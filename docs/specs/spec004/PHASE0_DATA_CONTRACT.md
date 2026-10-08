# Spec004 Phase 0: Template-To-Data Contract

## Status

In progress. This document converts the Spec004 scaffold into the first build
contract for `MPUB`. It is intentionally strict: a template is ready only when
its displayed numbers can be resolved from the approved FRED/Economic Gold
SQLite pipeline through `MACRO_DB_URL`.

## Source Boundary

- Approved numerical source: FRED/Economic Gold SQLite via `MACRO_DB_URL`.
- Approved route pattern: server route reads through `goldStore`.
- Approved base tables for the first slice:
  - `gold_fred_latest_observation`
  - `gold_release_calendar`
- Approved for spec006 (material-change detector), approved by Joshua
  2026-09-02 — see "Spec006 Signal Table Audit" below for the profiling
  each was approved against:
  - `gold_macro_indicator_dashboard`
  - `gold_macro_category_summary`
  - `gold_zscore_heatmap`
  - `gold_credit_spread_daily`
  - `gold_credit_spread_rolling`
  - `gold_curve_spread_daily`
  - `gold_funding_stress_daily`
  - `gold_treasury_curve_metrics`
  - `gold_spread_inversion_episode`
  - `gold_series_structural_breaks`
  - `gold_macro_anomaly_scores`
  - `gold_recession_probability_daily`
- Prohibited for `MPUB` phase one:
  - `src/data/market/*.json`
  - legacy market-pipeline snapshots
  - generated, sample, synthetic, or seeded fixture values
  - direct browser/API fetches to a new provider
  - old module output unless it exposes the same DB-only, no-fallback contract

Missing data must appear as an unavailable state with a reason. It must not be
filled from old snapshots or calculated from synthetic placeholders.

## Initial API Slice

The first implementation slice adds read-only route handlers:

- `GET /api/market-publishing/daily`
- `GET /api/market-publishing/candidates`

Both routes compose from `readCommandCenterPayload()`, which reads only the Gold
observation and release-calendar tables. The candidate route emits ready
candidate cards where Gold-backed observations exist and explicit unavailable
cards for gated areas such as earnings/valuation.

## Template Coverage Matrix

| # | Template | Phase 1 status | Gold tables | Required series / fields | Output basis | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Daily market scoreboard | Ready for API seed | `gold_fred_latest_observation` | `SP500`, `NASDAQCOM`, `DJIA`, plus optional `DTWEXBGS`, `GOLDPMGBD228NLBM`, `DCOILWTICO` | Latest index/price level, level delta, linked returns | Uses the Command Center market-return basis: 1D, 5D, MTD, 1M, 3M, QTD, YTD, 1Y/3Y/5Y annualized on 252 trading days. |
| 2 | Leaders and laggards derby | Ready for API seed | `gold_fred_latest_observation` | At least two market series with linked returns | Ranked linked returns | Initial detector ranks 1D returns. Later phases can add 5D, MTD, and YTD derby modes. |
| 3 | Index return table | Partial | `gold_fred_latest_observation` | Same market series as scoreboard | Linked returns across selected horizons | API seed has the calculations through Command Center, but a dedicated table/card layout is not built yet. |
| 4 | Drawdown / record proximity | Gap | `gold_fred_latest_observation` | Daily price/index histories for market series | Percent below trailing/all-time high | Needs a detector and display transform. No new data source required. |
| 5 | Treasury curve chart | Ready for API seed | `gold_fred_latest_observation` | `DGS2`, `DGS10`, `DGS30`, `T10Y2Y`, optional `DFII10`, `T10YIE` | Yield level and spread basis points | Initial detector uses 10Y and 10Y-2Y. Full curve chart can add maturity points. |
| 6 | Rates dashboard | Partial | `gold_fred_latest_observation` | `SOFR`, `EFFR`, `DGS2`, `DGS10`, `DGS30`, `DFII10`, `T10YIE` | Latest level and one-observation change | Command Center carries the inputs. Needs an MPUB-specific chart template. |
| 7 | VIX regime / volatility state | Ready for API seed | `gold_fred_latest_observation` | `VIXCLS`, optional `NFCI`, `STLFSI4` | Latest VIX level, point change, regime buckets | Initial detector combines VIX with stress/credit context. Full regime buckets can reuse MVOL logic. |
| 8 | Credit-spread risk gauge | Ready for API seed | `gold_fred_latest_observation` | `BAMLH0A0HYM2`, `BAMLC0A0CM` | OAS basis points | Initial detector combines HY/IG with VIX. Percentile gauge is a follow-up transform. |
| 9 | Inflation momentum | Partial | `gold_fred_latest_observation` | `PCEPILFE`, CPI headline/core/component series where cataloged | Index value, MoM %, change in MoM %, YoY %, change in YoY % | Data exists in other inflation routes, but MPUB needs a direct Gold-only candidate detector and template. |
| 10 | Labor and growth snapshot | Partial | `gold_fred_latest_observation` | `GDPNOW`, `GDPC1`, `UNRATE`, `PAYEMS`, `ICSA`, optional `RSAFS`, `INDPRO` | Levels and correct transformed changes by frequency | Command Center computes many inputs. MPUB needs a candidate detector that respects monthly/quarterly as-of dates. |
| 11 | Liquidity / reserves / funding | Partial | `gold_fred_latest_observation` | `WRESBAL`, `SOFR`, `EFFR`, optional funding gaps in catalog | Latest level and spread/change transforms | Inputs are present where Gold rows exist. Needs MPUB template and stale-state handling. |
| 12 | Economic week ahead | Ready for API seed | `gold_release_calendar` | `release_id`, `release_name`, `release_date`, `importance`, `econ_category`, `representative_series_id`, `fetched_at` | Calendar date and catalyst grouping | Initial detector uses upcoming HIGH/MEDIUM rows. Actual/prior/consensus values are not assumed. |
| 13 | Claim audit | Ready for API seed through MVOL inputs | `gold_fred_latest_observation` | `WRESBAL`, `VIXCLS`, `SP500` | MVOL reserve-above-mean experiment, +7D/+14D outcomes | Candidate route verifies inputs only; full stats remain in `/api/market-volatility/reserve-vix`. |
| 14 | Historical analog | Gap | `gold_fred_latest_observation` | Template-specific series history | Explicit sample, non-causal caveat | Needs design and statistical guardrails before build. No new source required for simple Gold-series analogs. |
| 15 | Earnings and valuation | Blocked | None approved | No approved complete fields yet | Unavailable | Must stay disabled until Joshua approves an upstream source and Gold schema for estimates, revisions, calendar timing, and forward valuation. |

## Reusable Module Classification

| Existing module / route | Classification for MPUB | Reason |
| --- | --- | --- |
| `/api/command-center` | Approved seed | Gold-only route; no market snapshot or synthetic fallback; returns per-series as-of dates. |
| `/api/market-volatility/reserve-vix` | Approved for claim-audit stats in research mode | Gold-only route for `WRESBAL`, `VIXCLS`, and `SP500`; tradability mode correctly fails unavailable pending Gold release timing. |
| `/api/econ/calendar` | Approved for calendar facts | Gold-only `release_calendar` route; no fallback. |
| `/api/market/[view]` | Blocked for phase one | Serves legacy market views and pipeline/file paths; useful as schema inspiration only. |
| `/asset-quilt`, `/market-snapshot`, `/index-returns` | Blocked for direct reuse | Useful UI concepts, but current data path includes legacy market-pipeline/file behavior. |
| `/economics/inflation`, `/economics/credit`, `/economics/rates` | Partial | Contain useful domain logic and Gold rows, but MPUB should query approved Gold tables directly or through a DB-only route. |
| `/news`, `/sentiment` | Context only | May suggest topics. Numerical claims still need approved structured Gold data and their own citation. |

## Current Gaps

- MPUB does not yet have a UI route at `/market-publishing`.
- MPUB does not yet render share-ready PNG cards.
- Drawdown, percentile, inflation-momentum, labor/growth, and historical-analog
  detectors still need dedicated Gold-only transforms.
- Post-release notes need a release-specific Gold value contract for actual,
  prior, revised prior, and consensus/expectation fields where available.
  Proposed below in "Post-Release Value Contract" (pending approval): Part A
  from FRED vintages, Part B consensus through the Source Gate.
- Earnings/valuation remains intentionally blocked.

## Post-Release Value Contract — Proposed 2026-10-08 (pending approval)

Closes the "release-specific Gold value contract" gap above, which keeps the
Post-Release Note `partial` (`src/lib/marketPublishing.ts`). It names the
fields the note needs, where each must come from, and how `MPUB` behaves when
any of them is missing. Nothing here is built. Part A asks the upstream
pipeline for new Gold tables built from FRED, an already-approved source. Part
B is a new data source and goes through the Source Gate
(`SPEC.md`, "Data Policy"). Each part needs Joshua's approval before ingestion
starts.

### Why the current tables are not enough

- `gold_fred_latest_observation` holds one value per observation: the latest
  vintage (`realtime_start` says when it became known). A revision overwrites
  the value, so "prior as first published" versus "revised prior" cannot be
  reconstructed, and a month-over-month change computed from it silently mixes
  vintages.
- `gold_release_calendar` has `release_id`, `release_name`, `release_date`,
  `importance`, `econ_category`, `representative_series_id`, and `fetched_at`:
  no time of day, no reference period, no list of the release's series, and no
  signal that Gold has actually refreshed for that release.
- `gold_macro_indicator_dashboard.surprise` / `surprise_z` measure a print
  against its own **trend**, not against a consensus forecast, and the table
  keeps only the current snapshot. It is valid context but must never be
  labeled "vs. consensus" or "vs. expectations".
- No approved source carries consensus. `src/lib/server/finnhubCalendar.ts`
  can read Finnhub's calendar, but Finnhub is not an approved `MPUB` source.

### Part A — Release values from FRED vintages (no new provider)

Built upstream from FRED/ALFRED real-time data (`realtime_start` /
`realtime_end`), which FRED already provides. `MPUB` reads them through
`goldStore`, read-only.

**A1. `gold_release_event`** — one row per release occurrence.

| Field | Type | Meaning |
| --- | --- | --- |
| `release_id` | integer | FRED release ID (same key as `gold_release_calendar`) |
| `release_date` | date | Publication date |
| `released_at` | timestamp, nullable | Publication time (UTC) when an approved calendar provides it; otherwise null, never guessed |
| `reference_period` | date | Period the headline print covers (e.g. `2026-09-01` for September CPI) |
| `representative_series_id` | text | Headline series |
| `gold_refreshed_at` | timestamp | When Gold finished loading this release's vintage rows |

**A2. `gold_release_observation_vintage`** — one row per release occurrence ×
series × observation affected by that release (the new print and every
revised earlier period).

| Field | Type | Meaning |
| --- | --- | --- |
| `release_id`, `release_date` | | Key to A1 |
| `series_id` | text | FRED series |
| `observation_date` | date | Period the value belongs to |
| `value` | numeric | Value as published in this release |
| `previous_value` | numeric, nullable | Same observation as published before this release; null for a first print |
| `is_first_print` | boolean | True for the new reference period |
| `realtime_start` | date | Vintage start, from ALFRED |
| `units` | text | FRED units (e.g. `Index 1982-1984=100`, `Thousands of Persons`) |
| `seasonal_adjustment` | text | `SA`, `NSA`, or `SAAR` |
| `frequency` | text | `M`, `Q`, `W` |

**A3. `gold_release_series_map`** — reviewed mapping of a release to its series.

| Field | Type | Meaning |
| --- | --- | --- |
| `release_id` | integer | |
| `series_id` | text | |
| `role` | text | `headline`, `core`, or `component` |
| `parent_series_id` | text, nullable | For components |
| `display_transform` | text | `level`, `mom_pct`, `yoy_pct`, `level_change`, or `annualized_qoq_pct` |
| `seasonal_adjustment` | text | Must match A2; a release never mixes SA and NSA in one comparison |

Initial release set (the spec's own list), each mapped in A3 with its headline
and core series: CPI (`CPIAUCSL`, `CPILFESL`), PCE (`PCEPI`, `PCEPILFE`),
Employment Situation (`PAYEMS`, `UNRATE`), GDP (`GDPC1`), retail sales
(`RSAFS`), industrial production (`INDPRO`), housing starts (`HOUST`), and
initial claims (`ICSA`). FOMC-related data stays with the existing FOMC routes.

**How `MPUB` uses Part A**

- The note is generated only when `gold_release_event.gold_refreshed_at`
  exists for the release, never because `release_date` has passed.
- **Actual** = A2 `value` where `is_first_print`. **Prior (as first published)**
  and **revised prior** come from A2 rows for the previous reference period:
  `previous_value` and `value`. **Revision** = revised prior − prior as first
  published.
- Every change (MoM %, YoY %, level change, annualized QoQ) is computed from
  values of a single vintage, the one this release produced. Never mix
  vintages.
- Historical percentile and comparable episodes may use latest-vintage
  history from `gold_fred_latest_observation`, labeled "revised history", per
  the Trust and Citation Contract.

### Part B — Consensus (new data source; Source Gate decision)

**B1. `gold_release_consensus`** — one row per release occurrence × series ×
basis.

| Field | Type | Meaning |
| --- | --- | --- |
| `release_id`, `release_date`, `series_id` | | Key to A1/A2 |
| `basis` | text | Same vocabulary as A3 `display_transform`; consensus is compared only on its own basis (a `mom_pct` consensus is never compared with a level) |
| `consensus_value` | numeric | Median or mean forecast, as the provider defines it |
| `consensus_definition` | text | Median, mean, or provider-specific |
| `n_estimates`, `low`, `high` | nullable | When the provider supplies them |
| `provider` | text | Cited in every note |
| `captured_at` | timestamp | Must be before `released_at` (or before `release_date` when time is unknown); a value captured after the release is rejected upstream, never shown |

Source Gate decision — to be completed and approved by Joshua:

| Gate item | Proposal / open question |
| --- | --- |
| Business use and fields | Post-Release Note "expected" value and surprise vs. consensus; B1 fields only |
| Provider and licensing | Open. Candidates: Finnhub (client already in the codebase; free-tier terms must allow redistribution in published cards), Trading Economics, Bloomberg/Refinitiv exports if licensed, or manually entered consensus with a cited source. Redistribution terms decide it, because `MPUB` output is shared publicly. |
| Depth, frequency, revisions | Needed: at least 5 years per release for surprise percentiles; consensus is not revised, but `captured_at` must be kept |
| Ingestion and schema ownership | Upstream pipeline repository; `MPUB` stays a read-only consumer |
| Quality, freshness, outage | Missing consensus for a release renders the explicit missing-consensus state; it never blocks the rest of the note |
| Cost and credentials | Provider-dependent; credentials live upstream only, never in Market Terminal |
| Owner approval | Pending |

Until B is approved and loaded, every Post-Release Note shows "Consensus: not
available (no approved source)" and computes no surprise vs. consensus. The
trend-based `surprise` from `gold_macro_indicator_dashboard` may appear only
under a label such as "vs. recent trend".

### Unavailable states

Each renders with its reason, never as a blank or an inferred value:

| State | When |
| --- | --- |
| `release_not_refreshed` | No `gold_release_event` row with `gold_refreshed_at` for the release |
| `no_vintage_rows` | A2 has no first print for the headline series |
| `prior_unavailable` | No A2 row for the previous reference period (e.g. the first release loaded) |
| `consensus_unapproved` | Part B not approved |
| `consensus_missing` | Part B approved, but no B1 row for this release and basis |
| `consensus_late` | B1 row has `captured_at` after the release |
| `basis_mismatch` | Consensus basis differs from every displayed transform |
| `sa_nsa_mixed` | A comparison would mix seasonal-adjustment types |

Market reaction stays out of scope for this contract. `released_at` is
recorded so a later reaction section can use it, but under the current Gold
data, which is daily closes only, a reaction can be stated only as
"on the release date", with other same-day events listed.

### Contract checks (to build with the consumer)

When `MPUB` implements the note, a route test in the style of
`candidates/route.test.ts` should prove, on Gold fixtures:

- no note before `gold_refreshed_at`;
- actual, prior as first published, revised prior, and revision match
  hand-computed values from A2 fixtures;
- MoM and YoY use one vintage (a fixture with a revision changes the prior, not
  the current-vintage change);
- with Part B absent, the note shows `consensus_unapproved` and no surprise vs.
  consensus, and the trend surprise is never labeled as consensus;
- a late-captured consensus row is not shown;
- SQL touches only the approved Gold tables listed in this document.

## Spec006 Signal Table Audit — Approved 2026-09-02

`docs/specs/spec006/SPEC.md` (the material-change detector for `MPUB`'s
candidate feed) profiled 12 additional Gold tables while drafting its Phase
0. **Joshua approved all 12 for read-only use on 2026-09-02**, now listed in
Source Boundary above. All 12 are within the already-approved
`fred-bronze-to-gold-pipeline` Gold layer (same pipeline, same trust
boundary as the two tables already approved above), so this was a lighter
review than a new Source Gate — but it was still Joshua's explicit
call to make per this document's own Non-Negotiable Rules, not a rubber
stamp.

Profiled 2026-09-02 against the local `fred_local.db`. Grouped by observed
cadence, since that turned out to be the single most important finding —
tables that both look "daily" do not necessarily share the same actual
refresh lag:

### Group A — freshest daily (latest 2026-08-24, ~9 days stale)

| Table | Rows | Key column checked | Nulls (latest date) | Notes |
| --- | --- | --- | --- | --- |
| `gold_macro_indicator_dashboard` | 290 | `zscore` | 0/290 | Snapshot table — only the current `as_of_date` is retained, not a running history |
| `gold_macro_category_summary` | 11 | `avg_zscore` | 0/11 | One row per `econ_category`, same snapshot pattern |
| `gold_zscore_heatmap` | 20,330,437 | `zscore_expanding` | 0/1 | Freshest of all 12 tables; huge row count reflects per-series/per-window history back to 1694 (data artifact, not a quality issue) — query by `series_id`+date, never scan unfiltered |

### Group B — daily but lagging further (latest 2026-08-20, ~13 days stale)

| Table | Rows | Key column checked | Nulls (latest date) | Notes |
| --- | --- | --- | --- | --- |
| `gold_credit_spread_daily` | 7,307 | `zscore` | 0/9 | 9 rows/day (one per credit tier) |
| `gold_credit_spread_rolling` | 46,847 | `zscore` | 9/63 (~14%) | Some rolling-window/instrument combinations lack enough trailing history for a window's zscore — expected for short-history instruments in longer windows, not a defect, but must be handled as an explicit gap, not coerced to 0 |
| `gold_curve_spread_daily` | 115,866 | `zscore` | 0/9 | 9 spreads/day, history back to 1962 |
| `gold_funding_stress_daily` | 1,263 | `composite_z` | 0/1 | |
| `gold_treasury_curve_metrics` | 16,144 | `level` | 0/1 | |

**This 4-day gap between Group A and Group B, both nominally "daily," is
the key finding.** A freshness/staleness score cannot assume every "daily"
Gold table shares one current "today" — each candidate must compare against
its own source table's actual latest date, per spec006's Goals.

### Group C — monthly (expected multi-week lag by nature of the underlying data)

| Table | Rows | Key column checked | Latest date | Notes |
| --- | --- | --- | --- | --- |
| `gold_macro_anomaly_scores` | 405 | `mahalanobis_d2` | 2026-06-01 | 0 nulls; `is_anomaly`=0 in the most recent 6 monthly rows |
| `gold_recession_probability_daily` | 2,060 | `recession_prob` | 2026-07-01 | 0 nulls; despite the table name, this is monthly, not daily — misleading name, real cadence must be read from the data, not assumed from the table name |

### Group D — event/episodic (no fixed cadence, expected)

| Table | Rows | Notes |
| --- | --- | --- |
| `gold_spread_inversion_episode` | 624 | New rows only when an inversion episode starts; most recent episode start 2026-03-16, no episode currently `is_ongoing` — consistent with `gold_treasury_curve_metrics.is_inverted_10y2y`/`10y3m`=0 above |

### Group E — irregular re-run cadence (needs care before use as a trigger)

| Table | Rows | Notes |
| --- | --- | --- |
| `gold_series_structural_breaks` | 16 | Only 5 distinct `as_of_date` re-runs exist (2026-08-20, 2026-08-14, 2026-07-01, 2026-06-01, and one outlier at 1992-05-01 that looks like a seed/backfill row, not a real re-run — worth a question to the pipeline side, not a blocker). Latest run (2026-08-20): 4 rows, 2 of 4 have a **null `f_stat`** (50%) — not all `test_type` values populate `f_stat`; a detector must key off `is_significant` directly, never assume `f_stat` is populated. `break_date` is often years old even when `as_of_date` is today (a re-confirmation of a historical break, not a new event) — spec006's Risks section already treats this table as context/caveat only, never a same-day trigger by itself; this profiling confirms that call was correct. |

### Recommendation

All 12 tables are internally consistent (no unexpected nulls beyond the two
noted caveats) and safe to approve for read-only use. The two caveats above
(`gold_credit_spread_rolling`'s ~14% null rate on thin-history
window/instrument combinations, and `gold_series_structural_breaks`' 50%
null `f_stat` rate on its latest run) are not blockers — they are exactly
the kind of gap spec004's Data Policy requires rendering as an explicit
"unavailable" state rather than coercing to zero or silently omitting.

**Approved by Joshua, 2026-09-02.** Phase 1 implementation may now read
these 12 tables, subject to the caveats and handling rules noted per table
above (e.g. key off `is_significant` rather than `f_stat`; render a thin-
history rolling zscore as unavailable rather than null-coerced).

## Tests

Initial executable guardrail:

- `src/app/api/market-publishing/candidates/route.test.ts`

The test proves:

- MPUB daily/candidate routes compose from Gold-backed Command Center data.
- missing Gold config fails closed with `ERR`.
- ready candidates carry `source: "DB"` and citations.
- earnings/valuation is explicit `unavailable`.
- route SQL touches Gold observation/calendar tables and does not reference
  `bilello`, `snapshot`, or `src/data/market`.
