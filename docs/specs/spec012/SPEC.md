# Spec012: Configurable Sources and Uses Optimizer

- **ID:** spec012-configurable-sources-uses
- **Parent:** InventoryBallast `specs/0018-live-poc-showcase/spec.md`, REQ-021–029, REQ-041
- **Status:** Draft — pending owner review; not approved for implementation
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-17

> WHAT and WHY only. Implementation details belong in `PLAN.md` and `TASKS.md`.

## Summary

Replace the seeded Sources & Uses matching view with a configurable, verified optimizer. Users define sources, uses, and compatibility rules; the model matches eligible capacity to uses at minimum cost while observing hard obligations, priority tiers, and optional discrete execution rules.

## Problem & Context

The current Sources & Uses data is generated, so displayed matches are not a traceable funding recommendation. The 0018 program requires a real network-flow model, editable configuration and compatibility, LP/MIP disclosure, and verified outputs.

A source may cover a use only when explicit compatibility rules allow it. Currency, legal entity, asset class, haircut, reuse authority, and user overrides must be visible. A hard use is covered in full or the solve reports infeasible; a soft use may remain unfilled at its stated penalty. Higher priority tiers cannot be outbid by a cheaper lower tier.

## Goals

- Create, edit, save, import, export, and validate named source/use configurations.
- Make compatibility rules and overrides inspectable.
- Provide an LP for continuous flow and opt-in MIP rules for discrete execution.
- Show matched flows, unfilled soft uses, binding constraints, shadow prices, and internalization.
- Remove fabricated/random matching from the product surface.

## Non-goals

- Automatic settlement, trade execution, collateral optimization, or account connectivity.
- Implicit compatibility or inferred legal authority.
- Using market prices not supplied with provenance by the configuration.
- Claiming MIP shadow prices are exact LP duals.
- The optional security-level bridge to IBAL prime (0018 REQ-026) in the first release.

## Requirements

| ID | Requirement | Parent | Priority |
|---|---|---|---|
| SU-001 | Users can create/edit/delete sources and uses with type, amount, cost/bid, currency, legal entity, asset class, tenor, priority, min/max, lot, and tags. Each source has a configurable haircut rate; named configurations round-trip through CSV/JSON. | REQ-021 | must |
| SU-002 | Source-to-use compatibility is derived from editable rules and displayed as a matrix; overrides are explicit and visible. | REQ-022 | must |
| SU-003 | LP matches capacity subject to source-level haircut-adjusted coverage: nominal flow consumes source capacity and contributes coverage after that source's configured haircut. Hard uses are fully covered or infeasible; soft use shortfall is explicit and priced. | REQ-023 | must |
| SU-004 | Priority tiers are solved lexicographically before cost optimization, so lower priority economics cannot displace a higher-tier obligation. | REQ-023 | must |
| SU-005 | Per-run MIP options include minimum ticket/all-or-none, fixed activation cost, max sources per use, lot size, and exclusive pairings; the executed formulation is disclosed. | REQ-024 | must |
| SU-006 | The module reports binding rows, source/use shadow prices, infeasibility explanation, matched-flow Sankey, and internalization versus external funding. MIP duals are correctly qualified. | REQ-025 | must |
| SU-007 | Results are independently verified and flow totals reconcile to configured sources/uses. | REQ-028 | must |
| SU-008 | OPT run history receives real S&U runs; seeded random matches are removed from the page. | REQ-029 | must |
| SU-009 | Every source, use, override, and result carries user-input/source provenance and an immutable per-run configuration hash. | REQ-030 | must |

## Acceptance Criteria

- **AC-001:** A saved configuration exports and reimports without changing its canonical hash.
- **AC-002:** Compatibility rules and explicit overrides produce the expected matrix, with denied edges unusable.
- **AC-003:** Hand-computable LP cases reconcile all flows; hard undercoverage is infeasible and soft undercoverage is disclosed.
- **AC-004:** Two priority tiers demonstrate lexicographic priority independent of cost magnitude.
- **AC-005:** Each MIP rule has a feasible binding case and a failed/invalid case; the response identifies LP or MIP and active rules.
- **AC-006:** Infeasibility explanation and duals map to stable source/use IDs; MIP duals identify fixed-integer LP semantics.
- **AC-007:** Sankey totals, table totals, and verified solution totals agree; internalization denominator is defined in the approved design.
- **AC-008:** No random-number matches remain; OPT history contains the verified configuration/run hashes.
- **AC-009:** For each source, nominal flow consumes capacity and haircut-adjusted flow contributes to use coverage; changing a configured source haircut changes the canonical run hash.

## Decisions and open questions

1. Confirm whether currency mismatches and legal-entity mismatches are always hard incompatibilities or may be allowed by an explicit override.
2. **Resolved (2026-10-17):** Haircut is attached to each source and is configurable in the source/use configuration, not hard-coded. For a nominal flow `x_ij` from source `i`, source capacity is consumed by `x_ij` and use coverage is credited as `x_ij × (1 − h_i)`, where `h_i` is that source's configured haircut rate. The same source haircut applies to all compatible uses. Pair-specific haircuts are out of scope for the initial release. **Still open:** rounding convention for fractional capacity and coverage.
3. Confirm internalization-rate numerator/denominator and how to classify “internal” sources.
4. Confirm whether a configuration can contain multiple currencies in one solve; otherwise enforce one currency per run.

## Related documents

- Parent spec: [InventoryBallast 0018](https://github.com/thatquantguy44/InventoryBallast/tree/main/specs/0018-live-poc-showcase)
- Shared library: `services/optimization_core/`
- Existing mock to replace: `src/data/sourcesUses.ts`
