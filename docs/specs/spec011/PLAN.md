# Plan: Money Market Execution Optimizer

- **Spec:** spec011-money-market-execution (`SPEC.md`)
- **Status:** Draft — implementation in progress; owner review pending
- **Last updated:** 2026-10-17

> HOW. This plan stays within 0018's separate-service and shared-library decisions.

## Approach

The browser calls QuantMeridian routes. Routes read Gold through the existing `useGoldView` pattern, construct a complete rate snapshot with statuses and a content hash, and pass it with the forecast and policy configuration to `services/money_market_api`. The Python service has no database dependency. It validates inputs, builds a sparse LP using `services/optimization_core`, independently verifies the proposed solution, and returns the run envelope and snapshot hash.

If Gold rates are unavailable, the user may explicitly select a named deterministic SIM set. There is no implicit fallback. Non-OK Gold rows remain visible with their status but are excluded from priced candidates.

## Model outline

The first model slice uses purchase variables (x_{i,a,t}) for candidate (i), cash account (a), and purchase date (t). Account cash continuity is modeled across the supplied periods. The objective maximizes modeled net holding return using normalized annual yield, simple ACT/365 accrual, and one explicit cost charge per purchase. Daily/weekly liquidity floors, currency-scoped amount/fraction exposure limits, rating floors, and maturity-day WAM/WAL proxies are modeled as sparse LP rows.

This is a continuous relaxation. It does not enforce ticket activation, lot size, ticket count, or cutoffs, and every response sets `execution_ready=false`. WAM/WAL use maturity dates because reset/amortization data is absent. Forecast residual uses p50; currencies are solved independently; cash earns zero yield. These assumptions travel with every result. The later MIP slice must convert verified LP output into execution-feasible allocations before any blotter is presented.

## Service and API boundaries

- Service: `services/money_market_api`, port 8014, using versioned contracts and service authentication.
- Shared solver and verifier belong in `services/optimization_core`; no private solver copy in MMKT.
- Terminal route composes Gold read, SIM selection, hashing, input validation, and service call.
- The service consumes a full as-of-labeled snapshot and policy inputs; no hidden read or provider fallback occurs.

## Validation strategy

Use hand-computable golden portfolios, one test per constraint family, verifier tampering, infeasible liquidity cases, normalized-rate comparisons, snapshot-hash replay, SIM labeling through export, and service/terminal contract parity. Add route tests for Gold loading/error states and Playwright coverage for the MMKT demo path at the parent plan's required viewports.

## Sequence and gates

1. Resolve owner questions and approve `SPEC.md` / this plan / tasks / white-paper design.
2. Scaffold shared `optimization_core` and service contracts per 0018 T-003/T-004.
3. Implement rate snapshot route and instrument/cash input validation (XR-5).
4. Implement and verify the continuous LP relaxation (current slice); add opt-in MIP rules next.
5. Build blotter, timeline, ladder, CSV, baseline, frontier, and scenario UI.
6. Close with evidence, model card/validation, and as-built white paper.

The owner-authorized integration and LP work is in progress while the child spec remains draft.
