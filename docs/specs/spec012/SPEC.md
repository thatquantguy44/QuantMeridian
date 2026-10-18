# Spec012: Configurable Sources and Uses Optimizer

- **ID:** spec012-configurable-sources-uses
- **Parent:** InventoryBallast `specs/0018-live-poc-showcase/spec.md`, REQ-021–029, REQ-041
- **Status:** Draft — bounded setup-only phase and synthetic PoC showcase (SU-SIM) approved; full optimizer pending decisions and review
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** Owner (setup-only phase scope; full optimizer approval remains pending)
- **Last updated:** 2026-10-18

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

## Approved implementation boundary

The owner has authorized a setup-only phase: users may manage named configurations, source/use
records, explicit compatibility states, and CSV/JSON import/export. This approval does not authorize
solving, recommendations, a production service/model contract, result views, or OPT run-history
integration. Those remain gated on the open decisions below and approval of the complete spec and
its child design documents.

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

## Synthetic proof-of-concept showcase (SU-SIM)

**Status:** Approved by the owner on 2026-10-18 as a bounded demonstration mode. It does not
approve the production optimizer, service contract, OPT run-history integration, or production
recommendations. Those stay gated on the open decisions below.

### Why

Stakeholders need to see what the optimizer will do before the production service is approved.
A fixed, hand-built synthetic book shows the model on a realistic treasury funding day. It covers
the classic transportation problem, haircut-adjusted coverage, lexicographic priority tiers,
shadow prices, and infeasibility diagnosis. It uses no live, customer, or production data.

### Scope

The Sources & Uses page offers a **Synthetic PoC** mode next to the configuration workspace. In
this mode:

- The dataset is a fixed, handwritten synthetic broker-dealer funding book. It has no random
  generation and is identical on every load. Every surface labels it `SIM`.
- The model is solved in the browser by a deterministic, dependency-free LP (two-phase simplex,
  Bland's rule). It never calls a service and never writes to OPT run history.
- Results are presented as illustrative model behaviour, never as a funding recommendation.

### Showcase formulation (illustrative economics)

For each explicitly allowed lane `(i, j)` the nominal flow `x_ij ≥ 0`. For each soft use `j` the
coverage shortfall `s_j ≥ 0`. Hard uses have no shortfall variable.

- Capacity: `Σ_j x_ij ≤ A_i` for each source `i`.
- Coverage: `Σ_i (1 − h_i) · x_ij + s_j = D_j` for each use `j`. This follows resolved decision 2:
  the haircut is per source and applies to all of that source's lanes.
- Priority (SU-004): tiers are solved in ascending order. Stage `t` minimises
  `Σ_{j∈t} p_j s_j`. Before the next stage, its optimum is fixed as an upper bound with a stated
  tolerance.
- Economics (final stage): minimise `Σ (c_i + f_ij) · x_ij + Σ p_j s_j`. Here `c_i` is the
  source cost in bps, `f_ij` is a per-lane transfer friction in bps, and `p_j` is the soft-use
  penalty in bps. Lane friction applies only to this synthetic dataset. It is not a decision about
  the production objective.
- Infeasibility: if a hard use cannot be covered, an elastic LP adds hard-coverage slack. It
  minimises total slack and reports the short uses and the binding sources by stable ID. The
  elastic result is never shown as a solution.

### How the showcase stays clear of open decisions

- **Currency (open decisions 1 and 4):** one currency, USD. No currency mismatch exists, so
  nothing about mismatch policy is assumed.
- **Compatibility (open decision 1):** every lane is an explicit `allowed` or `denied` rule.
  Nothing is inferred from legal entity or asset class. A cross-entity lane exists only where the
  dataset states it, with its friction.
- **Rounding (open decision 2):** the solve is fully continuous. Values are rounded only for
  display, to $0.1mm. Verification uses absolute and relative tolerances, not rounded values.
- **Internalization (open decision 3):** no internalization rate is computed. The UI shows the
  funding mix by synthetic source family only.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| SIM-001 | A deterministic synthetic dataset of eight sources (three families: internal, secured, unsecured & committed), ten uses (four tiers, mixed hard/soft) and explicit lanes with friction. | must |
| SIM-002 | At least six named scenarios. Each is a documented transformation of the base book: base case, repo squeeze, haircut shock, margin-call surge, unsecured rate shock, and a hard-infeasible cascade. | must |
| SIM-003 | Interactive stress controls re-solve live: capacity per family, haircut shift, demand scale, unsecured cost shift, and a per-lane allow/deny toggle. | must |
| SIM-004 | Visuals: a bipartite transport network with flow-weighted animated lanes, a transportation tableau, source utilisation, use coverage by tier, shadow prices, a priority-tier ladder, and a scenario comparison. Each visual has a hover/focus readout and a text/table equivalent. | must |
| SIM-005 | An independent verifier recomputes the following from problem data and reports each as a visible check: primal feasibility, denied-lane zero flow, coverage reconciliation, hard-use coverage, objective, dual feasibility, complementary slackness, and the duality gap. | must |
| SIM-006 | Shadow prices are labelled as final-stage LP duals, conditional on the fixed tier levels. | must |
| SIM-007 | The formulation, solve statistics (variables, rows, stages, pivots, time), and the SIM label are disclosed on the page. | must |
| SIM-008 | A scenario can be copied into the configuration workspace as a normal, editable configuration. Copying does not enable solving there. | should |

### Acceptance criteria

- **SIM-AC-001:** Loading the dataset twice yields deeply equal objects, and the module has no random source.
- **SIM-AC-002:** Hand-computable LP cases solve to the known optimum with the expected duals.
  These cover a two-by-two transport, haircut coverage, and a tier that cannot be outbid by cost.
- **SIM-AC-003:** Every feasible scenario passes all verifier checks. A tampered flow fails verification.
- **SIM-AC-004:** The cascade scenario reports infeasible, names the short hard uses, and shows no flows as a solution.
- **SIM-AC-005:** Network totals, tableau totals and KPI totals agree with the verified solution.

## Decisions and open questions

1. Confirm whether currency mismatches and legal-entity mismatches are always hard incompatibilities or may be allowed by an explicit override.
2. **Resolved (2026-10-17):** Haircut is attached to each source and is configurable in the source/use configuration, not hard-coded. For a nominal flow `x_ij` from source `i`, source capacity is consumed by `x_ij` and use coverage is credited as `x_ij × (1 − h_i)`, where `h_i` is that source's configured haircut rate. The same source haircut applies to all compatible uses. Pair-specific haircuts are out of scope for the initial release. **Still open:** rounding convention for fractional capacity and coverage.
3. Confirm internalization-rate numerator/denominator and how to classify “internal” sources.
4. Confirm whether a configuration can contain multiple currencies in one solve; otherwise enforce one currency per run.

## Related documents

- Parent spec: [InventoryBallast 0018](https://github.com/thatquantguy44/InventoryBallast/tree/main/specs/0018-live-poc-showcase)
- Shared library: `services/optimization_core/`
- Existing mock to replace: `src/data/sourcesUses.ts`
