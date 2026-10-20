# Spec020: Borrower Default and Indemnification Risk (INDEM)

- **ID:** spec020-indemnification-risk
- **Parent:** MARKET_TERMINAL_ROADMAP.md (SLAB, counterparty credit overlays); FUTURE_FEATURE_ROADMAP.md §3.1
- **Status:** Draft — scoping only; not approved for implementation. Decisions 1–7 and 9 resolved; decision 8 is open and blocks phase 1; decision 10 is open and blocks phase 2 only.
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-20

> WHAT and WHY only. Model architecture belongs in PLAN.md; task ordering belongs in TASKS.md.

## Summary

Build a standalone service that measures the agent lender's exposure under borrower-default indemnification. If a borrower defaults, the agent must buy back the loaned securities for the beneficial owner, using the borrower's collateral. If the collateral falls short, the agent pays the difference. This program also indemnifies losses on the reinvested cash collateral (decision 1), so the service models the reinvestment pool as a second loss channel. The service simulates borrower defaults together with market moves, including wrong-way risk. For each borrower and for the program as a whole, it reports expected exposure, potential future exposure (PFE), expected indemnification loss, tail loss, and a capital-cost view. It also shows how margin levels and collateral schedules change those numbers, and what indemnification costs in basis points against the fee each borrower pays. In phase 2, an optimizer recommends borrower loan limits, margin levels and collateral schedules that maximize fee revenue net of indemnification cost (decision 9).

## Problem & Context

An agent lender usually indemnifies its beneficial owners against one event: a borrower defaults and the collateral is not enough to buy back the loaned securities. This program goes further and also indemnifies reinvestment losses (decision 1). The borrower-default channel is a credit-contingent market risk:

- **Default:** the borrower fails (hazard rate from rating or spread).
- **Gap:** over the close-out period, the loaned security can rise while the collateral falls.
- **Wrong-way risk:** borrowers are more likely to fail in the same markets that widen the gap (a crash hits collateral; a squeeze lifts heavily shorted names).
- **Liquidation cost:** buying back a concentrated or hard-to-borrow position costs more than the mid price.

The reinvestment channel is a credit and liquidity risk on the cash collateral pool:

- **Pool impairment:** cash collateral is reinvested in short-term instruments. Credit spread moves or an issuer default can push the pool's value below the cash owed back to borrowers.
- **Forced sales:** when loans are returned or recalled faster than the liquid buckets can pay, term assets are sold at stressed prices and the loss is realized.
- **Interaction with default:** at a borrower default the cash collateral is only worth what the pool can realize, so pool impairment also widens the default shortfall.

Today the terminal shows a static, seeded counterparty credit overlay (`getCounterpartyCreditOverlays` in `src/data/econEnhancements.ts`). That table has a wrong-way flag and a margin-uplift column, but no model behind them. The SLAB loan book (`src/data/securitiesLending.ts`) has borrowers, loans and collateral types but no collateral holdings, margin levels or default view. Nothing in the terminal answers "what does our indemnity cost, and which borrower is driving it?"

## Goals

- Simulate correlated borrower defaults and market moves in two run modes: a short-horizon desk view of today's book and an annual view of a constant book.
- Compute, for each borrower and at program level: expected exposure (EE) and expected positive exposure (EPE) profiles, PFE at 95% and 99%, expected indemnification loss (EL), and 99% and 99.9% loss quantiles and expected shortfall.
- Make wrong-way risk explicit, and show results with and without it.
- Model reinvestment pool losses on both default and non-default paths, and report them as a separate channel from the default shortfall.
- Allocate program tail loss to borrowers (Euler contributions) so the main sources of risk are visible.
- Cross-check against a deterministic regulatory-style formula (Basel comprehensive approach for securities financing transactions).
- Show how EL and PFE respond to margin level, collateral schedule and close-out period.
- Express indemnification cost in basis points of loan value next to each borrower's fee, giving an indemnification-adjusted return.
- Run named deterministic stress scenarios (default of the largest borrower, short squeeze, rates shock, FX shock, reinvestment pool run).
- Phase 2: recommend borrower loan limits, margin levels and collateral schedules that maximize fees net of expected loss and capital cost, within a risk budget, and prove the recommendation on paths it was not fitted to.

## Non-goals

- Real regulatory capital calculation, filings, or an approved internal model.
- Live CDS, ratings-agency or broker feeds. Inputs are synthetic or user-entered, and labelled as such.
- Automatic changes to margin, schedules or borrower limits. The service recommends and a human decides.
- Real firm names as borrowers or owners (see `fictionalCounterparties.test.ts`).
- Treating synthetic results as evidence of real-world risk levels.

