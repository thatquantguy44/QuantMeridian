# Market Terminal Handoff

**Updated:** 2026-10-18. The top-priority section was updated for PR #166 (spec012 SU-SIM, the
spec011 MMKT module, demo books). The rest of this file was last updated 2026-09-16 and is
retained as context.
**Default branch:** `main` (0018 was merged in PR #148; subsequent follow-up docs were merged in PR #150)

## ▶ TOP PRIORITY — live proof-of-concept showcase (InventoryBallast spec `0018`, set 2026-10-17)

**This is the highest-priority work for Market Terminal. Start here.** It outranks "Current
Focus" and "Next Work" below; those stay as context.

**Active checkpoint (2026-10-18):**
[PR #166](https://github.com/thatquantguy44/QuantMeridian/pull/166) is open from branch
`claude/synthetic-snu-poc-27n9hu` and merges cleanly into `main`.

| Workstream | What PR #166 adds | Pickup document |
|---|---|---|
| D · spec012 Sources & Uses | The **Synthetic PoC** tab (SU-SIM). A penalised, balanced classic transportation LP solved in the browser on a fixed SIM book, with configurable penalties, an LP optimality certificate and a visual front end. The setup-only workspace is already in `main`. The production service is not started. | [`docs/specs/spec012/HANDOFF.md`](specs/spec012/HANDOFF.md) |
| C · spec011 Money market (MMKT) | The **`/money-market` module**, driving `services/money_market_api` end to end on two registered SIM rate sets. It has five scenarios, and results are shown only after the service verifier passes. It also fixes two service bugs and adds a pytest suite with a CI job. Results are LP relaxations, not execution-ready. | [`docs/specs/spec011/HANDOFF.md`](specs/spec011/HANDOFF.md) |
| Demo | A presenter guide for the SXU showcase | [`docs/demo_books/`](demo_books/README.md) |

Also in PR #166: `src/lib/server/fetchProxy.ts` now honours `NO_PROXY` and always bypasses
loopback. Without this, server routes behind an outbound proxy could not reach the local model
services, including OPT's MMKT probe.

Separately, `main` now has the spec015 MMFO local PoC (PRs #163–#165). It is SIM-only and not
independently verified. It is not the MMKT service.

**Known red test:** `src/tests/badge-coverage.test.ts` fails on `main` because the MMFO page has
no provenance badge (spec015). PR #166 fixes the SXU half: the SXU page now has a module SIM
switch and badge (spec012 SU-013).

**Source of truth:** `thatquantguy44/InventoryBallast`, `specs/0018-live-poc-showcase/`
(`spec.md`, `plan.md`, `tasks.md`) on `main`. That spec is the work queue; this section only says where to start on the terminal side.

**What lands in this repo** (four of the five workstreams; Workstream A is engine work in
InventoryBallast):

| Workstream | Child spec (drafts in PR #151) | Code |
| --- | --- | --- |
| B — IBAL showcase: engine re-pin (merged InventoryBallast `main` `e84801b`), diagnostic tabs, engine Scenario Studio (`0013` T-017), presenter mode | `spec013` | `services/inventory_optimizer_api/`, `src/app/inventory-optimizer/` |
| C — Money market execution optimizer (`MMKT` module; terminal module and SIM path in PR #166) | `spec011` | `services/money_market_api/` (port 8014), `src/app/money-market/` |
| D — Configurable sources and uses on LP/MIP (replaces the random-number mock; setup-only in `main`, SU-SIM showcase in PR #166, service not started) | `spec012` | `services/sources_uses_api/` (port 8015, not yet created), `src/app/sources-uses/` |
| E — Liquidity forecasting, shortfall detection, ML anomaly detection, cash and lever oversight (replaces the random-number Liquidity page) | `spec014` | `services/liquidity_api/` (port 8016), `src/app/liquidity/` |
| Shared — model library: sparse builder, HiGHS adapter, verifier, elastic relaxation | — | `services/optimization_core/` (a library, not a service) |
| White papers, one per model (mechanics, theory, application) | — | `docs/whitepapers/` |

The OPT page's fabricated "Gurobi"/"OR-Tools" runs are replaced by real run history from all
four services (REQ-029). Every number shown must come from a verified solve or a labeled input.

**Owner decisions (2026-10-17)** — do not re-open:

1. A separate Python service per module, sharing `services/optimization_core`. Services never
   call each other; the terminal's server routes compose them.
2. The demo runs locally. CI/Vercel repair stays deferred, as before.
3. All of InventoryBallast `0017` (prime) before the demo.
4. All five workstreams.

5. **MMKT rate data comes from the owner's MacroMedallion pipeline** (decided 2026-10-17; repo
   `thatquantguy44/EcoMedallion`, Postgres `macro_medallion` via `MACRO_DB_URL`), with an explicit,
   user-selected `SIM` set and **no silent fallback**. See "Cross-repo follow-up: EcoMedallion" below —
   that work is **not finished and nothing in it is live-verified**.

Still open: the ML stack (scikit-learn recommended), and whether the liquidity cockpit replaces
`/liquidity` with `/cash-optimizer` as its lever view (recommended).

**Pick up here on the terminal side:**

1. Review the draft packs in PR #151 for `spec011`–`spec014`, resolve the listed owner decisions, and approve the child specs before code.
2. Scaffold `services/optimization_core` and the three services (`0018` T-003/T-004).
3. M1: sources and uses, then money market, then OPT run history. M1b: liquidity. IBAL work
   (M2 onward) follows the engine child specs; see `0018`'s `plan.md` milestones.
4. **As of 2026-10-18:** merge PR #166, then follow the ordered next steps in the spec011 and
   spec012 handoffs. The highest-value items are owner decisions (spec012 open decisions 1–4,
   spec011 questions 1–3), the MMKT MIP slice (MM-006), and creating `services/sources_uses_api`
   on `optimization_core`.

**Current IBAL integration status (2026-10-17):** InventoryBallast PR #34 is merged to `main`.
QuantMeridian branch `codex/inventoryballast-scenario-integration` pins the merged engine, exposes
its scenario catalog and stress runner, and surfaces driver deltas/reconciliations in Scenario
Studio. The branch is not yet merged; continue the remaining `spec013` diagnostic-tab and presenter
work after reviewing this integration.

## Cross-repo follow-up: EcoMedallion (MMKT rate feed) — tracked 2026-10-17

MMKT's real rates come from `thatquantguy44/EcoMedallion` (the MacroMedallion pipeline). Its side is
specified in that repo's `specs/spec009` and **Phase 0 is open as
[EcoMedallion PR #81](https://github.com/thatquantguy44/EcoMedallion/pull/81)** (branch
`claude/spec009-mmkt-rate-feed`): an instrument map, a basis-normalizing snapshot engine, a live probe,
and one inactive manifest entry. **Nothing there is live-verified** — the environment it was built in
cannot reach FRED. Do not treat the feed as real until XR-1 is done. Tracked here, and in
[QuantMeridian issue #149](https://github.com/thatquantguy44/QuantMeridian/issues/149) so the list does
not depend on this branch being merged:

| ID | Follow-up | Owner / where | Blocks | Status |
| --- | --- | --- | --- | --- |
| XR-1 | **Run the probe live** with network access: `python scripts/probe_mmkt_series.py --fred-key "$FRED_API_KEY" --out probe.json` (EcoMedallion `spec009` AC-006). Fix any quoting-basis label it flags; activate `DCPN3M` if it resolves; save the report as the first real fixture. | Owner, in EcoMedallion | Everything below that reads real rates | **todo** |
| XR-2 | Review and merge EcoMedallion PR #81. | Owner | XR-3 | **todo** |
| XR-3 | EcoMedallion Phase 1: wire `gold.mmkt_rate_snapshot` into SQLite, Postgres and Databricks (about eight places; the Spark path needs CI or a real cluster). Until then QuantMeridian **cannot read the table**. | EcoMedallion | `spec011` real-rate mode (`0018` T-010) | **todo** |
| XR-4 | EcoMedallion Phase 2–3: Treasury bill auction results; SEC Form N-MFP and OFR source clients for money-fund yield, WAM, WAL, daily/weekly liquid assets, and repo by tenor. Each source must clear EcoMedallion `spec006` §4.1 and be recorded in `config/data_licensing.yml`. | EcoMedallion | Realistic MMKT fund parameters (`0018` REQ-017); until then they are user policy inputs labeled "illustrative" | **todo** |
| XR-5 | **QuantMeridian side:** an `/api/econ/...` route reading `gold.mmkt_rate_snapshot` through the existing `useGoldView` DB \| LOADING \| ERR pattern; build the **rate snapshot** (every row, with its `status`) plus a hash; pass it into the `services/money_market_api` solve request so the service has no database dependency and stays deterministic; record the hash on each run. A row with `status != ok` renders as `ERR` and is not priced off. The `SIM` set is selectable only by an explicit user choice. | QuantMeridian, with `spec011` (`0018` T-010) | MMKT demo | **in-progress** — snapshot route/hash/gate, solve wiring and two registered SIM sets done (2026-10-18; `/money-market` module); OPT run history remains |
| XR-6 | `spec011` must cite EcoMedallion `spec009` and its column contract (`instrument_id`, `quoted_rate_pct`, `quoted_basis`, `mm_yield_pct`, `observation_date`, `staleness_days`, `status`, `status_detail`). | QuantMeridian | `spec011` approval | **todo** |

Two facts the terminal side must not lose:

* **Rates are on different quoting bases** (discount for `DTB*` and CP, bond-equivalent for `DGS*`,
  simple ACT/360 for SOFR/repo/RRP). The snapshot carries both the quoted and a normalized
  `mm_yield_pct`; MMKT must compare **`mm_yield_pct`**, never `quoted_rate_pct`.
* **If XR-1 to XR-3 slip,** MMKT is built on the labeled `SIM` set alone and the demo says so (REQ-030);
  it must not borrow an unlabeled number. The InventoryBallast side is recorded in
  `specs/0018-live-poc-showcase/spec.md`, "Decided 2".

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
Synthetic/Upload segmented control, and a reroll action.

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

Second slice landed: full `SyntheticConfig` field coverage -- was 5 of 16 fields, now all 16. A
"Custom shape" section (`security_count`/`inventory_pool_count`/`borrower_count`/
`parent_group_count`/`routes_per_security`) appears only when `scale === "custom"`, since the
backend's scale presets silently override those fields otherwise; a collapsible "Advanced" section
covers the remaining rate/fraction fields; every slider now shows its live formatted value; and a
"profile-set" hint appears next to any field the selected profile silently overrides (mirroring
`synthetic.py`'s `PROFILE_PRESETS`, which apply unconditionally) so a user isn't fooled into
thinking an edit took effect when the backend will discard it. Verified the same route-mocked way.

Third slice landed: the T-011 result tabs (Allocations/Balances/Demand/Economics/Constraints/
Diagnostics/Raw), replacing the old stacked Allocations/Constraints/Verification panels with one
tabbed `Results` panel (`TermToggleGroup`, reused from the existing `economics/rate-vol` page --
no new tab component needed). Allocations gained evidence drill-down (click a row to see its
`reason_codes` and full `explanation_evidence` map, previously never surfaced). Balances and
Demand are new; `IbalDemand` didn't exist as a type before this -- the backend's real
`result.demand` array had no TypeScript type at all. `IbalResult`/`IbalAllocation` were
incomplete against the real backend response in several places (verified against a live solve,
not guessed): missing `explanation_evidence`, `demand`, `native_status`, `strict`, `config_hash`,
`package_version`, top-level `backend_version`/`termination_reason`, `desk`/`platform`
provenance, and `verification.has_primal`/`max_integrality_violation`; `demand_cap_shares` was
missing its `| null`. All fixed. Verified against real, live-captured HTTP responses (an actual
solve's output, not a synthetic fixture) via Playwright route-mocking -- every tab's row count
matched the real result exactly.

**Local-run setup gap found and fixed while testing this against the live service** (not a code
bug, a docs gap): `services/inventory_optimizer_api/README.md` said to start the service on port
`8080`, but `inventoryOptimizerProxy.ts`'s default `INVENTORY_OPTIMIZER_API_URL` is
`127.0.0.1:8013` -- fixed to `8013` in the README. `.env.example` had no IBAL section at all,
so a reader had no pointer to `INVENTORY_OPTIMIZER_API_TOKEN` (required client-side) alongside
the service's own token requirement -- added. To actually run IBAL end-to-end locally: start
`services/inventory_optimizer_api` per its README, set the same `INVENTORY_OPTIMIZER_API_TOKEN`
in the repo-root `.env`, and (re)start `npm run dev` (Vite only reads `.env` at startup).

**IBAL frontend/Playwright checkpoint, 2026-09-17:** the current workbench branch now fixes the
browser JSON round-trip `REQUEST_HASH_MISMATCH`, makes dataset readiness explicit, labels the ready
solve action `Base Case Run`, adds preset what-if scenarios, and renders scenario-specific
inventory/route detail after scenario runs. Focused browser verification lives in
`test/ibal.spec.ts` with `playwright.local.config.ts`; run it against the standalone server, not
the Vite dev server, because this local setup can hang browser POSTs through Vite while standalone
and direct `curl` calls remain healthy. The durable runbook and verification record is
`docs/features/IBAL_WHAT_IF_HANDOFF.md`.

**QuantSmith Phase 4 (IBAL model-plugin pilot) -- completed / PR opened 2026-09-17:**
QuantSmith branch `feature/ibal-model-plugin-pilot` registered `IBAL` in local, gitignored
`model_plugins.yml`, produced one `model_plugin_registration` understanding brief, invoked the real
IBAL REST API once with synthetic data, independently re-verified the reported numbers against the
IBAL API response, and wrote a pilot report. QuantSmith PR #94 tracks that artifact-only pilot. No
dispatcher, runtime wiring, production route, or Market Terminal UI change shipped from that pilot.

**IBAL follow-through checkpoint, 2026-09-17:** custom what-if shocks and scenario export are now
implemented on `main` (`1c110b9`, `89db3ca`): the workbench can save the current Dataset Intake +
Run Config forms as user-defined shocks; the scenario comparison table has CSV export; and the main
result-bundle export follows the currently selected base/scenario result, including route-level
allocation tables through the engine-owned ZIP exporter.

Active follow-through branch `feature/ibal-handoff-followthrough` starts the remaining IBAL
priorities: (1) reducer/state-machine/session polish for the frontend workbench; (2) Data Ops
health plus production env/runbook hardening (T-013/T-014); (3) investigate the Vite dev-server
browser POST hang so IBAL Playwright can run against `npm run dev` as well as standalone; and (4)
keep CI/Vercel repair scoped out unless the owner explicitly asks for that platform track.
Production remains off unless `IBAL_PRODUCTION_ENABLED` and a trusted access boundary are
explicitly configured.

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

> **Superseded in priority by the ▶ TOP PRIORITY section at the top of this file** (InventoryBallast
> spec `0018`). The items below remain valid but come after it.

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
