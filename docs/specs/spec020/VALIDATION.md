# Spec020 validation report: Borrower default and indemnification risk (INDEM), phase 1

**Date:** 2026-10-21. **Covers:** model version `indem-0.1.0`, as merged in PR #188 (`6e21ccd`).
**Data:** every figure comes from the simulated lending book (label `SIM`) and illustrative parameters. Nothing
here says anything about real counterparties, real loss rates or capital. This report shows the model does what
the spec says; it does not show the parameters are right.

## 1. What was checked

| Criterion | Evidence | Where |
|---|---|---|
| AC-001 same seed, same result; new seed within standard error | seed reproducibility and seed-change tests | `tests/test_engine.py` |
| AC-002 single independent loan matches the closed form within 3 SE | Black-formula test | `tests/test_engine.py` |
| AC-003 EL and PFE rise with wrong-way correlation and close-out period, fall with margin, on a fixed seed | exact monotonicity on common random numbers (see 3.1) | `tests/test_sensitivity.py`, `tests/test_market.py` |
| AC-004 fully collateralized, no price move: zero shortfall; zero PD: zero EL | hand cases | `tests/test_closeout.py`, `tests/test_engine.py` |
| AC-005 Euler contributions sum to program ES | exact (to 1e-9), asserted as a model-card check | `tests/test_metrics.py`, `tests/test_results.py` |
| AC-006 Basel comprehensive approach, incl. FX haircut | 10 hand-computed cases | `tests/test_basel.py` |
| AC-007 fictional counterparty names | name-pattern guard; BlueCrest renamed | `src/data/fictionalCounterparties.test.ts` |
| AC-008 no metric without seed, paths, SE and label | every KPI renders `SIM · seed · paths` and `SE`; no `undefined` or `NaN` on any tab | `test/indemnification.spec.ts` (Playwright), `tests/test_results.py` |
| AC-009 all-overnight pool loses nothing; single term asset matches hand forced-sale loss | hand cases | `tests/test_pool.py`, `tests/test_engine.py` |
| AC-010 channel, borrower and owner totals add up | sums asserted for program, borrowers, owners | `tests/test_results.py` |
| AC-011 spread and recovery give hazard `s / (1 − R)`; removal falls back to the table | hand calculation | `tests/test_credit.py` |
| AC-012 Student-t marginals, heavier joint tails, convergence as ν grows | 400k-draw tests | `tests/test_defaults.py` |
| AC-013 default profile, override precedence, effective values per position | resolution tests | `tests/test_profile.py`, `tests/test_schema.py` |
| AC-014 both modes share draws and settings; term loans stop at maturity; annual book rolls | grid and activity tests | `tests/test_grid.py` |
| AC-015 economic capital sums to the program; hand-computed bps; flag by economic cost only | 19 tests | `tests/test_pricing.py` |
| AC-020 existing SLAB outputs unchanged by the book extension | golden hashes taken before the change | `src/data/slGolden.test.ts` |
| AC-016 to AC-019 | phase 2 (optimizer), not built | n/a |

Suites at this commit: 266 Python tests (`ruff check` and `ruff format --check` clean, numeric `RuntimeWarning`s are
errors), 1,038 TypeScript tests, 4 Playwright tests for the page (service replaced by a canned response built from
the contract fixture) plus the page's smoke checks. `npx tsc --noEmit` and `npm run build` succeed.

The page was also driven in Chromium against the live service on the SIM book: a desk preview run populates all
seven tabs, with no console errors beyond React Router's own future-flag warnings.

## 2. Benchmark

Sandbox: 4 vCPU, Python 3.13, numpy 2.5.4, one process. SIM book of 108 loans. Seed 1. Peak memory is the process
peak so far, so it can only rise down the table.

