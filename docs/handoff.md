# Market Terminal Handoff

**Updated:** 2026-09-16
**Branch:** `feature/ibal-inventory-optimizer`
**Latest pushed branch commit:** `017094d` — `Add InventoryBallast integration scaffold`

## Current Focus

The active workstreams are IBAL InventoryBallast integration, MVOL follow-through, Gold DB
conversion, NEWS persistence, and CPI component expansion. Detailed source docs live in:

- InventoryBallast source-of-truth spec: `thatquantguy44/InventoryBallast` /
  `specs/0013-market-terminal-integration/`
- `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`
- `docs/gold-db/MODULE_DATA_AUDIT.md`
- `docs/specs/spec001/`
- `docs/specs/spec002_news_live_intelligence/`
- `docs/specs/spec003/SPEC.md`
- `docs/specs/spec003/HANDOFF.md`
- `docs/gold-db/FRED_PIPELINE_CPI_COMPONENT_HANDOFF.md`
- `docs/features/completed/Feature Addition - NEWS Terminal Module (Market News & Signal Intelligence).md`
- `docs/features/completed/Feature Completion - NEWS NLP (Attention, Clusters, Signals).md`

## Current State

IBAL / InventoryBallast integration scaffold (PR #119) and its docs checkpoint (PR #120) are both
merged to `main`. The `feature/ibal-inventory-optimizer` branch adds a separate `IBAL` module at
`/inventory-optimizer`, a pinned Python FastAPI service under `services/inventory_optimizer_api`,
server-only proxy routes at `/api/inventory-optimizer/*`, synthetic/upload dataset preparation,
solve invocation, and result bundle export. The existing `/optimization` / `OPT` page remains
untouched.

The source-of-truth spec and task map live in the InventoryBallast repo at
`specs/0013-market-terminal-integration/`; this Market Terminal handoff records only the terminal
branch state. Both `verify` CI and Vercel have been failing on `main` across the last three merges
(PR #118-#120); by explicit owner direction this is being deferred while IBAL work stays local-only
-- no CI/Vercel fix is planned as part of this workstream right now.

Python service test coverage is now tracked in a master validation document:
**`services/inventory_optimizer_api/tests/VALIDATION.md`** -- keep that file, not this paragraph,
current going forward. It indexes every test file by what it protects, documents the shared
edge-case framework (`tests/edge_cases.py`: named boundary-value `SyntheticConfig`s plus a
Hypothesis-strategy pattern for sweeping cross-field combinations), maps AC-001 through AC-024 to
concrete covering tests with a DONE/PARTIAL/TODO status, and keeps a running "bugs found and
fixed" log with the *pattern* behind each bug, not just the instance. Suite is now `151 passed`,
0 failed, 0 xfail/skip, `ruff check tests/` clean.

This work now lives on its own branch, **`feature/ibal-backend-test-coverage`**, cut from latest
`origin/main` rather than continuing on `feature/ibal-inventory-optimizer` (which is already fully
merged into `main` via PR #119/#120 -- reusing it further would be confusing for review). Two
commits so far: the test/bugfix work, and an unrelated one-line `src/lib/nav.ts` nav-group change
that happened to be sitting in the same working tree, committed separately on request. Kept local
by explicit owner direction -- not pushed, no PR opened yet.

Three real bugs were found and fixed via this test-writing pass (full detail + patterns in
VALIDATION.md's "Bugs found and fixed" section): (1) XLSX/JSON starter templates were not
hash-identical because `fee_rate`/`elasticity` were generated unrounded in `synthetic.py`, losing
precision through XLSX float serialization -- fixed by rounding to 6dp like every other synthetic
field, and dropping a redundant unread `metadata` key; (2) independently-valid
`starting_utilization`/`reserve_fraction`/`utilization_cap` values could combine to produce
negative `available_to_lend_shares` and `current > maximum` routes -- found immediately by the new
edge-case framework's `EDGE_MAX_EVERYTHING` boundary config, fixed by also capping
`starting_utilization` against the room `reserve_fraction` leaves behind; (3) the generic
`RequestValidationError` handler in `app.py` crashed on *every* malformed request body across
*every* endpoint (wrong type, extra field, missing field, malformed JSON), silently downgrading
what should be a `422 REQUEST_CONTRACT_INVALID` into a generic `500` -- FastAPI's own
`RequestValidationError.errors()` takes no keyword arguments in the pinned 0.116.1, unlike
pydantic's `ValidationError.errors()` the handler was written against. This was invisible until a
test finally sent a body that failed FastAPI's own parsing layer. Fixed, and pinned broadly across
endpoints/shapes in `test_request_validation.py` so it can't silently regress again.

`test_economics.py` (AC-014) was added next: every `economics` total in a solved result is
reconstructed from raw allocation/route/inventory data and checked against the engine's own
numbers, not just internal component-sum bookkeeping. The `fee_revenue`/`transition_cost` formulas
were not documented anywhere and had to be reverse-engineered empirically against real solved
results first (documented in the test file's module docstring) -- no bug found here, but the
formula-verification-before-asserting approach is itself recorded in VALIDATION.md as a pattern to
repeat for other engine-owned computed fields.

`test_exports.py` (AC-016) followed: the export bundle's JSON files round-trip exactly, and every
result-table CSV, read back out of the zip, matches `reporting.tables.result_tables()` cell-for-
cell for the same solved result -- not a re-derived value, the literal engine output. Also
directly unit-tests the CSV serialization helper's escaping/`None`/float-precision behavior. No bug
found; AC-016 is now DONE.

`test_benchmark.py` + `benchmark.py` (AC-021) added the benchmark harness: a reusable
`run_benchmark_suite()` timing generation and solve at every scale preset (small/medium/large)
plus JSON/XLSX upload parsing, writing a retained JSON manifest to
`tests/benchmarks/latest.json` (gitignored -- machine-specific numbers, not meant to be versioned)
and a curated baseline snapshot committed in VALIDATION.md. Everything is comfortably sub-100ms
even at `large` scale (100 securities, 2,000 routes) on a dev laptop; sanity thresholds are set
5-15x above baseline so the test catches a real regression without being flaky on ordinary machine
noise. AC-021 is now DONE.

Remaining IBAL priorities, in order: (1) the last two backend test gaps in VALIDATION.md's
"Next up" (AC-019 health matrix, AC-010 dataset summary adversarial test); (2) frontend
workbench -- `src/app/inventory-optimizer/page.tsx` is still a
shell; the spec's T-010-T-012 reducer/state machine, result tabs (Allocations/Balances/Demand/
Economics/Constraints/Diagnostics/Raw), dirty confirmation, and session-only result handling are
not built; (3) Data Ops health + env/runbook docs (T-013/T-014); (4) browser-to-solver E2E and
Playwright screenshots before any production enablement. Production remains off unless
`IBAL_PRODUCTION_ENABLED` and a trusted access boundary are explicitly configured. CI/Vercel repair
stays out of scope until the owner asks for it.

Tier A production routes for econ, chart, and market data have been hardened to
read the Gold DB or return explicit `ERR`/empty states. The old silent fallback
ladder to live FRED, committed snapshots, and deterministic SIM has been removed
from those production paths.

HOME / Command Center is being converted from the old revenue/book cockpit into
a Gold/FRED macro cockpit. It should read only `gold_fred_latest_observation`
and `gold_release_calendar` through `/api/command-center`, with no market API,
snapshot, news, desk-book, or generated sample-data fallback path. Every
displayed metric must show its own as-of observation date because daily, weekly,
monthly, and quarterly FRED series update on different schedules.

For HOME high-level index/price rows, `change` is the actual point/price level
delta, while `marketReturns["1D"]` is the one-day percent return. The route also
derives geometrically linked `5D`, `MTD`, `1M`, `3M`, `QTD`, `YTD`, `1Y`, `3Y`,
and `5Y` returns from the Gold observation levels. `1Y`, `3Y`, and `5Y` are
annualized with the convention `((end / start) ** (252 / observedTradingDays) -
1) * 100`.

The policy is enforced by:

```bash
npm run check:gold-policy
```

The gate scans `src/app/api/econ`, `src/app/api/chart`, and
`src/app/api/market` for forbidden fallback imports/calls and old
`MIGRATION FALLBACK` annotations.

Expected remaining exceptions:

- `src/app/api/econ/calendar/route.ts` now reads `gold.release_calendar`; CAL is
  no longer a live-FRED exception.
- `src/app/api/econ/fomc/route.ts` and `src/app/api/econ/macro-inputs/route.ts`
  remain documented synthetic model/book exception paths.
- Snapshot fixture references may remain in tests/offline fixtures until the
  final fixture deletion pass.

## Last Validation

The latest pushed Gold DB hardening slice passed:

```bash
npm run check:gold-policy
npm test -- src/app/api/econ/indicators/route.test.ts src/lib/useEcon.test.ts src/lib/useMarket.test.ts src/lib/server/inflationCoverage.test.ts
npm run build:client
git diff --check
```

Only Vite's existing large-chunk warning appeared during the client build.

## NEWS Status

NEWS provider hardening and live-intelligence diagnostics are pushed on
`news-expansion` through `ba8cad7`:

- `src/lib/server/newsProviders.ts` uses the documented provider priority:
  Alpha Vantage -> Marketaux -> Finnhub -> NewsAPI.
- `fetchLiveNews()` returns per-provider diagnostics: configured, ok, headline
  count, latency, and error.
- `src/app/api/news/route.ts` returns `ERR` when no provider returns headlines
  unless `sim=1` explicitly opts into generated demo headlines.
- `src/lib/useNews.ts` comments describe the SIM-gated behavior.

Completed NEWS work expands DataOps and module-facing diagnostics:

- `src/lib/server/newsDiagnostics.ts` wraps the provider chain plus NEWS_NLP
  health into one diagnostics object.
- `src/app/api/news/diagnostics/route.ts` exposes `/api/news/diagnostics?n=20`
  with provider attempts, winning provider, newest headline age, and NLP health.
- `src/app/api/dataops/health/route.ts` adds a distinct `providers.NEWS`
  status row so real headline availability is visible from DataOps.
- `src/data/dataOps.ts` adds NEWS fixture/run metadata so the DataOps provider
  table has a stable row before the live probe overlays it.
- `src/lib/useNews.ts` now preserves `/api/news` provider diagnostics, and
  `src/app/news/page.tsx` renders a compact provider-chain strip above the tape.
- `src/lib/server/socialProviders.ts` now emits Reddit/StockTwits attempt
  diagnostics; `src/app/api/social/diagnostics/route.ts` exposes the social
  smoke check without falling back to generated rows.
- `src/lib/server/intelligenceFeedManifest.ts` builds a shared
  NEWS/SOCIAL/NEWS_NLP DataOps manifest, and `src/app/api/dataops/runs/route.ts`
  appends those DataOps-shaped run/series/lineage rows under
  `INTELLIGENCE_FEEDS`.
- `src/app/api/dataops/health/route.ts` reports the umbrella
  `INTELLIGENCE_FEEDS` status plus separate `NEWS`, `SOCIAL`, and `NEWS_NLP`
  statuses.
- `/api/news` now returns `clusterSource` and `nlp` runtime metadata so
  `src/app/news/page.tsx` can label NEWS-6 as FinBERT clusters, keyword
  clusters, or no clusters, and show NLP health in the header.
- `src/app/news/page.tsx` includes a compact diagnostics drawer for inspecting
  the raw NEWS/SOCIAL/NLP provider-attempt payloads from the UI.
- The NEWS diagnostics drawer now supports direct smoke-check refresh, JSON
  copy/download, and Escape-key close.
- `news_nlp` `/health` now reports structured sentiment, clustering, NER,
  lexicon fallback, device, and runtime metadata; Market Terminal normalizes
  both the new shape and the legacy `{ model }` shape.
- `docs/specs/spec002_news_live_intelligence/SPEC.md` is the active NEWS spec
  for diagnostics, `NEWS_NLP` health, and future persistence handoffs.

Current NEWS priority:

- Create the upstream-pipeline persistence handoff before any historical storage
  work. The handoff should define raw headline, raw social post, scored
  headline, entity/ticker link, cluster membership, and DataOps audit/run
  tables. Market Terminal should remain a read-only consumer of the approved
  pipeline/database contract; do not add a new Market Terminal data source
  without explicit owner approval.

Validation for the NEWS slices:

```bash
npm test -- src/lib/server/newsProviders.test.ts src/app/api/news/route.test.ts src/app/api/news/diagnostics/route.test.ts src/app/api/social/diagnostics/route.test.ts src/app/api/dataops/runs/route.test.ts src/app/api/dataops/health/route.test.ts
npm run check:gold-policy
npm run build:client
npm run build:server
git diff --check
```

Known validation caveat: full `npm run typecheck` still fails on the existing
Gold hardening TypeScript backlog outside the NEWS changes.

Worktree caveat: `TESTING_HANDOFF.md` appears deleted at repo root with an
untracked replacement at `test/TESTING_HANDOFF.md`. That move was not part of
the Gold calendar or NEWS provider work and should be reviewed separately.

## Market Volatility Status

`docs/specs/spec003/SPEC.md` is the draft scaffold for a proposed `MVOL` Market
Volatility module. The first experiment reconstructs a reserves-versus-VIX claim
using only existing FRED/Gold DB data paths: FRED `WRESBAL` for reserve
balances, FRED `VIXCLS` for VIX closes, and FRED/Gold `SP500` for equity-return
context.

The spec now includes the version-one Gold DB data contract, calculation helper
semantics, `/api/market-volatility/reserve-vix` route contract, acceptance
criteria, and fixture-based route/helper test plan. The implementation handoff lives in
`docs/specs/spec003/HANDOFF.md`. The pure helper, fixture-based tests, Gold DB-only
route, route tests, client hook, and first static module UI are implemented on
`MVOL-Implementation`. `MVOL` is enabled in module config, registered in the
Markets navigation, and routed at `/market-volatility`. The static UI now plots
the actual `VIXCLS` level series separately from the derived forward VIX outcome
bars, includes VIX-regime buckets for starting VIX below 15, 15-20, 20-30, and
above 30, adds Gold/FRED `SP500` forward outcome context, and includes an `EDGE`
readout panel backed by tested threshold logic for cautious risk-on/risk-off
context language.

Locked version-one decisions:

- Support both Research Mode, anchored to the `WRESBAL` Wednesday observation
  date, and Tradability Mode, anchored to the first actionable close after the
  reserve data is publicly available. Until approved Gold release timing exists,
  Tradability Mode returns `UNAVAILABLE`, not a generic `ERR`.
- Use deterministic `anchor + 7 calendar days` and `anchor + 14 calendar days`
  VIX endpoints in both modes.
- Include all weekly above-mean observations for the broad conditional study,
  while using event-only, non-overlapping handling for cross-above studies.
- Use binomial confidence intervals, VIX point change as the primary outcome,
  current revised Gold DB history for version one, live UI before video export,
  and a default 71% claim threshold that can become configurable.

Roadmap considerations called out in the spec: point-in-time/vintage-aware
reserve history once available from the upstream FRED/Gold pipeline, richer
uncertainty bands, citation-safe video export, configurable claim-audit presets,
and additional volatility experiments after the first reserve/VIX study is
validated.

## Next Work

1. Create the NEWS upstream-pipeline persistence handoff from
   `docs/specs/spec002_news_live_intelligence/SPEC.md` Phase 3. This is the next
   NEWS priority and must happen before storage code or historical warehouse
   wiring.
2. Finish the CPI expanded weight pipeline handoff in the FRED/eco pipeline for
   the eight CPI rows that need weights.
3. Replace or explicitly retain legacy snapshot fixtures, then delete unused
   `econSnapshot`/SIM generator paths once non-route callers are audited.
4. Add the `gold.powerbi_catalog` join test so every Tier A module maps to at
   least one Gold object.
5. Continue CPI expansion from `docs/specs/spec001/`, keeping Market Terminal
   DB-only: no new external data source should be added here without explicit
   owner approval.
6. For `MVOL`, review the first static Market Volatility module surface, then
   add animated playback/export surfaces only after chart labels, citations, and
   current revised Gold history labeling are accepted. Keep the actual `VIXCLS`
   level chart visually distinct from derived forward-outcome statistics, and
   refine readout thresholds after reviewing real Gold DB outputs across modes.
   SPX context must continue to come only from Gold/FRED `SP500`; do not add a
   separate market-data provider without explicit owner approval.
