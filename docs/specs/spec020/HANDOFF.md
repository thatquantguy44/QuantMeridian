# Spec020 build handoff: Borrower default and indemnification risk (INDEM)

**Updated:** 2026-10-20 (post-merge status refreshed in the end-of-session handoff pass)

**Branch:** `spec020-indemnification-scope`, **merged** to `main` as [PR #188](https://github.com/thatquantguy44/QuantMeridian/pull/188) (`6e21ccd`).

**State:** phase 1 is **approved** (2026-10-20, decisions 1–9). The **model is complete in Python**: the
contract, the close-out profile, market paths, the default copula, loan returns, the reinvestment pool, the
close-out shortfall, risk metrics, the Basel cross-check, sensitivities, named stresses, pricing, and the result and
model-card assembly (`analysis.run_analysis(snapshot)` returns the whole validated result). Delivery is done: the HTTP service (IND-T13) and the terminal route and UI page (IND-T14).
**What is left** is the validation report and benchmark (IND-T15). Phase 2 (the optimizer) is not approved: decision 10 is open.

| Task | What | Status |
|---|---|---|
| IND-T01, T02 | Decisions and approval; real-firm name fixed | Done |
| IND-T03 | Contracts: 4 JSON Schemas, TS types and hashes, Python hashes, shared fixtures | Done (both languages) |
| IND-T04 | SLAB book extension (`getIndemnificationBookExtension`), rescaled pool view, SIM snapshot builder | Done |
| IND-T04a | Rating PD table and spread override (`credit.py`) | Done |
| IND-T04b | Run modes and event grid (`grid.py`, activity in `closeout.py`) | Done |
| IND-T05 | Market factors and security prices (`market.py`) | Done |
| IND-T06 | Default copula, wrong-way link, Student-t (`defaults.py`) | Done |
| IND-T06b | Close-out profile resolution and snapshot validation (`profile.py`, `schema.py`) | Done |
| IND-T07 | Close-out shortfall and exposure (`book.py`, `closeout.py`) | Done (pool realization is a hook) |
| IND-T08 | Metrics, engine, result and model card (`metrics.py`, `engine.py`, `results.py`) | Done |
| IND-T09 | Euler allocation, owner and channel attribution | Done |
| IND-T06a | Loan returns and the reinvestment pool (`returns.py`, `pool.py`) | Done |
| IND-T10 | Basel comprehensive approach cross-check (`basel.py`, contract `basel_haircuts`) | Done |
| IND-T11 | Sensitivities and named stresses (`sensitivity.py`, `stress.py`); `analysis.run_analysis` composes the full result | Done |
| IND-T12 | Pricing: cost in bps against fee, economic capital, regulatory proxy, flags (`pricing.py`) | Done |
| IND-T13 | HTTP service (`app.py`, `auth.py`, request/response/error contracts) | Done |
| IND-T14 | UI page, route, nav, profile editor | Done; merged in PR #188, and `npm run build` passes on `main` (2026-10-20) |
| IND-T15 | Validation report, benchmark, as-built | Not started |
| IND-T16 – T21 | Phase 2 optimizer | Not approved |

Test counts at handoff: 266 Python (`services/indemnification_api`), 1,024 TypeScript (whole repo), plus `test/indemnification.spec.ts` (Playwright, canned service response).
`ruff check` is clean. CI has a new `indem-service` job that runs both for Python 3.12.

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
- **Per-chunk seed streams** (`engine.CHUNK_PATHS = 5000`): changing the chunk size changes results. The first
  half of the chunks is a valid half-size run, which the convergence check needs.
- **Rating table is in the snapshot**, not a hidden file in the service, so results never depend on one.
- **Collateral** is re-derived from margin × loan value at each margin call. Holdings in the snapshot give the
  cash/non-cash split, the non-cash composition and the wrong-way sign; a margin sweep means changing the
  loans' `margin_pct`.
- **Hooks already in `closeout.evaluate`** for the pool: `activity(day)` (which loans are on, shape `(L,)` or
  `(n, L)`) and `realization(k, day)` (cash collateral's realizable fraction, shape `(n, B)`, default 1).
- `simulate(snapshot, hazards=...)` overrides credit inputs; it exists so tests can set zero hazards.

## Next steps, in order

**1. (Done.) IND-T06a, IND-T08 and IND-T09.** `results.build_result(snapshot, output)` returns a dict that
validates against `result-1.0` and `model-card-1.0`. The exposure metrics (EPE, PFE) are repeated in the total
and default channels and are zero in the reinvestment channel. The model card's limitations text only says the
reinvestment channel is not modelled for a snapshot with no pool. The "conditional and sampled expected loss
agree" check has little power when defaults are rare (the SIM book over one month); it is a real check only on
books with plenty of defaults.

**2. (Done.) IND-T10.** `basel.comprehensive_approach(snapshot)` feeds `cross_check` in the result, beside each
borrower's Monte Carlo PFE99. The haircut table is part of the snapshot (`basel_haircuts`, labelled
illustrative).

**3. (Done.) IND-T11.** `analysis.run_analysis(snapshot)` returns the complete result: the run, four sweeps (margin,
close-out period, wrong-way correlation, collateral substitution) on common random numbers, the five named
stresses, and the Basel cross-check. Things worth knowing:
- Stress shocks land one day after the forced default (and last margin call), so they fall inside the close-out
  period. A shock on the default day is absorbed by that day's margin call.
- Collateral is pooled per borrower, so a diversified borrower's 5% margin buffer can absorb a squeeze on one
  loan; on the SIM book the squeeze scenario is usually zero. That is the model, not a bug (a test pins it).
  The rates shock is the informative one there.
- Rates and FX stress figures are each borrower's *own* default under the shock, not a joint event.
- Raising cash margin lowers default shortfall but enlarges the pool, so total EL need not fall with margin.
  The sweep reports the channels separately for that reason.
- A margin sweep resizes the collateral holdings and the pool with the cash owed.

**4. (Done.) IND-T12.** Each borrower's `pricing` is filled for an annual run over 252 business days and null otherwise
(the model card says so). Capital is the program's `VaR99.9 − EL` split by Euler ES99.9 shares; the flag uses the
economic cost only, never the regulatory proxy.

**5. (Done.) IND-T13.** `uvicorn indemnification_api.app:app --port 8018`; see the service README for routes, errors
and settings. The terminal's server route that builds a snapshot with `buildSimSnapshot`, wraps it in a
`run-request-1.0` envelope and calls `POST /v1/runs` is part of step 6; look at how the SXU and collateral routes
(`src/app/api/...`, `src/lib/server/...`) hold the URL and token (for example `INDEMNIFICATION_API_URL`,
`INDEMNIFICATION_API_TOKEN`) and handle an unreachable service. TypeScript types for the request, response and
error envelopes still need adding to `src/lib/indemnificationContract.ts` (with the `Fields<T>` parity test).

**6. IND-T14 terminal route and UI (next).** Page at `/securities-lending/indemnification`: `INDEM` entry in `src/lib/nav.ts` (FINANCE
group, next to `SQZ`; update `nav.test.ts`), toggle in `settings/modules.config.json`, `on("INDEM")` route in
`src/App.tsx`, the tabs listed in `PLAN.md`, the close-out profile editor, and a mode switch (desk is the
default). Every figure shows seed, path count, standard error and the `SIM` label (AC-008).

**7. IND-T15.** Validation report, benchmark at 50,000 paths, as-built notes. Phase 2 starts only after this.

## Known issues and risks

- **Speed.** 5,000 paths on the SIM book: desk 4.8 s, annual (weekly) 16.8 s, so a 50,000-path annual run is
  under 3 minutes. The loops in `closeout.evaluate` over event steps are the cost. Profile before adding
  the pool; float32 for log prices and fewer temporary arrays are the first things to try.
- **Memory.** Exposures need `paths × borrowers × (event days + 1) × 4` bytes; the engine refuses more than
  2 GB. The service will need a clearer error and perhaps coarser steps by default for annual runs.
- **Test time** is about 35 s, mostly the 100,000–400,000-path statistical tests. Keep them; they are what
  catches modelling errors.
- **Pool simplifications.** Issuer defaults are independent across positions (scaled up when spreads widen) and not linked to the borrowers' copula; the pool is rescaled to the book's cash collateral so it starts exactly funded. Both are in `PLAN.md`.
- **Parameters are illustrative.** The rating PD table, factor volatilities and correlations, jump
  parameters, copula correlations, risk weights and cost of capital are placeholders labelled as such. The SIM
  book's figures (for example, on the SIM book a one-month desk run gives a default-channel EL of roughly $8k and a reinvestment EL of roughly $230k on a $6.5B book, the latter driven by the illustrative forced-sale floors) are smoke numbers, not results.
- **Concentration threshold.** In the SIM book the largest loan is 18% of average daily volume, so with the
  25% default only hard-to-borrow names get the longer close-out period.

## Open owner decisions

- **Decision 10** (phase 2 optimizer settings). Blocks phase 2 only. See `SPEC.md`.
- Whether the UI should print "not estimable" for tail metrics when too few paths contain any default
  (see the desk-view note above).
