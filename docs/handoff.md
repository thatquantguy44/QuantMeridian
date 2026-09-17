# Market Terminal Handoff

**Updated:** 2026-09-16
**Branch:** `feature/ibal-inventory-optimizer`
**Latest pushed branch commit:** `017094d` — `Add InventoryBallast integration scaffold`

## Current Focus

The active workstreams are IBAL InventoryBallast integration, MVOL follow-through, Gold DB
conversion, NEWS persistence, and CPI component expansion. Detailed source docs live in:

- InventoryBallast source-of-truth spec: `thatquantguy44/InventoryBallast` /
  `specs/0013-market-terminal-integration/`
- `docs/specs/spec005/SPEC.md` — QuantSmith integration layer, incl. Phase 4
  (IBAL as a QuantSmith model plugin, spec `0026`) -- see Current State below
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

Python service test coverage is tracked in a master validation document:
**`services/inventory_optimizer_api/tests/VALIDATION.md`** -- keep that file, not this paragraph,
current going forward. It indexes every test file by what it protects, documents the shared
edge-case framework (`tests/edge_cases.py`) and benchmark harness (`tests/benchmark.py`), maps
AC-001 through AC-024 to concrete covering tests with a DONE/PARTIAL/TODO status, and keeps a
running "bugs found and fixed" log with the *pattern* behind each bug, not just the instance.

**Every backend item is now DONE.** Suite is `176 passed`, 0 failed, 0 xfail/skip,
`ruff check tests/` clean, covering AC-002, AC-004 through AC-011 (frontend-only pieces of some
excepted), AC-013, AC-014, AC-016, AC-019, AC-020 (backend half), AC-021, AC-022. Four real bugs
were found and fixed along the way (full detail in VALIDATION.md): (1) XLSX/JSON starter templates
weren't hash-identical -- unrounded synthetic fields losing precision through XLSX serialization;
(2) independently-valid `starting_utilization`/`reserve_fraction`/`utilization_cap` values could
jointly push share balances negative -- found immediately by the edge-case framework's first
boundary config; (3) the generic `RequestValidationError` handler crashed on *every* malformed
request body across *every* endpoint, silently turning a `422` into a `500` -- a FastAPI
`errors()` signature mismatch invisible until a test finally exercised that code path; (4) a
tampered `DatasetEnvelope.summary` (row counts/totals disclosed to a user/auditor) was accepted
silently by `solve()`/`export_bundle()` as long as `request`/`request_hash` were left untouched --
fixed by recomputing and comparing the summary the same way `request_hash` already was.

The backend test-coverage work merged to `main` as PR #121.

**Frontend workbench** is now in progress on its own branch, **`feature/ibal-frontend-workbench`**
(cut from latest `origin/main`, not the merged/retired `feature/ibal-inventory-optimizer`). First
correction: `src/app/inventory-optimizer/page.tsx` was previously described here as "still a
shell" -- that was wrong (written without actually reading the file). It is a real, working MVP:
synthetic/upload intake, run config, solve, export, a KPI strip, an allocations grid, a constraints
grid, and a verification panel, all wired to the live API. What the spec's T-010-T-012 still call
for and this page doesn't have: a reducer/state machine (it uses plain `useState`), an explicit
Synthetic/Upload segmented control, full `SyntheticConfig` field coverage in the UI (only 5 of 16
fields have controls -- `scale: "custom"` is effectively unreachable today), a reroll action,
result tabs for Balances/Demand/Economics/Diagnostics/Raw (only Allocations/Constraints/
Verification exist, as stacked panels not tabs), evidence drill-down, and source/version/status
badges.

First slice landed: `dataset.validation.issues` (and located issues from a failed upload/run/
export) were never rendered anywhere -- fixed with a `DataGrid`-based Issues panel
(Severity/Code/Location/Message) and a new `IbalRequestError` class
(`src/lib/inventoryOptimizer.ts`) that preserves the service's issue list instead of flattening
failures to a string. Preparing a new dataset also silently discarded whatever was already
prepared/solved -- fixed with a confirm dialog (`src/components/ui/ConfirmDialog.tsx`, built on the
existing `Modal` primitive; no generic confirm dialog existed to reuse) gating Synthetic/Upload
once a dataset exists, plus an explicit Reset action and a Run-button readiness gate on dataset
validity. Verified against the real service (curl + Node fetch) and against a live Chromium
session with the network layer route-mocked using captured real response payloads -- direct
browser-to-live-backend POSTs hit an environment-specific networking limitation in this sandbox
(unrelated to the diff; ruled out cold-compile, CORS, keepalive, DNS). Not yet pushed/PR'd.

**HIGH PRIORITY -- QuantSmith Phase 4 (IBAL model-plugin pilot):** `docs/specs/spec005/SPEC.md`
was revisited 2026-09-17 to add candidate synergy item 6 and Phase 4: registering `IBAL` with
QuantSmith's `model_plugin` adapter (spec `0026`) so a QuantSmith review agent
(`agents/optimization/inventory_supply_chain/` or `solver_diagnostics_sensitivity/`) can invoke a
real `IBAL` solve and produce an independent review/report -- not a second solver, a second pair of
eyes, same re-verification discipline as the already-completed Phase 2 narrative pilot
(`PHASE2_PILOT_DRAFT.md`/`PHASE2_PILOT_VERIFICATION.md`). QuantSmith's own securities-lending
runtime (spec `0023`) is explicitly not adopted -- confirmed less mature than `IBAL`. The general
optimization/portfolio/trading agent-family exclusion for Market Terminal is reaffirmed; this is a
narrow, single-purpose exception. **Scoped, not started.** Two blockers before this can move:
spec `0026` itself has no executable dispatcher yet (QuantSmith-repo work), and any first pilot
should stay manual/scripted (mirroring Phase 2's shape) with synthetic `IBAL` data only -- real
book/request data must never enter QuantSmith's repo. Read spec005's item 6 and Phase 4 sections in
full before starting; check `Related Documents` there for the exact QuantSmith spec paths.

Remaining IBAL priorities, in order: (1) QuantSmith Phase 4 pilot (above); (2) continue the frontend
workbench -- reducer/state machine, full synthetic-config controls, result tabs, evidence
drill-down (T-010/T-011), then session/download wiring (T-012); (3) Data Ops health + env/runbook
docs (T-013/T-014); (4) browser-to-solver E2E and Playwright screenshots before any production
enablement. Production remains off unless `IBAL_PRODUCTION_ENABLED` and a trusted access boundary
are explicitly configured. CI/Vercel
repair stays out of scope until the owner asks for it.

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