## Requirements

| ID | Requirement | Priority |
|---|---|---|
| IND-001 | Accept a versioned, hashed snapshot: loans (security, quantity, price, borrower, owner, open or term), collateral per borrower (asset, quantity, price, currency, schedule), margin requirement, reinvestment pool positions and each owner's share of the pool, borrower credit inputs, and market factor parameters. The service has no database dependency. | must |
| IND-002 | Generate a deterministic synthetic book (borrowers, loans, collateral, credit inputs) with a fixed seed for development and tests, labelled `SIM`, using fictional counterparties only. | must |
| IND-003 | Simulate market paths for loaned securities and collateral with a factor model (equity, rates, credit, FX), plus a jump component for hard-to-borrow names, over a configurable horizon. | must |
| IND-004 | Simulate borrower default times from a hazard-rate term structure, correlated with each other and with the market factor through a copula whose parameters are inputs. | must |
| IND-005 | At default, close out over a configurable close-out period: buy back loaned securities with a liquidity cost scaled by position size versus average daily volume, sell collateral net of its liquidity cost, and record the shortfall (never negative). | must |
| IND-006 | Report EE and EPE profiles, PFE95 and PFE99, EL, loss VaR99 and VaR99.9, and expected shortfall, for each borrower and at program level, with Monte Carlo standard errors. | must |
| IND-007 | Report every metric with wrong-way correlation on and with it set to zero, and show the difference. | must |
| IND-008 | Allocate program expected shortfall to borrowers with Euler contributions that sum to the total within Monte Carlo tolerance. | must |
| IND-009 | Compute a deterministic Basel comprehensive approach exposure (E* = max(0, E(1+He) − C(1−Hc−Hfx))) per netting set as an independent cross-check, with the haircut table labelled illustrative. | must |
| IND-010 | Run sensitivities of EL and PFE99 to margin level, close-out period, correlation and collateral substitution, and to any other numeric parameter in the close-out profile (IND-020). | must |
| IND-011 | Run named deterministic stress scenarios and report shortfall by borrower and owner. | must |
| IND-012 | Using the annual view (IND-021), express indemnification cost in bps per year per borrower as (EL + cost of capital × economic capital) / average loan value, next to fee earned. Economic capital is annual VaR99.9 minus EL, allocated to borrowers by their Euler expected-shortfall contributions. Show a regulatory capital proxy (comprehensive approach exposure × rating risk weight × 8%) alongside for comparison only. Flag borrowers whose cost exceeds a configurable share of their fee. | must |
| IND-013 | Show results in the terminal with source, as-of date, seed, model version and `SIM` labels, and show missing inputs as unavailable, never filled with synthetic data. | must |
| IND-014 | Record a model card for each run: version, input hash, seed, path count, convergence and validation results. | must |
| IND-015 | Simulate the cash collateral reinvestment pool: each position's value under credit spread moves and issuer default, loan returns and recalls paid from the most liquid buckets first, and forced sales of term assets at a stressed liquidity cost. | must |
| IND-016 | Value cash collateral at the pool's realizable value, not par, in the default close-out (IND-005). | must |
| IND-017 | Report losses by channel (default shortfall, reinvestment loss) for every metric in IND-006, IND-008 and IND-011, and allocate reinvestment losses to beneficial owners pro rata to their share of the pool. | must |
| IND-018 | Derive each borrower's default probabilities from an illustrative rating-to-PD table, unless the user enters a credit spread for that borrower, which then overrides the table. Show which source each borrower uses. | must |
| IND-019 | Run the Gaussian copula as the main model and a Student-t copula with the same marginal PDs as a sensitivity, and report the program loss quantiles and expected shortfall under both. | must |
| IND-020 | Take close-out and liquidity settings from a named, versioned close-out profile in which every parameter is user-configurable. Overrides apply in order (position, then borrower, then asset class or pool bucket, then global default), and stress scenarios can override any of them. Invalid values are rejected with an explanation, and every result reports the effective values it used. | must |
| IND-021 | Support two run modes. The desk view (default) simulates today's actual book over 1 month in daily steps. The annual view simulates a constant book, rolled and re-margined, over 1 year in weekly steps with daily steps inside close-out periods. Horizon, step and path count are configurable within set limits, and every result states which mode, horizon, step and path count produced it. | must |

### Phase 2: Indemnification Optimizer (decision 9)

