# Spec012: Configurable Sources and Uses Optimizer

- **ID:** spec012-configurable-sources-uses
- **Parent:** InventoryBallast `specs/0018-live-poc-showcase/spec.md`, REQ-021–029, REQ-041
- **Status:** Draft — bounded setup-only phase and synthetic PoC showcase (SU-SIM) approved; open questions 1–4 resolved (2026-10-18); full optimizer approval pending review
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** Owner, for the setup-only phase (2026-10-17), the SU-SIM showcase and the module SIM switch (explicitly approved 2026-10-18). The owner resolved open questions 1–4 on 2026-10-18. Full optimizer approval remains pending.
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
integration. Those remain gated on approval of the complete spec and its child design documents.
The open questions below were resolved on 2026-10-18 and are recorded in the decision log.

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
- **AC-007:** Sankey totals, table totals, and verified solution totals agree; the internalization rate follows the definition in the decision log (question 3), including `n/a` when any contributing source is unclassified.
- **AC-008:** No random-number matches remain; OPT history contains the verified configuration/run hashes.
- **AC-009:** For each source, nominal flow consumes capacity and haircut-adjusted flow contributes to use coverage; changing a configured source haircut changes the canonical run hash.

## Synthetic proof-of-concept showcase (SU-SIM)

**Status:** Explicitly approved by the owner on 2026-10-18 as a bounded demonstration mode (see the decision log below). It does not
approve the production optimizer, service contract, OPT run-history integration, or production
recommendations. Those stay gated on approval of the complete spec.

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
- **Module SIM switch (owner decision, 2026-10-18):** the page defaults to SIM on and opens on the
  Synthetic PoC until it is wired to a production model. An on-screen **SIM ON/OFF** switch,
  remembered per browser, turns it off. Off hides the PoC and all synthetic results, leaves the
  user's own configurations, and labels the page `PENDING`. This switch is independent of the
  terminal's global SIM mode.

### Showcase formulation: penalised classic transportation problem

The showcase solves the textbook **balanced transportation problem**. Sources are supply nodes
and uses are demand nodes. A unit cost `c_ij` applies on each explicitly allowed lane. Two dummy
nodes balance the problem:

- **Dummy supply ("unmet demand"):** feeds each soft use at that use's shortfall penalty `π_j`.
  Hard uses have no dummy lane.
- **Dummy demand ("idle capacity"):** absorbs each source's unused capacity at that source's idle
  penalty `ι_i`.

Haircuts make it a generalised transportation problem. A nominal dollar from source `i` covers
`(1 − h_i)` of a use, following resolved decision 2.

**Variables:**
- `x_ij ≥ 0`: lane flow up to the concentration threshold.
- `x̂_ij ≥ 0`: lane flow above the threshold.
- `s_j ≥ 0`: shortfall of a soft use.
- `e_i ≥ 0`: idle capacity of a source.
- `m_i ≥ 0`: shortfall below a source's minimum draw.

**Constraints:**
- Supply: `Σ_j (x_ij + x̂_ij) + e_i = A_i`.
- Demand: `Σ_i (1 − h_i)(x_ij + x̂_ij) + s_j = D_j`. `s_j ≡ 0` for hard uses.
- Concentration split: `x_ij ≤ θ · D_j / (1 − h_i)`. This makes the concentration penalty convex,
  so the model stays an LP.
- Minimum draw: `Σ_j (x_ij + x̂_ij) + m_i ≥ floor_i`.

**Objective:** `min Σ c_ij·x_ij + Σ (c_ij + κ)·x̂_ij + Σ π_j·s_j + Σ ι_i·e_i + Σ μ_i·m_i`, where
`c_ij = c_i + p_ij + χ·[entity_i ≠ entity_j] + τ·max(0, T_j − T_i)/30 + η·h_i`.

Every penalty is configurable in the UI:

| Penalty | Symbol | Scope | Meaning in a Sources & Uses book |
|---|---|---|---|
| Source cost | `c_i` | per source | All-in funding spread of the source |
| Pair penalty | `p_ij` | per lane, overridable | Operational transfer cost, reuse restriction or wrong-way risk on one specific pairing |
| Cross-entity transfer | `χ` | global | Intercompany downstreaming cost when source and use sit in different legal entities |
| Tenor mismatch | `τ` per 30 days | global | Rollover risk when short funding finances a longer-dated use |
| Haircut capital charge | `η × h_i` | global | Cost of the encumbered over-collateral that a haircut locks up |
| Concentration | `κ` above `θ`% | global | Convex penalty when one lane carries more than a share of a use's demand |
| Shortfall | `π_j` | per soft use, overridable | Cost of leaving coverage unmet (dummy supply) |
| Idle capacity | `ι_i` | per source, overridable, switchable | Negative carry or reserve lock-up on unused funding (dummy demand) |
| Minimum draw | `μ_i` below `floor_i` | per source, switchable | Programme floor or balance commitment (for example CP market access, tri-party relationship) |

