# Spec020: Borrower Default and Indemnification Risk (INDEM)

- **ID:** spec020-indemnification-risk
- **Parent:** MARKET_TERMINAL_ROADMAP.md (SLAB, counterparty credit overlays); FUTURE_FEATURE_ROADMAP.md §3.1
- **Status:** Draft — scoping only; not approved for implementation. Decisions 1–2 resolved 2026-10-19; decisions 3–8 are open.
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-19

> WHAT and WHY only. Model architecture belongs in PLAN.md; task ordering belongs in TASKS.md.

## Summary

Build a standalone service that measures the agent lender's exposure under borrower-default indemnification. If a borrower defaults, the agent must buy back the loaned securities for the beneficial owner, using the borrower's collateral. If the collateral falls short, the agent pays the difference. This program also indemnifies losses on the reinvested cash collateral (decision 1), so the service models the reinvestment pool as a second loss channel. The service simulates borrower defaults together with market moves, including wrong-way risk. For each borrower and for the program as a whole, it reports expected exposure, potential future exposure (PFE), expected indemnification loss, tail loss, and a capital-cost view. It also shows how margin levels and collateral schedules change those numbers, and what indemnification costs in basis points against the fee each borrower pays.

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

- Simulate correlated borrower defaults and market moves over a stated horizon.
- Compute, for each borrower and at program level: expected exposure (EE) and expected positive exposure (EPE) profiles, PFE at 95% and 99%, expected indemnification loss (EL), and 99% and 99.9% loss quantiles and expected shortfall.
- Make wrong-way risk explicit, and show results with and without it.
- Model reinvestment pool losses on both default and non-default paths, and report them as a separate channel from the default shortfall.
- Allocate program tail loss to borrowers (Euler contributions) so the main sources of risk are visible.
- Cross-check against a deterministic regulatory-style formula (Basel comprehensive approach for securities financing transactions).
- Show how EL and PFE respond to margin level, collateral schedule and close-out period.
- Express indemnification cost in basis points of loan value next to each borrower's fee, giving an indemnification-adjusted return.
- Run named deterministic stress scenarios (default of the largest borrower, short squeeze, rates shock, FX shock, reinvestment pool run).

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
| IND-010 | Run sensitivities of EL and PFE99 to margin level, close-out period, correlation and collateral substitution. | must |
| IND-011 | Run named deterministic stress scenarios and report shortfall by borrower and owner. | must |
| IND-012 | Express indemnification cost in bps per year per borrower (EL plus a capital charge at a configurable cost-of-capital rate) next to fee earned, and flag borrowers whose fee does not cover it. | should |
| IND-013 | Show results in the terminal with source, as-of date, seed, model version and `SIM` labels, and show missing inputs as unavailable, never filled with synthetic data. | must |
| IND-014 | Record a model card for each run: version, input hash, seed, path count, convergence and validation results. | must |
| IND-015 | Simulate the cash collateral reinvestment pool: each position's value under credit spread moves and issuer default, loan returns and recalls paid from the most liquid buckets first, and forced sales of term assets at a stressed liquidity cost. | must |
| IND-016 | Value cash collateral at the pool's realizable value, not par, in the default close-out (IND-005). | must |
| IND-017 | Report losses by channel (default shortfall, reinvestment loss) for every metric in IND-006, IND-008 and IND-011, and allocate reinvestment losses to beneficial owners pro rata to their share of the pool. | must |
| IND-018 | Derive each borrower's default probabilities from an illustrative rating-to-PD table, unless the user enters a credit spread for that borrower, which then overrides the table. Show which source each borrower uses. | must |

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

## Decisions required before implementation

1. ~~**Indemnification scope.** Borrower-default shortfall only, or also cash collateral reinvestment losses?~~ **Resolved 2026-10-19:** both. See the decision log.
2. ~~**Credit inputs.** Rating-to-PD lookup table, user-entered spreads, or both?~~ **Resolved 2026-10-19:** both; spreads override the table per borrower. See the decision log.
3. **Dependence model.** One-factor Gaussian copula linking defaults to the equity factor (recommended), with a Student-t copula as a sensitivity? Default correlation and wrong-way parameters?
4. **Close-out and liquidity.** Default close-out period by asset class (proposed: 5 business days for liquid equities and government bonds, 10 for others and hard-to-borrow names), and the liquidity cost formula and its parameters.
5. **Horizon and paths.** Proposed horizon of 1 year with weekly steps; 50,000 paths for reported figures, with a smaller run for interactive sensitivities. Accept?
6. **Capital and pricing.** Should IND-012 use the comprehensive approach exposure, Monte Carlo VaR99.9, or both for the capital charge? What illustrative cost-of-capital rate?
7. **Placement.** New service `services/indemnification_api` on port 8018 (8013–8017 are taken), and a route at `/securities-lending/indemnification` behind a new `INDEM` toggle, or a tab on the SLAB page?
8. **Book source.** Build an INDEM-only synthetic book, or extend `src/data/securitiesLending.ts` with collateral holdings and margin (and link it to the reinvestment pool in `src/data/reinvestment.ts`) so SLAB, the reinvestment view and INDEM show the same book? Extending is recommended so the two views reconcile.

## Known issue found while scoping

`getCounterpartyCreditOverlays` in `src/data/econEnhancements.ts` lists "BlueCrest" with an invented rating and a haircut escalation. BlueCrest is a real firm, and it is not in the `REAL_FIRMS` pattern, so the fictional-counterparty test does not catch it. Rename it and add it to the pattern before INDEM reuses those overlays.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-19 | **Decision 1 resolved — indemnification covers borrower-default shortfall and cash collateral reinvestment losses.** This goes beyond the market-standard agency indemnity, where reinvestment losses sit with the beneficial owner, and is a deliberate choice for this program. The service therefore models the reinvestment pool (IND-015), values cash collateral at the pool's realizable value at default (IND-016), and reports the two channels separately (IND-017) so each can be read and priced on its own. Reinvestment pool inputs follow the shape of `src/data/reinvestment.ts`. | Owner |
| 2026-10-19 | **Decision 2 resolved — credit inputs use a rating-to-PD table, overridable per borrower by a user-entered credit spread.** Every borrower has a rating, and the table maps rating to a 1-year PD, extended to a term structure with a constant hazard rate. The table is a versioned fixture labelled illustrative. If the user enters a spread for a borrower, the hazard rate becomes spread / (1 − recovery) and replaces the table value for that borrower. Recovery is entered with the spread (default 40%, labelled illustrative). The first release takes one flat spread per borrower. Each borrower shows its source (`RATING_TABLE` or `USER_SPREAD`) in the UI and in the model card. A live source of credit data still needs its own decision. | Owner |

## Related documents

- Loan book and borrowers: `src/data/securitiesLending.ts`, `src/data/universe.ts`
- Reinvestment pool positions: `src/data/reinvestment.ts`
- Static credit overlay to replace or feed: `src/data/econEnhancements.ts`
- Collateral model and schedules: spec015, spec016
- Shared solver library (sensitivity search only, if needed): `services/optimization_core/`
