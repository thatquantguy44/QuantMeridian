# Spec011: Money Market Execution Optimizer

- **ID:** spec011-money-market-execution
- **Parent:** InventoryBallast `specs/0018-live-poc-showcase/spec.md`, REQ-016–020, REQ-027–030, REQ-041
- **Status:** Draft — pending owner review; not approved for implementation
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-17

> WHAT and WHY only. Service architecture and task sequencing belong in `PLAN.md` and `TASKS.md`.

## Summary

Provide a local, decision-support optimizer for deploying forecast cash across money-market instruments over a configurable horizon. It returns a verified allocation and a recommended execution blotter; it does not place trades. Every rate is tied to its source, date, and status, and synthetic values are visibly labeled `SIM`.

## Problem & Context

Treasury cash is allocated across funds, bills, repo, RRP, CP/CD, and deposits while preserving near-term liquidity and respecting issuer, counterparty, rating, maturity, settlement, and operational constraints. The terminal currently lacks a verified multi-period optimizer for this decision. 0018 REQ-016–020 define the required universe, constraints, outputs, and scenarios.

MMKT is a QuantMeridian service-backed module. It receives a rate snapshot from the terminal layer so the model service remains deterministic and does not depend on Gold database availability. The adopted source contract is EcoMedallion's `gold.mmkt_rate_snapshot`: `instrument_id`, `quoted_rate_pct`, `quoted_basis`, normalized `mm_yield_pct`, `observation_date`, `staleness_days`, `status`, and `status_detail`. MMKT prices from `mm_yield_pct`, never directly from rates with unlike quoting bases.

## Goals

- Accept a configurable, dated instrument universe and a cash forecast over a chosen horizon.
- Optimize net yield while enforcing cash balance, liquidity, exposure, rating, tenor, execution, and ticket constraints.
- Explain the recommendation through a dated blotter, maturity ladder, binding-constraint values, baseline comparison, and yield/liquidity frontier.
- Support reproducible what-if scenarios and preserve input, rate-snapshot, and model lineage.

## Non-goals

- Order routing, execution, custody, or real-time trading.
- A QuantMeridian database connection inside the model service.
- Silent fallback from unavailable or stale Gold rows to synthetic rates.
- Investment advice or a claim that synthetic scenarios predict market outcomes.
- Realistic fund parameters from unlicensed or unavailable data sources.

## Requirements

| ID | Requirement | Parent | Priority |
|---|---|---|---|
| MM-001 | Configure government and prime MMF share classes, T-bills, tri-party/bilateral repo, RRP, CP/CD, and bank deposits with yield, costs, issuer/counterparty, rating, tenor, settlement, cutoff, and ticket/lot rules. | REQ-016 | must |
| MM-002 | Accept a dated cash forecast over a configurable horizon and solve multi-period allocations with cash-balance continuity. | REQ-016/017 | must |
| MM-003 | Enforce daily/weekly liquidity floors, WAM/WAL limits, issuer/counterparty percentage and dollar limits, fund AUM-share caps, rating floors, RRP cap, cutoffs, min tickets, lot sizes, and ticket-count limits. | REQ-017 | must |
| MM-004 | Maximize net yield after explicit costs; report the exact input and objective convention. | REQ-017 | must |
| MM-005 | Return an execution-ordered blotter, cutoff timeline, maturity ladder, and CSV export. | REQ-018 | must |
| MM-006 | Compare against a stated naive baseline; expose LP shadow prices and clearly label fixed-integer LP values for MIP runs; show the yield/liquidity frontier. | REQ-019 | must |
| MM-007 | Run named rate-cut, fund-fee/gate, cash-forecast-miss, and counterparty-downgrade scenarios. | REQ-020 | should |
| MM-008 | Display source, as-of date, status, and SIM/DB provenance for each input rate; reject non-OK rows from pricing and require explicit user choice for SIM. | REQ-030, 0018 T-010 | must |
| MM-009 | Pass a rate snapshot and its hash in the solve request; persist the hash with each run; the service itself has no database dependency. | REQ-027/029, XR-5 | must |
| MM-010 | Independently verify bounds, constraints, integrality, and objective reconstruction before a result is presented. | REQ-028 | must |

## Acceptance Criteria

- **AC-001:** An identical request, rate snapshot, and service version produces identical non-timing outputs.
- **AC-002:** A small hand-computable case meets cash, liquidity, and maturity requirements and maximizes net yield.
- **AC-003:** Each required constraint has a binding and non-binding test; an infeasible case returns a diagnostic and no recommended blotter.
- **AC-004:** Mixed rate bases are ranked using normalized `mm_yield_pct`; a non-OK row is not priced.
- **AC-005:** SIM inputs require explicit selection and remain labeled in APIs, UI, exports, and run history.
- **AC-006:** The LP/MIP formulation and shadow-price convention are disclosed per run.
- **AC-007:** Blotter order respects cutoffs; the maturity ladder reconciles to holdings; CSV matches displayed rows.
- **AC-008:** Scenario outputs and the frontier are independently verified and expose the baseline and input hashes.

## Decisions and open questions

**Already decided in parent 0018:** rate source is MacroMedallion through `MACRO_DB_URL`; SIM is explicitly user-selected with no silent fallback; snapshot is passed into each solve. Rates must be compared using normalized yield. Missing fund-yield/WAM/WAL, CP tenor, repo-tenor, and auction inputs remain explicit user policy inputs labeled illustrative until upstream sources exist.

**Owner confirmation needed before approval:**
1. Naive baseline definition (for example, hold forecast surplus as overnight cash versus the lowest-risk permitted instrument).
2. Default horizon and liquidity-buffer units when a portfolio has multiple currencies.
3. Whether stale-but-present rows are displayed with status while remaining ineligible for optimization (recommended fail-closed behavior).

## Related documents

- Parent spec: [0018 live proof-of-concept showcase](https://github.com/thatquantguy44/InventoryBallast/tree/main/specs/0018-live-poc-showcase)
- Rate contract and cross-repository follow-up: [QuantMeridian issue #149](https://github.com/thatquantguy44/QuantMeridian/issues/149)
- EcoMedallion schema: `specs/spec009` and `gold.mmkt_rate_snapshot`
- Shared model library: `services/optimization_core/`
