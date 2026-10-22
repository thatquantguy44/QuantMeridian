# Spec020 build handoff: Borrower default and indemnification risk (INDEM)

**Updated:** 2026-10-21

**Branch:** `spec020-indemnification-scope` was merged to `main` as [PR #188](https://github.com/thatquantguy44/QuantMeridian/pull/188)
(`6e21ccd`). Start follow-up work on a **new branch from `main`**; do not reuse #188.

**State: phase 1 is built, merged and validated.** The Python model and service (port 8018), the terminal server
routes and the INDEM page at `/securities-lending/indemnification` (seven tabs, close-out profile editor, saved
profiles) all work end to end against the SIM book. `VALIDATION.md` maps every phase 1 acceptance criterion to its
test, gives the benchmark, and lists the defects the validation found and fixed. Phase 2 (the optimizer) is **not
approved**: decision 10 is open.

## Next highest priority: IND-T15a, make long reported runs work (start here)

The headline use is a **reported annual run** (252 days, 50,000 paths). The main run takes 163 s and 3.5 GB; adding
the four sweeps takes 414 s. Three things stop that working from the page today:

1. **Timeout.** `RUN_TIMEOUT_MS = 300_000` in `src/lib/server/indemnificationProxy.ts` is shorter than 414 s, so the
   run is abandoned with `SERVICE_TIMEOUT` while the service keeps computing. A simple fix is a longer timeout for
   reported runs; the better one is an asynchronous run (`POST /v1/runs` returns a run id, the page polls
   `GET /v1/runs/{id}`, which the service already exposes for finished runs). Decide which, write it in `PLAN.md`,
   then build it.
2. **Cancel does not cancel.** The page's Cancel aborts the browser request only. In `app.py` the model runs in
   `run_in_threadpool` behind `_run_lock`, with no cancellation hook, so the service stays busy ("one run at a
   time") until the model finishes. Either add a cooperative cancel flag checked between chunks and sweep points,
   or make the page say a cancelled run still occupies the service.
3. **Memory.** The process peaked at 3.5 GB for the annual 50,000-path run (2.2 GB already at 5,000 paths). The
   engine only refuses runs whose exposure array exceeds 2 GB. Measure where the rest goes (stored per-path
   exposures, float64 copies in the sweeps) and cap it or report it in the capabilities response.

Done means: an annual 50,000-path run with sweeps completes from the page, or is refused before starting with a
plain message and an estimate; Cancel frees the service; peak memory is known and documented. Add a service test
for the cancel path and keep `test/indemnification.spec.ts` green.

**After that, in order:**

- **IND-T15b** polish: half-width charts stretch text and overlap x labels (`src/components/charts/LineChart.tsx`
  uses `preserveAspectRatio="none"`; give the INDEM panels a fixed aspect or a variant of the chart); print the
  number of paths with any default beside the tail metrics (desk-view VaR and ES are usually 0; the Overview already
  warns when all four are 0); add the service to `scripts/dev-all.sh` and `docs/services.md` startup.
- **Phase 2 (IND-T16 to T21)** only when the owner resolves decision 10 (optimizer settings) and approves. IND-T15
  is now done, so the only blocker is the decision. `SPEC.md` has the phase 2 requirements (IND-022 to 027).

## Status

| Task | What | Status |
|---|---|---|
| IND-T01 to T13 | Decisions, contracts, SLAB extension, the whole Python model, HTTP service | Done |
| IND-T14 | Terminal routes, INDEM page, nav and module registration, profile editor, e2e tests | Done (merged in #188) |
| IND-T15 | Validation report and benchmark (`VALIDATION.md`) | Done 2026-10-21 |
| IND-T15a | Long runs through the terminal: timeout, cancel, memory | **Next** |
| IND-T15b | Chart polish, default-path counts, `dev-all.sh` | Todo |
| IND-T16 to T21 | Phase 2 optimizer | Not approved; needs decision 10 |

Test counts: 266 Python (`services/indemnification_api`, about 2 minutes), 1,038 TypeScript (whole repo), 4 Playwright
tests in `test/indemnification.spec.ts` (service replaced by a canned response). `ruff check`, `ruff format --check`,
`npx tsc --noEmit` and `npm run build` are clean. CI has an `indem-service` job (ruff and pytest, Python 3.12).

## Start here

1. `SPEC.md` (requirements, acceptance criteria, **decision log**: decisions 1–9 are all recorded there).
2. `PLAN.md`, especially the block headed **Implementation choices that refine the text above**, which records
   where the code differs from or sharpens the original plan.
3. `TASKS.md` for status and evidence.
4. `services/indemnification_api/README.md` for setup and the module map.
5. `contracts/indemnification/README.md` for the wire contract.

`AGENTS.md` points at the Agent Skills for spec012 (Sources & Uses) work only. It does not apply here, but
`npm run check:agent-skills-pin` still passes.

## How to work on it

```bash
# Python (about 35 s)
python3 -m venv .venv && . .venv/bin/activate
pip install -e "services/indemnification_api[dev]" ruff
cd services/indemnification_api && ruff check . && pytest -q

# TypeScript (repo root)
npm ci && npx tsc --noEmit && npx vitest run
```

**Changing the contract** (anything under `contracts/indemnification/*.schema.json`, the fixtures, the default
profile, or `buildSimSnapshot`): edit the schema, the TS types in `src/lib/indemnificationContract.ts`
(plus the `Fields<T>` parity maps in its test), `validation.py` and `snapshotIssues` if there is a
cross-field rule, and the fixtures; then run

```bash
npx vite-node scripts/refresh-indemnification-fixtures.ts
```

It recomputes every hash and re-exports the SIM book, and is idempotent. Three suites fail if a fixture is
stale: `indemnificationContract.test.ts`, `indemnificationBook.test.ts`, and `tests/test_contracts.py`.

**Running the page locally** (needs a Python venv with `services/indemnification_api[dev]` installed):

```bash
cd services/indemnification_api
INDEMNIFICATION_API_TOKEN=devtoken INDEM_ENV=local \
  uvicorn indemnification_api.app:app --app-dir src --port 8018      # keep this PID; do not pkill -f
# repo root, second shell
INDEMNIFICATION_API_URL=http://127.0.0.1:8018 INDEMNIFICATION_API_TOKEN=devtoken npx vite --port 5199 --host 127.0.0.1
```

Open `/securities-lending/indemnification`. A desk preview (5,000 paths, sweeps at 2,000) takes about 22 s. The
Playwright spec needs only the dev server: `BASE_URL=http://127.0.0.1:5199 npx playwright test test/indemnification.spec.ts`.
Restart the service after any model change; it does not reload.

## Design that is not obvious from the code

- **Two loss estimators.** Expected loss uses the exact conditional probability of default in each step given
  the path's factors (`defaults.conditional_step_probs`); VaR, expected shortfall and Euler contributions use
  sampled defaults. They estimate the same EL and a test checks they agree. Reason: a one-month desk run of an
  A-rated borrower sees about 2 defaults in 50,000 paths.
- **Desk-view tails are degenerate for investment-grade books.** With almost no defaults, sampled VaR99.9 is
  usually 0. That is the honest answer for one month, not a bug. Consider showing the number of paths with any
  default beside every tail metric, and use the annual view for tail risk.
- **Exposure is margin-period-of-risk exposure** (`max(0, loans at d+M − collateral at last call)`), not
  current exposure, which would be exactly zero for a daily-margined book.
- **Wrong-way link.** Each borrower has a sign (`book.signs`): +1 if its exposure rises with equities. The
  no-wrong-way run sets `rho_w = 0` and moves that weight onto the shared credit factor, so latent variance and
  borrower-to-borrower correlation are unchanged.
- **Prices are simulated daily** to the horizon plus the longest close-out period; `run.step` only sets the
  grid for defaults and exposures. The market after a default is the path's real continuation.
- **Draws do not depend on the day count.** `market.simulate_paths` gives each array its own stream and draws
  day by day, because the simulated days include the longest close-out period; any other layout reshuffles every
  path when a sweep changes that period and breaks common random numbers (found in validation, now tested).
- **Estimator-agreement check can be "not assessed".** Below 30 sampled paths with a loss the model card reports
  `passed: null` with a note (schema allows null; the page shows "Not assessed"). It runs and passes on annual
  50,000-path runs.
- **Page defaults.** Sweeps start at 2,000 paths per point (`SWEEP_PREVIEW_PATHS` in the page's `state.ts`); the
  preview run is capped at 5,000 paths and labelled. Each sweep point is a full model run (about 3 s at 5,000 paths).
- **Per-chunk seed streams** (`engine.CHUNK_PATHS = 5000`): changing the chunk size changes results. The first
  half of the chunks is a valid half-size run, which the convergence check needs.
- **Rating table is in the snapshot**, not a hidden file in the service, so results never depend on one.
- **Collateral** is re-derived from margin × loan value at each margin call. Holdings in the snapshot give the
  cash/non-cash split, the non-cash composition and the wrong-way sign; a margin sweep means changing the
  loans' `margin_pct`.
- **Hooks already in `closeout.evaluate`** for the pool: `activity(day)` (which loans are on, shape `(L,)` or
  `(n, L)`) and `realization(k, day)` (cash collateral's realizable fraction, shape `(n, B)`, default 1).
- `simulate(snapshot, hazards=...)` overrides credit inputs; it exists so tests can set zero hazards.

## How the finished pieces behave (read before changing them)

Steps 1 to 5 of the original plan (result assembly, Basel cross-check, sensitivities and stresses, pricing, HTTP
service) are done; this is what is worth knowing:

- `results.build_result(snapshot, output)` validates against `result-1.0` and `model-card-1.0`. Exposure metrics are
  repeated in the total and default channels and are zero in the reinvestment channel.
- `analysis.run_analysis(snapshot, sensitivity_paths=..., stresses=...)` returns the complete result: four sweeps
  (margin, close-out period, wrong-way correlation, collateral substitution) on common random numbers, five named
  stresses and the Basel cross-check. Stress shocks land one day after the forced default, inside the close-out
  period. Rates and FX stress figures are each borrower's *own* default, not a joint event.
- Collateral is pooled per borrower, so a diversified borrower's 5% margin buffer can absorb a squeeze on one loan:
  on the SIM book the squeeze, largest-borrower and FX stresses are $0. That is the model; tests pin it. The
  rates shock and the reinvestment run are the informative ones.
- Raising cash margin lowers default shortfall but enlarges the pool, so total EL need not fall with margin. A
  margin sweep resizes collateral and the pool, and reports the channels separately.
- Pricing (`pricing` per borrower) is filled only for an annual run over 252 business days: capital is
  `VaR99.9 − EL` split by Euler ES99.9 shares; the flag uses the economic cost only.
- Service: `uvicorn indemnification_api.app:app --port 8018`; see the service README for routes, errors and
  settings. The terminal routes live in `src/app/api/indemnification/` and `src/lib/server/indemnificationProxy.ts`
  (local only: 403 in production; 4 MiB request cap, 32 MiB response cap, 8 s quick timeout).
- The page is `src/app/securities-lending/indemnification/` (`page.tsx` plus one file per tab). Pure logic is in
  `state.ts` and `src/lib/indemnification{View,Client,Compose,Profiles,Api}.ts`, all unit tested.

## Known issues and risks

- **Speed and memory** (measured in `VALIDATION.md`): annual 50,000 paths 163 s and 3.5 GB; with four sweeps at
  5,000 paths 414 s. This is IND-T15a above. Sweeps dominate: one model run per point.
- **Test time** is about 35 s, mostly the 100,000–400,000-path statistical tests. Keep them; they are what
  catches modelling errors.
- **Pool simplifications.** Issuer defaults are independent across positions (scaled up when spreads widen) and not linked to the borrowers' copula; the pool is rescaled to the book's cash collateral so it starts exactly funded. Both are in `PLAN.md`.
- **Parameters are illustrative.** The rating PD table, factor volatilities and correlations, jump parameters, copula correlations, forced-sale floors, risk weights and cost of capital are placeholders labelled as such. The SIM book's figures are smoke numbers, not results; on the SIM book the reinvestment channel dominates expected loss because of the illustrative forced-sale floors (`VALIDATION.md` section 4).
- **Concentration threshold.** In the SIM book the largest loan is 18% of average daily volume, so with the
  25% default only hard-to-borrow names get the longer close-out period.

## Open owner decisions

- **Decision 10** (phase 2 optimizer settings). Blocks phase 2 only. See `SPEC.md`.
- Whether the UI should print "not estimable" for tail metrics when too few paths contain any default. Today the
  Overview shows a notice only when all four tail figures are 0, and the model card says when the estimator
  agreement check was not assessed.
- How reported annual runs should be delivered (longer timeout or asynchronous run); see IND-T15a. This is a
  design call for whoever picks it up, not an owner decision, unless it changes the service contract.