Phase 2 starts only after phase 1 passes its validation report (IND-T15) and decision 10 is resolved.

| ID | Requirement | Priority |
|---|---|---|
| IND-022 | Recommend, per borrower, a loan limit (up to demand), a minimum margin for each collateral type, and which collateral types are accepted, to maximize fees − EL − cost of capital × tail-loss capital measure. | must |
| IND-023 | Respect borrower demand, lendable inventory, minimum margins, collateral concentration limits, a program tail-loss budget, and an optional limit on how far each setting can move from today. | must |
| IND-024 | Assume each borrower posts whichever accepted collateral is worst for the lender, so a broader schedule is never credited with better collateral than the borrower would choose. | must |
| IND-025 | Re-run the recommended setup through the full phase 1 simulator on fresh paths it was not fitted to, and report fitted and fresh-path results side by side. | must |
| IND-026 | Verify every constraint independently, show current against recommended per borrower (revenue, EL, capital, tail loss), and report infeasibility with the binding constraints rather than a partial result. | must |
| IND-027 | Recommend only. No limit, margin or schedule changes without a person approving them. | must |

## Acceptance Criteria

- **AC-001:** The same seed and snapshot produce identical results; a different seed changes results only within the reported standard error.
- **AC-002:** A single loan with independent default and a hand-computable gap distribution matches the closed form EL = PD × E[shortfall] within 3 standard errors.
- **AC-003:** EL and PFE increase monotonically with wrong-way correlation and close-out period, and decrease with margin level, on a fixed seed.
- **AC-004:** A fully cash-collateralized loan at 105% margin with no price moves has zero shortfall; zero PD gives zero EL.
- **AC-005:** Euler contributions sum to program expected shortfall within 1%.
- **AC-006:** The Basel comprehensive approach output matches hand-computed cases, including the FX-mismatch haircut.
- **AC-007:** Every borrower and owner name in fixtures passes the fictional-counterparty test.
- **AC-008:** The UI never shows a metric without its seed, path count, standard error and `SIM` or user-entered label.
- **AC-009:** A pool held entirely in overnight cash-equivalent buckets has zero reinvestment loss. A pool with a single term asset and a hand-set spread shock and return wave matches a hand-computed forced-sale loss.
- **AC-010:** Channel totals add up to the total loss on every path, and owner allocations of the reinvestment loss add up to the pool loss.
- **AC-011:** A borrower with a user-entered spread s and recovery R gets hazard s / (1 − R) and PD(t) = 1 − exp(−t · s / (1 − R)), matching a hand calculation. Removing the spread falls back to the rating table, and the source label changes with it.
- **AC-012:** The Student-t run recovers each borrower's marginal PD within standard error, has heavier joint-default tails than the Gaussian run on the same seed, and converges to the Gaussian result as degrees of freedom grow. Parameters with ρ_W² > ρ_D are rejected with an explanation.
- **AC-013:** The default profile reproduces the decision 4 values exactly. An override at each level changes only the positions it covers, a higher level wins over a lower one, and the effective values reported for each position match the precedence rule. Out-of-range values are rejected before any simulation runs.
- **AC-014:** The two modes use the same random draws, settings and close-out profile. In the desk view a term loan stops contributing exposure after its maturity date. In the annual view, book size and mix stay constant at each roll date. Settings outside the limits are rejected before any simulation runs. Results never mix the two modes without labelling each figure.
- **AC-015:** Borrower economic capital sums to program economic capital. A two-borrower fixture matches hand-computed cost in bps under both capital measures. Only the economic-capital cost drives the flag, and changing the cost-of-capital rate, the flag threshold or a risk weight changes the outputs as expected.

### Phase 2 acceptance criteria

- **AC-016:** On a two-borrower, small-path fixture, the optimizer matches a hand-solved or brute-force optimum within solver tolerance, and the independent verifier rejects a tampered solution.
- **AC-017:** Tightening the tail-loss budget never increases recommended exposure or tail loss; a budget below the minimum achievable returns infeasible with the binding constraints named.
- **AC-018:** The recommended setup's fresh-path results stay within the reported tolerance of its fitted results, or the gap is flagged as possible overfitting.
- **AC-019:** Adding a collateral type to a borrower's schedule never lowers that borrower's shortfall on any path (worst-case collateral rule).

## Decisions required before implementation

