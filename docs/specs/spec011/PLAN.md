# Plan: Money Market Execution Optimizer

- **Spec:** spec011-money-market-execution (`SPEC.md`)
- **Status:** Draft — pending owner review
- **Last updated:** 2026-10-17

> HOW. This plan stays within 0018's separate-service and shared-library decisions.

## Approach

The browser calls QuantMeridian routes. Routes read Gold through the existing `useGoldView` pattern, construct a complete rate snapshot with statuses and a content hash, and pass it with the forecast and policy configuration to `services/money_market_api`. The Python service has no database dependency. It validates input contracts, builds a sparse LP/MIP using `services/optimization_core`, independently verifies the proposed solution, and records the full run envelope and snapshot hash.

If Gold rates are unavailable, the user may explicitly select a named deterministic SIM set. There is no implicit fallback. Non-OK Gold rows remain visible with their status but are excluded from priced candidates.

## Model outline

Let (x_{i,t}) be allocation to instrument (i) in period (t), and (y_i) its normalized yield less explicit instrument cost. The objective maximizes holding-period net return across the horizon. Cash-balance continuity and liquidity floors constrain available principal. Additional constraints cover WAM/WAL, issuer/counterparty and fund exposure, ratings, RRP capacity, settlement/cutoff feasibility, minimum tickets, lot sizes, and ticket count. Binary variables activate ticket-level rules; the run discloses whether the LP or MIP formulation was used.

A frontier is generated as a sequence of independently verified solves under changed liquidity floors. A shadow price on a MIP is reported only from its fixed-integer LP and labeled accordingly.

## Service and API boundaries

- New service: `services/money_market_api`, port 8014, using the existing service contract/auth/health/run-history conventions.
- Shared solver, verifier, and elastic-relaxation code belongs in `services/optimization_core`; no private solver copy in MMKT.
- New server route composes Gold read, SIM selection, hashing, request validation, and service call.
- The model input includes a full as-of-labeled snapshot and all user policy inputs; no hidden read or provider fallback occurs in the service.

## Validation strategy

Use hand-computable golden portfolios, one test per constraint family, verifier tampering, infeasible liquidity and ticket cases, normalized-rate basis comparisons, snapshot-hash replay, SIM labeling through export, and service/terminal contract parity. Add route tests for Gold loading/error states and Playwright coverage for the MMKT demo path at the parent plan's required viewports.

## Sequence and gates

1. Resolve owner questions and approve `SPEC.md` / this plan / tasks / white-paper design.
2. Scaffold shared `optimization_core` and service contracts per 0018 T-003/T-004.
3. Implement rate snapshot route and instrument/cash input validation (XR-5).
4. Implement LP, then opt-in MIP rules and independent verification.
5. Build blotter, timeline, ladder, CSV, baseline, frontier, and scenario UI.
6. Close with evidence, model card/validation, and as-built white paper.

No code starts before owner approval of this child spec, per 0018 Definition of Done.
