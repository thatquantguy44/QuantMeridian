# Spec012 build handoff

**Updated:** 2026-10-18

**Branch:** `claude/synthetic-snu-poc-27n9hu`. The SU-SIM showcase merged into `main` in
[PR #166](https://github.com/thatquantguy44/QuantMeridian/pull/166) (merge commit `2b32b7c`). The
follow-up [PR #FOLLOWUP](https://github.com/thatquantguy44/QuantMeridian/pull/FOLLOWUP), rebased onto that merge, adds the module SIM switch (SU-013), the approval
records and this handoff refresh.

**State:** two owner-approved, bounded slices are in place. Neither one is the production
optimizer.

| Slice | Where | Status |
|---|---|---|
| Setup-only configuration workspace | `main` (merged before this branch) | Done. Edits, validates and imports/exports configurations. No solving. |
| Synthetic PoC showcase (SU-SIM) | `main` (PR #166); SIM switch in PR #FOLLOWUP | Done. A browser-only, illustrative solve on a fixed SIM book. |
| Production optimizer (service, contracts, run hash, OPT history) | — | Not started. Gated on open decisions and spec approval. |

The same PR also carries the MMKT module (spec011, see `docs/specs/spec011/HANDOFF.md`) and the
demo guide in `docs/demo_books/`.

## Start here

1. Read `SPEC.md`: the main requirements, then the **Synthetic proof-of-concept showcase
   (SU-SIM)** section, then **Decisions and open questions**.
2. Read `PLAN.md` and `TASKS.md`.
3. If you are demoing, read `docs/demo_books/sources-uses-synthetic-poc.md`. Every number in it
   was produced by the model at default settings.
4. Use the pinned Agent Skills in `.agents/skills/` (see `AGENTS.md`). Run
   `npm run check:agent-skills-pin` before and after SXU work.

Do not infer production solver behaviour from the showcase. The showcase deliberately avoids
every open decision.

## Slice 1: setup-only configuration workspace (in `main`)

- `src/app/sources-uses/page.tsx`: the **Workspace** tab. Named configurations are kept in
  browser local storage. You can edit sources and uses, set explicit
  `allowed`/`denied`/`unspecified` compatibility with notes, and edit per-source haircuts.
- `src/data/sourcesUses.ts`: the versioned configuration schema and validation, and CSV/JSON
  import and export (validated before applying).
- `src/data/sourcesUses.test.ts`: 8 contract tests.

## Slice 2: synthetic PoC showcase (SU-SIM, merged in PR #166)

The page opens on it by default while **SIM** is on. Use `/sources-uses#workspace` to land on
the workspace instead. Turning SIM off hides the PoC entirely.

| Piece | File | Notes |
|---|---|---|
| LP solver | `src/lib/optimization/simplex.ts` | A dense two-phase simplex (Bland's rule) that recovers duals from the final basis. `certifyLp` independently checks primal and dual feasibility, complementary slackness and the duality gap. Sized for showcase models only. |
| Model, dataset, scenarios, verifier | `src/data/sourcesUsesSynthetic.ts` | See the summary below. |
| UI | `src/app/sources-uses/synthetic/` | `SyntheticShowcase.tsx` holds the layout and state. `TransportNetwork.tsx` draws the network with dummy nodes. `TransportTableau.tsx` is the MODI-style tableau. `PenaltyControls.tsx` holds the penalty panel, lane inspector and objective decomposition. `ShowcaseCharts.tsx` holds the remaining charts. |
| Page wiring | `src/app/sources-uses/page.tsx` | The Workspace / Synthetic PoC tabs, the **SIM ON/OFF** switch (on by default, remembered under `quantmeridian.sxu.sim.v1`), the provenance badge (`SIM` with `simSelected`, or `PENDING` when off), and the "Copy to workspace" handler. |

**Model summary:**
- It is a balanced, penalised classic transportation problem.
- A dummy "unmet demand" supply node is priced at each soft use's shortfall penalty. A dummy
  "idle capacity" demand node is priced at each source's idle penalty.
- Lane cost: `c_ij = c_i + p_ij + χ·[entity≠] + τ·(T_j−T_i)⁺/30 + η·h_i`.
- Concentration is a convex split-lane penalty. Minimum-draw floors carry a penalty.
- Priority is lexicographic by default (SU-004). Weighted mode is for comparison only.
- Infeasibility is reported through an elastic diagnostic and never shown as a plan.
- The full penalty catalogue is in `SPEC.md` § SU-SIM.

**Dataset:**
- 8 sources in 3 families, 10 uses in 4 tiers, 35 explicit lanes. USD only.
- 6 scenarios: base, repo squeeze, haircut shock, margin surge, rate shock, and an infeasible
  cascade.

**Tests:**
- `simplex.test.ts`: 6 tests.
- `sourcesUsesSynthetic.test.ts`: 34 tests. They cover a hand-computable case per penalty, both
  priority modes, flow and dual tamper failures, the infeasible cascade, and a 432-corner
  stress/penalty grid where every corner must either verify or report a hard gap.

**How it stays clear of the open decisions:**
- One currency (USD).
- Explicit lanes only.
- A continuous solve, rounded for display only.
- No internalization rate.
- Every penalty value is illustrative SIM economics.

## What does not exist yet (the production path)

- No `services/sources_uses_api` (port 8015) and no versioned request/result service contract.
- No canonical configuration/run hash (SU-009, AC-001, AC-009).
- No server-side LP/MIP on `services/optimization_core`. Owner decision 1 in `docs/handoff.md`
  says each module gets its own Python service sharing that library.
- The browser `simplex.ts` is a showcase solver. Do not promote it to production without a
  decision.
- No MIP rules (SU-005).
- No OPT run-history integration (SU-008).
- The Workspace tab still does not solve. A configuration copied from the showcase is editable,
  but cannot be run.

## Recorded decisions and remaining gates

**Resolved:**
- **Haircut:** per source and configurable. Nominal flow consumes capacity, and coverage is
  credited as `flow × (1 − h_i)`. Pair-specific haircuts are out of scope initially.
- **SU-SIM showcase:** explicitly approved by the owner on 2026-10-18 as a bounded demo mode.
- **Module SIM switch:** explicitly approved by the owner on 2026-10-18 (SU-013).
- Both are recorded in the decision log in `SPEC.md` § Decisions and open questions.

**Open (do not encode):**
1. Are currency and legal-entity mismatches always incompatible, or can an explicit override
   allow them?
2. The rounding convention for fractional capacity and coverage.
3. The internalization numerator and denominator, and how internal sources are classified.
4. Can one solve contain multiple currencies? The design options (one currency per run, base-
   currency conversion, explicit FX conversion lanes) are written up in the demo guide under
   "Multi-currency".

The full solver/API contract, objective economics, MIP options and dual semantics also still
need owner review.

## Verification evidence (2026-10-18, branch head)

- **`npm test`:** all pass except `src/tests/badge-coverage.test.ts`. That test now fails only
  for `money-market-fund-optimizer/page.tsx`, which also fails on `main` and belongs to spec015.
  The SXU page passes since SU-013.
- **SXU and solver suites:** `sourcesUses` 8, `sourcesUsesSynthetic` 34, `simplex` 6. All pass.
- **`npm run typecheck`:** passed.
- **`npm run build:client`:** passed. The existing large-chunk warning remains.
- **`npm run check:agent-skills-pin`:** passed for 13 files.
- **Playwright smoke (`test/smoke.spec.ts -g SXU`):** passed.
- **Phone width:** no horizontal overflow at a 390px viewport.

## Next steps (in order)

1. **Merge PR #FOLLOWUP** (SIM switch, approval records, handoff refresh). The earlier `build/spec012-sources-uses-optimizer` branch no
   longer exists on the remote, so ignore any older reference to it.
2. **Owner decisions.** Resolve open decisions 1–4 and approve the full `SPEC.md`, `PLAN.md`,
   `TASKS.md` and child design docs (SU-001).
3. **Service contracts.** Define versioned request/result contracts and canonical
   configuration/run hashing (SU-002). Reuse the showcase's verifier checks as acceptance
   fixtures.
4. **Production LP.** Build `services/sources_uses_api` on `services/optimization_core` (HiGHS)
   with the compatibility engine, the lexicographic LP and an independent verifier (SU-003–005).
   The showcase's hand-computable cases in `sourcesUsesSynthetic.test.ts` make good golden
   cases.
5. **Then:** MIP rules (SU-006), result views wired to the service (SU-007), OPT run history
   (SU-008), service hardening (SU-009), and the as-built model card (SU-010).
6. **When the production model is wired,** decide whether SIM should still default to on (see
   the "Module SIM switch" note in `SPEC.md` § SU-SIM). Update `readSimPreference` in
   `src/app/sources-uses/page.tsx` to match.
7. **Keep the demo guide current.** If showcase defaults or the dataset change, re-run the
   scenarios and update the expected numbers and the "Last verified" date in
   `docs/demo_books/sources-uses-synthetic-poc.md`.
