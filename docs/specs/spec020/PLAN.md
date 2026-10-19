# Plan: Borrower Default and Indemnification Risk (INDEM)

- **Spec:** spec020-indemnification-risk (SPEC.md)
- **Status:** Draft — pending owner review; decisions 1–3 resolved 2026-10-19; other parameters below are proposals until their SPEC decisions are resolved
- **Last updated:** 2026-10-19

## Approach

The terminal builds a versioned, hashed snapshot of the lending book (loans, collateral, margin, borrower credit inputs, factor parameters) and sends it to the INDEM service. The service has no database connection and cannot substitute local data. It runs a Monte Carlo simulation of markets and defaults, closes out each defaulted borrower, and returns exposure and loss metrics with standard errors, a model card and a deterministic regulatory cross-check. Every output carries source, as-of date, seed and model version.

## Model

### 1. Market paths

- Factors: equity index, rates level, credit spread, and FX for each non-USD currency, as correlated Gaussian shocks over weekly steps.
- Each loaned security or collateral asset has a factor beta and its own idiosyncratic volatility. Bonds are priced with duration and convexity against the rates and spread factors.
- Hard-to-borrow names get a Merton jump component (upward jumps), so short squeezes appear in the tail of the loaned-security side.

### 2. Default times

- Each borrower has a constant hazard rate (decision 2). By default it comes from the illustrative rating-to-PD table: λ = −ln(1 − PD₁ᵧ). If the user enters a spread s with recovery R for that borrower, it overrides the table: λ = s / (1 − R). Each borrower's source (`RATING_TABLE` or `USER_SPREAD`) is carried into the results and the model card.
- Dependence: a one-factor copula. Borrower i defaults by time t when Φ⁻¹(U_i) ≤ Φ⁻¹(PD_i(t)), with the latent variable X_i = ρ_W · Z_eq + √(ρ_D − ρ_W²) · Z_sys + √(1 − ρ_D) · ε_i. Z_eq is the simulated equity factor, which links defaults to market moves (wrong-way risk). Z_sys is a shared credit factor, which links defaults to each other.
- Setting ρ_W = 0 gives the "no wrong-way" run (IND-007) with the same random numbers, so the difference is not Monte Carlo noise.
- Starting values (decision 3, illustrative and configurable): ρ_D = 0.25, ρ_W = 0.30. Inputs must satisfy ρ_W² ≤ ρ_D.
- Student-t sensitivity (IND-019): on each path, every X_i is divided by a shared √(W/ν), with W ~ χ²(ν) and ν = 5, and default thresholds use Student-t quantiles so that marginal PDs are unchanged. It reuses the Gaussian run's random draws, so the difference shows only the effect of tail dependence.

### 3. Close-out at default

At default time τ, for borrower b:

- Loaned value at buy-in: Σ q · P(τ + MPOR) · (1 + liquidity cost). MPOR is the close-out period. Liquidity cost is a square-root impact term, k · σ · √(q / ADV).
- Collateral proceeds: Σ c · C(τ + MPOR) · (1 − liquidity cost) · FX(τ + MPOR). Cash collateral is valued at the pool's realizable value at τ + MPOR (section 4), not par (IND-016).
- Shortfall_b = max(0, loaned value − collateral proceeds). The collateral is the amount held at the last margin call before τ, so the margin lag is modelled.
- Losses are kept per beneficial owner as well as per borrower, so they can be traced to the client being indemnified.

### 4. Reinvestment pool (decision 1)

- Positions follow `src/data/reinvestment.ts`: liquidity bucket (T+0, T+1, T+7, TERM), credit bucket (HQLA, AGENCY, A1/P1, BANK, CREDIT), allocation, yield, WAM and WAL.
- Each position is revalued every step with spread duration against the credit spread factor for its credit bucket. BANK and CREDIT issuers can also default, from a hazard rate with a fixed recovery.
- Cash owed back: on every path, open loans are returned or recalled according to a return hazard, and more of them are returned when markets are stressed (tied to the equity and spread factors). Defaulted borrowers' cash collateral is also drawn at close-out.
- Payment waterfall: returns are paid from T+0, then T+1, then T+7 buckets. Any excess forces a sale of TERM assets at the marked price less a liquidity cost that widens with the credit spread factor.
- Reinvestment loss = par paid out − realized proceeds, plus the shortfall of the pool's mark-to-market against cash owed at the horizon.
- Losses are allocated to beneficial owners pro rata to their share of the pool.
- Every loss metric is reported by channel (default shortfall, reinvestment) and in total (IND-017).

### 5. Metrics