1. ~~**Indemnification scope.** Borrower-default shortfall only, or also cash collateral reinvestment losses?~~ **Resolved 2026-10-19:** both. See the decision log.
2. ~~**Credit inputs.** Rating-to-PD lookup table, user-entered spreads, or both?~~ **Resolved 2026-10-19:** both; spreads override the table per borrower. See the decision log.
3. ~~**Dependence model.** Gaussian, Gaussian plus Student-t sensitivity, or Student-t?~~ **Resolved 2026-10-19:** Gaussian main model with a Student-t sensitivity. See the decision log.
4. ~~**Close-out and liquidity.** Close-out periods and the liquidity cost formula.~~ **Resolved 2026-10-19:** proposed values accepted as defaults, with every setting configurable. See the decision log.
5. ~~**Horizon and paths.**~~ **Resolved 2026-10-19:** two run modes, desk view (1 month, default) and annual view (1 year). See the decision log.
6. ~~**Capital and pricing.**~~ **Resolved 2026-10-19:** economic capital drives the flag; the regulatory proxy is shown alongside. See the decision log.
7. ~~**Placement.** Service, port, page and profile storage.~~ **Resolved 2026-10-20:** new service on port 8018, its own page at `/securities-lending/indemnification`. See the decision log.
8. **Book source.** Build an INDEM-only synthetic book, or extend `src/data/securitiesLending.ts` with collateral holdings and margin (and link it to the reinvestment pool in `src/data/reinvestment.ts`) so SLAB, the reinvestment view and INDEM show the same book? Extending is recommended so the two views reconcile.

9. ~~**Optimizer.**~~ **Resolved 2026-10-20:** add an Indemnification Optimizer to spec020 as phase 2. See the decision log.
10. **Optimizer settings (blocks phase 2 only).** Margin levels offered (proposed 102%, 103%, 105%, 108%, 110%); tail-loss measure and level for the optimizer (expected shortfall, because VaR cannot be optimized as a linear program, at 99% because 99.9% leaves too few tail paths); program risk budget; limit on movement from today's settings; source of the fee uplift for broader collateral schedules (user-entered per borrower and collateral type, labelled illustrative); whether reinvestment losses are held fixed in phase 2; and the tolerance for the fresh-path check.

## Known issue found while scoping