| Run | Paths | Sweeps / stresses | Time | Peak RSS |
|---|---|---|---|---|
| Desk, 21 days, daily steps | 5,000 (preview) | none | 5.2 s | 440 MB |
| Desk, 21 days, daily steps | 50,000 | stresses | 45.7 s | 741 MB |
| Annual, 252 days, weekly steps | 5,000 (preview) | stresses | 18.9 s | 2.2 GB |
| Annual, 252 days, weekly steps | 50,000 | stresses | **163 s** | **3.5 GB** |
| Annual, 252 days, weekly steps | 50,000 | stresses + 4 sweeps at 5,000 paths | **414 s** | 3.5 GB |
| Page default (desk preview) through the terminal | 5,000 | 4 sweeps at 2,000 paths, stresses | 21 to 24 s | n/a |

The spec's target (an annual 50,000-path run in under about 3 minutes) is met for the main run only. Sweeps cost a
full model run per point (about 3 s each at 5,000 paths on this book), so they dominate any run that includes them.
Before this checkpoint the page defaulted sweeps to 5,000 paths and a preview took 54 s; it now defaults to 2,000
and takes about 22 s.

Convergence check (first half of the chunks against all of them): desk 50,000 paths, largest shift 1.61 standard
errors, passed; annual 50,000 paths, 0.80, passed. Preview runs do not run it and say so.

## 3. Defects found by this validation, and what was done

1. **A close-out sweep was not on common random numbers (fixed).** Prices are simulated for the horizon plus the
   longest close-out period, and draws were laid out `(paths, days, …)`, so changing that period reshuffled every
   path and the sweep mixed parameter effect with noise. The Close-out period sensitivity was visibly non-monotone
   in the browser. Draws now come from one stream per array, day by day, so the first d days of every path do not
   depend on the total (`market.simulate_paths`; regression test `test_the_early_days_of_every_path_…`). After the
   fix the sweep rises smoothly (default-channel EL $1.6K to $15.9K for 3 to 20 days). A sweep-level test on the
   pool book guards it.
2. **The "conditional and sampled expected loss agree" check failed on ordinary runs (fixed).** It compared means
   in standard errors even when the sampled estimator was almost all zeros (a one-month investment-grade desk run
   expects about one default in 1,000 paths). Over 12 seeds it exceeded 4 SE on 7 at 1,000 paths and 2 at 3,000
   paths, on the old draw code too, so this was not caused by the fix above. It now reports `passed: null` ("not
   assessed") unless at least 30 sampled paths have a loss (`MIN_LOSS_PATHS_FOR_AGREEMENT`). The model-card schema
   allows null and the page shows "Not assessed". It is assessed and passes on the annual 50,000-path run.
3. **Recorded, not fixed (see HANDOFF, priority 1):** a reported annual run with sweeps (414 s) exceeds the
   terminal proxy's 300 s run timeout, and memory reaches 3.5 GB. Cancel in the page aborts the browser request
   only; the service keeps its single run slot until the model finishes (not tested end to end).

## 4. Behaviour that looks like a bug and is not

- **Zero in three of the five stresses on the SIM book.** The borrower's pooled collateral and 5% margin buffer
  absorb a one-loan squeeze and a 20% equity fall; the book holds no non-USD positions, so the FX shock changes
  nothing. Tests pin this. The rates shock and the reinvestment run are the informative stresses on this book.
- **Total EL is not monotone in margin.** More cash margin lowers default shortfall but enlarges the pool; the
  sweep shows the channels separately.
- **Desk-view tail metrics are often 0.** Almost no one-month path contains a default for an investment-grade book.
  Use the annual view for tail risk.
- **Reinvestment dominates EL on the SIM book** because of the illustrative forced-sale floors and issuer-default
  parameters.

## 5. Limitations

- All parameters are illustrative placeholders (rating PDs, factor volatilities and correlations, jump parameters,
  copula correlations, forced-sale floors, risk weights, cost of capital, Basel haircuts).
- Pool issuer defaults are independent across positions and not linked to the borrowers' copula (PLAN.md).
- Economic capital is `VaR99.9 − EL`, split by Euler ES99.9 shares; it is not a regulatory or accounting figure.
- Pricing exists only for an annual run over 252 business days.
- Local only: the terminal route returns 403 in production and the service refuses production unless an operator
  sets `INDEM_PRODUCTION_ENABLED`.
- Not run: Python 3.12 locally (CI runs it), real data of any kind, multi-user load, runs above 50,000 paths.