- **Exposure profile:** EE(t) = E[max(0, L(t) − C(t))] over the exposure grid, plus EPE and PFE95/99(t).
- **Loss:** EL = E[Σ shortfall · 1{τ ≤ T}], VaR99, VaR99.9, and expected shortfall of the program loss.
- **Allocation:** Euler contributions to expected shortfall, computed as each borrower's average loss on tail paths.
- **Standard errors:** reported for EL and from batch means for the quantiles. A convergence check shows that halving the path count moves results by less than 2 standard errors.

### 6. Regulatory cross-check

The Basel comprehensive approach for securities financing transactions: E* = max(0, E(1+He) − C(1−Hc−Hfx)), with supervisory haircuts scaled to the close-out period by √(MPOR/10). This is closed form and needs no simulation. It is shown next to Monte Carlo PFE99 as a reasonableness bound, not as capital.

### 7. Sensitivities and stresses

- **Sensitivity grid:** margin 102%–110%, MPOR 3–20 days, ρ_W 0–0.5, and collateral substitution (move one borrower from equity to government collateral). Uses common random numbers so the curves are smooth.
- **Named stresses (deterministic):**
  - Largest-borrower default with a −20% equity move.
  - Squeeze: +60% on the most concentrated hard-to-borrow loan, and its borrower defaults.
  - Rates shock: +150bp against government collateral.
  - FX shock: 15% move against cross-currency collateral.
  - Reinvestment pool run: +200bp on BANK and CREDIT spreads, one BANK issuer default, and 30% of loans returned within one week.

### 8. Pricing view

Indemnification cost (bps per year) = (EL + cost of capital × capital measure) / average loan value. It is shown next to the borrower's average fee. A borrower whose cost is above, say, half its fee is flagged for review. The threshold is configurable.

## Service and terminal boundary

- Python service at `services/indemnification_api`, proposed port 8018 (decision 7). FastAPI with token auth and health checks, matching the other services.
- Dependencies: NumPy and SciPy only. No ML stack is needed.
- The terminal server route composes the snapshot from the SLAB book (decision 8) and the user's parameters, then calls the service. The browser does no risk calculation.
- Proposed route: `/securities-lending/indemnification`, behind an `INDEM` module toggle (decision 7).
- Local development uses labelled `SIM` fixtures only; production stays disabled.

## UI (first release)

- Program header: EL, PFE99 peak, VaR99.9, expected shortfall, the share of risk from wrong-way effects, and the split between default and reinvestment channels.
- Borrower table: exposure, collateral, margin %, PD, EL, PFE99, Euler contribution, comprehensive approach E*, fee, indemnification cost, and flag.
- EE and PFE profile chart for the selected borrower, with and without wrong-way risk.
- Sensitivity tab: EL and PFE99 against margin, MPOR and ρ_W.
- Reinvestment tab: pool composition by bucket, liquidity ladder against simulated return waves, and reinvestment loss by owner.
- Stress tab: shortfall by borrower and beneficial owner for each named scenario.
- Model card drawer: seed, paths, standard errors, convergence, input hash, version.

## Validation strategy

- **Closed forms:** a single loan with independent default against PD × E[shortfall]; Gaussian gap moments; comprehensive approach hand cases.
- **Limits:** zero PD, zero volatility, full overcollateralization, and MPOR → 0 must give zero default loss. An all-overnight pool must give zero reinvestment loss.
- **Reinvestment hand cases:** a single term asset with a set spread shock and return wave against a hand-computed forced-sale loss.
- **Monotonicity:** in ρ_W, MPOR, margin and volatility, on a fixed seed.
- **Copula checks:** the Student-t run recovers marginal PDs, has heavier joint-default tails than the Gaussian run, and converges to it as ν grows.
- **Consistency:** Euler sum equals the total; channel losses sum to the total on every path; per-owner sums equal per-borrower sums; the same random numbers are used across the with and without wrong-way runs.
- **Determinism:** golden outputs per seed; contract parity between the TypeScript and Python fixtures.
- **Naming:** all fixtures pass the fictional-counterparty test.

## Sequence

1. Resolve SPEC decisions 1–8 and fix the BlueCrest naming issue.
2. Define snapshot and result contracts with fixtures.
3. Build the synthetic book generator (extending SLAB, if decision 8 says so).
4. Build market paths, then default times, then the reinvestment pool, then close-out, each with golden tests.
5. Add metrics, standard errors, Euler allocation and the model card.
6. Add the comprehensive approach cross-check, sensitivities and stresses.
7. Add service auth, health, terminal route composition and UI.
8. Add the validation report, demo-scale benchmark and handoff.