**Priority handling:**
- **Lexicographic (default, SU-004):** tiers are solved in ascending order. Stage `t` minimises
  `Σ_{j∈t} π_j s_j`. Its optimum is then fixed as an upper bound, with a stated tolerance, before
  the full penalised objective is minimised.
- **Weighted (comparison only):** a single penalised transport solve that trades shortfall
  penalties directly against cost. It shows why lexicographic tiers matter. It is not the
  production rule.

**Infeasibility:** if a hard use cannot be covered, an elastic LP adds hard-coverage slack. It
minimises total slack and reports the short uses and the binding sources by stable ID. The elastic
result is never shown as a solution.

All penalty values in the SIM book are illustrative economics. They are not decisions about the
production objective.

### How the showcase relates to the decisions

The showcase was built before questions 1–4 were resolved and was designed to avoid them. It is
consistent with every resolution:

- **Currency (questions 1 and 4):** one currency, USD. No currency mismatch exists, and the
  showcase is a single-currency run.
- **Compatibility (question 1):** every lane is an explicit `allowed` or `denied` rule.
  Nothing is inferred from legal entity or asset class. A cross-entity lane exists only where the
  dataset states it, with its friction.
- **Rounding (question 2):** the solve is fully continuous. Values are rounded only for
  display, to $0.1mm. Verification uses absolute and relative tolerances, not rounded values.
- **Internalization (question 3):** no internalization rate is computed. The UI shows the
  funding mix by synthetic source family only. A source family is not an internality
  classification, so the showcase does not derive one from it.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| SIM-001 | A deterministic synthetic dataset of eight sources (three families: internal, secured, unsecured & committed) and ten uses (four tiers, mixed hard/soft), with tenors, idle penalties, minimum draws and explicit lanes with pair penalties. | must |
| SIM-002 | At least six named scenarios. Each is a documented transformation of the base book: base case, repo squeeze, haircut shock, margin-call surge, unsecured rate shock, and a hard-infeasible cascade. | must |
| SIM-003 | Interactive stress controls re-solve live: capacity per family, haircut shift, demand scale, unsecured cost shift, and a per-lane allow/deny toggle. | must |
| SIM-004 | Visuals: a bipartite transport network with flow-weighted animated lanes, a transportation tableau, source utilisation, use coverage by tier, shadow prices, a priority-tier ladder, and a scenario comparison. Each visual has a hover/focus readout and a text/table equivalent. | must |
| SIM-005 | An independent verifier recomputes the following from problem data and reports each as a visible check: primal feasibility, denied-lane zero flow, coverage reconciliation, hard-use coverage, objective, dual feasibility, complementary slackness, and the duality gap. | must |
| SIM-006 | Shadow prices are labelled as final-stage LP duals, conditional on the fixed tier levels. Capacity prices may be negative when idle capacity is penalised. | must |
| SIM-007 | The formulation, solve statistics (variables, rows, stages, pivots, time), and the SIM label are disclosed on the page. | must |
| SIM-008 | A scenario can be copied into the configuration workspace as a normal, editable configuration. Copying does not enable solving there. | should |
| SIM-009 | The solver is the balanced penalised transportation problem above. Dummy supply and demand nodes appear in both the network and the tableau. | must |
| SIM-010 | Every penalty in the catalogue is configurable live: global sliders and toggles, per-lane pair-penalty overrides, per-use shortfall penalties, per-source idle penalties, and lexicographic or weighted priority. An objective decomposition and a per-lane cost stack show each term's contribution. | must |

### Acceptance criteria

- **SIM-AC-001:** Loading the dataset twice yields deeply equal objects, and the module has no random source.
- **SIM-AC-002:** Hand-computable LP cases solve to the known optimum with the expected duals.
  These cover a two-by-two transport, haircut coverage, and a tier that cannot be outbid by cost.