`getCounterpartyCreditOverlays` in `src/data/econEnhancements.ts` lists "BlueCrest" with an invented rating and a haircut escalation. BlueCrest is a real firm, and it is not in the `REAL_FIRMS` pattern, so the fictional-counterparty test does not catch it. Rename it and add it to the pattern before INDEM reuses those overlays.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-19 | **Decision 1 resolved — indemnification covers borrower-default shortfall and cash collateral reinvestment losses.** This goes beyond the market-standard agency indemnity, where reinvestment losses sit with the beneficial owner, and is a deliberate choice for this program. The service therefore models the reinvestment pool (IND-015), values cash collateral at the pool's realizable value at default (IND-016), and reports the two channels separately (IND-017) so each can be read and priced on its own. Reinvestment pool inputs follow the shape of `src/data/reinvestment.ts`. | Owner |
| 2026-10-19 | **Decision 2 resolved — credit inputs use a rating-to-PD table, overridable per borrower by a user-entered credit spread.** Every borrower has a rating, and the table maps rating to a 1-year PD, extended to a term structure with a constant hazard rate. The table is a versioned fixture labelled illustrative. If the user enters a spread for a borrower, the hazard rate becomes spread / (1 − recovery) and replaces the table value for that borrower. Recovery is entered with the spread (default 40%, labelled illustrative). The first release takes one flat spread per borrower. Each borrower shows its source (`RATING_TABLE` or `USER_SPREAD`) in the UI and in the model card. A live source of credit data still needs its own decision. | Owner |
| 2026-10-19 | **Decision 3 resolved — one-factor Gaussian copula as the main model, with a Student-t copula as a sensitivity.** Each borrower's latent variable is X_i = ρ_W · Z_eq + √(ρ_D − ρ_W²) · Z_sys + √(1 − ρ_D) · ε_i, so ρ_D is the pairwise default correlation and ρ_W is the wrong-way link to the simulated equity factor. The Student-t run divides every X_i on a path by a shared √(W/ν), with W drawn from χ²(ν), and uses Student-t quantiles so that each borrower keeps its marginal PD. Starting values, all configurable and labelled illustrative: ρ_D = 0.25, ρ_W = 0.30, ν = 5. Inputs must satisfy ρ_W² ≤ ρ_D. Both runs use the same random draws. | Owner |
| 2026-10-19 | **Decision 4 resolved — the proposed close-out and liquidity values are the defaults, and every setting is configurable.** Default close-out periods (business days): 5 for liquid equities and G7 government bonds; 10 for other bonds, smaller-company equities and emerging markets; 10 for hard-to-borrow or concentrated positions (over 25% of average daily volume); 5 for forced sales of TERM reinvestment assets. Default liquidity cost: k · σ_daily · (q / ADV)^α with k = 0.5 and α = 0.5. All defaults are labelled illustrative. The owner asked for the settings to be extremely customizable, so they live in a named, versioned close-out profile (IND-020, PLAN section 3a). The extra settings it adds (spread floor, cost cap, stress multiplier, unwind schedule, margin-call frequency, close-out add-on days) are neutral by default, so the default profile gives exactly the values above. | Owner |
| 2026-10-19 | **Decision 5 resolved — two run modes, with the short-horizon desk view as the default.** A static one-year projection is unrealistic for a book of mostly open, recallable loans with daily margining, but annual figures are still needed for pricing and capital. **Desk view (default):** today's actual book over 1 month (21 business days) in daily steps; term loans run to maturity and open loans follow the return assumption. It drives the exposure profile, PFE, stress tests and the reinvestment liquidity ladder. **Annual view:** a constant book, rolled and re-margined so size and mix stay the same, over 1 year in weekly steps with daily steps inside each close-out period. It drives annual expected loss, indemnification cost against fees, the capital charge and annual tail loss. Both modes share random draws, settings and the close-out profile. Defaults: 50,000 paths for reported figures and 5,000 for interactive previews, which are labelled as previews. Configurable limits: horizon 1 month to 5 years; daily, weekly or monthly steps; 1,000 to 500,000 paths. Convergence check: halving the path count moves results by less than 2 standard errors. | Owner |
| 2026-10-19 | **Decision 6 resolved — economic capital drives pricing and the flag; a regulatory proxy is shown alongside.** From the annual view: economic capital = annual VaR99.9 − EL (unexpected loss), covering both loss channels and wrong-way risk, allocated to borrowers in proportion to their Euler expected-shortfall contributions. Reinvestment losses not tied to a borrower's default are attributed to borrowers pro rata to their share of the cash collateral in the pool. Indemnification cost (bps per year) = (EL + cost of capital × economic capital) / average loan value. The regulatory proxy (comprehensive approach E* × risk weight from rating × 8%) is shown next to it for comparison and does not drive the flag; it cannot see wrong-way risk or reinvestment losses, and the UI says so. Defaults, all configurable and labelled illustrative: cost of capital 10% a year; flag when cost exceeds 50% of the borrower's fee; risk weights by rating AAA to AA− 20%, A+ to A− 50%, BBB+ to BB− 100%, below BB− 150%, unrated 100%. | Owner |
| 2026-10-20 | **Decision 7 resolved — own service and own page.** Service: `services/indemnification_api` on port 8018 (8013–8017 are taken). Page: `/securities-lending/indemnification`, with an `INDEM` entry in `src/lib/nav.ts` (FINANCE group, next to `SQZ`), an `INDEM` toggle in `settings/modules.config.json`, and an `on("INDEM")` route in `src/App.tsx`, following the Squeeze Radar pattern. A tab inside the SLAB page was rejected because the module has too many views (overview, borrowers, profiles, sensitivities, stresses, reinvestment, and the phase 2 optimizer). Close-out profile storage: the default profile is a versioned JSON file in `contracts/indemnification/`; user profiles are saved in the browser with JSON export and import; every run record stores the full resolved profile and its hash, so no saved result depends on browser storage. | Owner |
| 2026-10-20 | **Decision 9 resolved — add an Indemnification Optimizer to spec020 as phase 2.** It recommends borrower loan limits, margin levels and accepted collateral types that maximize fees net of expected loss and capital cost, within demand, inventory, margin, concentration and risk-budget constraints (IND-022–027). It is built only after the phase 1 measurement model passes validation, because recommendations resting on unvalidated loss figures would be confidently wrong. It recommends only; changes need human approval. Its settings are decision 10, which blocks phase 2 but not phase 1. | Owner |

## Related documents

- Loan book and borrowers: `src/data/securitiesLending.ts`, `src/data/universe.ts`
- Reinvestment pool positions: `src/data/reinvestment.ts`
- Static credit overlay to replace or feed: `src/data/econEnhancements.ts`
- Collateral model and schedules: spec015, spec016
- Shared solver library (sensitivity search only, if needed): `services/optimization_core/`
