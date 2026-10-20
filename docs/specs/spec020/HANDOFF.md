# Spec020 build handoff: Borrower default and indemnification risk (INDEM)

**Updated:** 2026-10-20

**Branch:** `spec020-indemnification-scope`, open as [PR #188](https://github.com/thatquantguy44/QuantMeridian/pull/188) against `main`.

**State:** phase 1 is **approved** (2026-10-20, decisions 1–9). The model core is built and tested in Python:
the contract, the close-out profile, market paths, the default copula, loan returns, the reinvestment pool,
the close-out shortfall, risk metrics, the engine and the result/model-card assembly. There is **no HTTP API
and no UI page yet**, and the Basel cross-check, sensitivities, stresses and pricing are not built. Phase 2 (the optimizer) is not approved: decision 10 is open.

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
| IND-T10 – T12 | Basel cross-check, sensitivities and stresses, pricing | Not started |
| IND-T13 | Service API | Not started |
| IND-T14 | UI page, route, nav, profile editor | Not started |
| IND-T15 | Validation report, benchmark, as-built | Not started |
| IND-T16 – T21 | Phase 2 optimizer | Not approved |

Test counts at handoff: 188 Python (`services/indemnification_api`), 916 TypeScript (whole repo).
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

**2. IND-T10 Basel cross-check.** `E* = max(0, E(1+He) − C(1−Hc−Hfx))`, haircuts scaled by `sqrt(MPOR/10)`,
labelled illustrative. Put the haircut table in the snapshot (contract change #3) for the same reason as the
rating table. Compare with Monte Carlo PFE99 in `cross_check`.

**3. IND-T11 sensitivities and stresses.** Sensitivities reuse the same seed (common random numbers) while
sweeping margin, MPOR, `rho_w`, a collateral substitution, or any numeric profile setting. Stresses need
conditioned paths: add a shock to the simulated log prices from a chosen day and force the default (largest
borrower with a −20% equity move; a +60% squeeze on the most concentrated hard-to-borrow loan; +150 bp rates;
15% FX, which has no effect on a USD-only book; the reinvestment run once the pool exists). Per-scenario
profile overrides are required (IND-020).

**4. IND-T12 pricing.** Economic capital = annual VaR99.9 − EL, allocated by Euler contributions; cost in bps
per year against fee; regulatory proxy beside it; flag when cost exceeds the threshold share of the fee.
Annual view only.

**5. IND-T13 service API.** FastAPI app, token auth, health, a run endpoint taking a snapshot and returning a
result, in-memory run history with hashes (no database), a capability manifest like
`services/money_market_api/capability-manifest.json`, port 8018. Then the terminal server route that builds
the snapshot with `buildSimSnapshot` and calls it; look at how the SXU and collateral routes do it.

**6. IND-T14 UI.** Page at `/securities-lending/indemnification`: `INDEM` entry in `src/lib/nav.ts` (FINANCE
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