- **SIM-AC-003:** Every feasible scenario passes all verifier checks. A tampered flow fails verification.
- **SIM-AC-004:** The cascade scenario reports infeasible, names the short hard uses, and shows no flows as a solution.
- **SIM-AC-005:** Network totals, tableau totals and KPI totals agree with the verified solution.
- **SIM-AC-006:** Each penalty has a hand-computable case. In each case, switching the penalty on
  or overriding it moves the optimum as predicted. The objective decomposition sums to the LP
  objective.
- **SIM-AC-007:** A generic primal/dual certificate on the exact final-stage LP passes for every
  feasible scenario in both priority modes. A tampered dual fails it.

## Decisions and open questions

**Decision log**

| Date | Decision | Recorded by |
|---|---|---|
| 2026-10-17 | Setup-only phase approved. Haircut is per source (decision 2 below). | Owner |
| 2026-10-18 | **Approved:** the SU-SIM synthetic PoC showcase as built in PR #166. This covers the penalised balanced transportation LP, configurable penalties, verifier and LP certificate, and the visual front end, within the scope and limits in § SU-SIM. | Owner, explicit approval in the build session |
| 2026-10-18 | **Question 1 resolved — mismatches.** A **currency mismatch is always a hard block**: no override can make a source in one currency fund a use in another. A **legal-entity mismatch is not a hard block**: a cross-entity pair may be used when an explicit compatibility rule allows it. Compatibility is still never inferred (see Non-goals). | Owner |
| 2026-10-18 | **Approved:** the module SIM switch. SIM is on by default until the page is wired to a production model, with an on-screen ON/OFF switch (SU-013). | Owner |
| 2026-10-18 | **Question 2 resolved — rounding.** The model does no rounding. Capacity, flow and coverage are continuous amounts in native currency units, and haircut-adjusted coverage `x_ij × (1 − h_i)` is not rounded. Rounding is applied only when displaying values. Stored results, exports and the run hash keep full precision, and the verifier checks unrounded values with stated absolute and relative tolerances. Discrete amounts (lot size, minimum ticket, all-or-none) enter only through the opt-in MIP rules (SU-005). | Owner |
| 2026-10-18 | **Question 3 resolved — internalization.** Internalization rate = haircut-adjusted coverage delivered by internal sources ÷ total haircut-adjusted coverage delivered to uses. Unmet demand is not delivered coverage and is not in the denominator. Each source carries an explicit, user-set `internality` attribute (`internal` or `external`) with provenance. It is never inferred from source type, family, legal entity or name. If any source that delivers coverage is unclassified, or no coverage is delivered, the rate is shown as `n/a`, and the unclassified share is disclosed. | Owner |
| 2026-10-18 | **Question 4 resolved — one currency per run.** Every solve contains exactly one currency. A configuration may store records in more than one currency, but a run whose sources and uses span more than one currency is rejected before solving, and the rejection names the records. Amounts are never converted to a base currency to let funding cross currencies. Explicit FX conversion is deferred; adding it needs a new owner decision and must keep question 1's currency hard block. | Owner |

These approvals do not cover the production optimizer, the service contract or OPT run history.
They need approval of the complete spec and its child design documents.

**Open questions**

All four were resolved on 2026-10-18. They stay listed here for traceability.

1. ~~Currency and legal-entity mismatches.~~ **Resolved 2026-10-18** — currency is a hard block; legal entity is not (see the decision log).
2. **Resolved (2026-10-17):** Haircut is attached to each source and is configurable in the source/use configuration, not hard-coded. For a nominal flow `x_ij` from source `i`, source capacity is consumed by `x_ij` and use coverage is credited as `x_ij × (1 − h_i)`, where `h_i` is that source's configured haircut rate. The same source haircut applies to all compatible uses. Pair-specific haircuts are out of scope for the initial release. ~~Rounding convention for fractional capacity and coverage.~~ **Resolved 2026-10-18** — no rounding in the model; display-only rounding (see the decision log).
3. ~~Confirm internalization-rate numerator/denominator and how to classify “internal” sources.~~ **Resolved 2026-10-18** — internal coverage ÷ total coverage delivered; explicit `internality` attribute; unclassified gives `n/a` (see the decision log).
4. ~~Confirm whether a configuration can contain multiple currencies in one solve; otherwise enforce one currency per run.~~ **Resolved 2026-10-18** — one currency per run; mixed runs are rejected; no base-currency conversion for funding (see the decision log).

## Related documents

- Parent spec: [InventoryBallast 0018](https://github.com/thatquantguy44/InventoryBallast/tree/main/specs/0018-live-poc-showcase)
- Shared library: `services/optimization_core/`
- Existing mock to replace: `src/data/sourcesUses.ts`
