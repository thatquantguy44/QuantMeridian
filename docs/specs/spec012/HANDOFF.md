# Spec012 build handoff

**Updated:** 2026-10-18

**Branch:** `claude/synthetic-snu-poc-27n9hu`. The SU-SIM showcase merged into `main` in
[PR #166](https://github.com/thatquantguy44/QuantMeridian/pull/166) (merge commit `2b32b7c`). The
follow-ups [PR #167](https://github.com/thatquantguy44/QuantMeridian/pull/167) (module SIM switch SU-013, approval records, handoffs) and
[PR #168](https://github.com/thatquantguy44/QuantMeridian/pull/168) (owner decisions 1–4) are also merged. The full-spec approval record (SU-001) is merged in
[PR #170](https://github.com/thatquantguy44/QuantMeridian/pull/170). Re-checked against `main` at PR #170: the next steps below
are still open.

**State:** the full spec was **approved on 2026-10-18** (SU-001; see the `SPEC.md` decision log),
so the production optimizer is authorized. It is not built yet. Two bounded slices are in place,
and neither one is the production optimizer.

| Slice | Where | Status |
|---|---|---|
| Setup-only configuration workspace | `main` (merged before this branch) | Done. Edits, validates and imports/exports configurations. No solving. |
| Synthetic PoC showcase (SU-SIM) | `main` (PR #166); SIM switch in PR #167 (merged) | Done. A browser-only, illustrative solve on a fixed SIM book. |
| Request contracts and canonical hashes (SU-002) | `services/sources_uses_api`, `src/lib/sourcesUsesContract.ts` | Done. Versioned request contract, TS/Python hash parity, published schema. No solver or endpoint yet. |
| Production optimizer (LP, verifier, API, OPT history) | — | Not started. Builds on the SU-002 contracts; this is the next work. |

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

Do not infer production solver behaviour from the showcase. The showcase was built to avoid the
then-open decisions. It is consistent with their 2026-10-18 resolutions, but it is not their
implementation.

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

**How it relates to the decisions (all consistent):**
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
- **Mismatches (question 1, resolved 2026-10-18):** a currency mismatch is always a hard
  block. A legal-entity mismatch is not; a cross-entity pair is usable when an explicit
  compatibility rule allows it.
- **Rounding (question 2, resolved 2026-10-18):** no rounding inside the model. Amounts, flows,
  coverage, exports and the run hash keep full precision. Rounding is display-only, and the
  verifier uses tolerances on unrounded values. Discrete amounts come only from MIP rules.
- **Internalization (question 3, resolved 2026-10-18):** internal haircut-adjusted coverage
  delivered ÷ total haircut-adjusted coverage delivered (unmet demand excluded). Each source has
  an explicit, user-set `internality` (`internal`/`external`), never inferred. Any unclassified
  contributing source, or zero delivered coverage, gives `n/a` with the unclassified share
  disclosed.
- **Currency (question 4, resolved 2026-10-18):** one currency per run. A configuration may store
  several currencies, but a run spanning more than one is rejected before solving, naming the
  records. No base-currency conversion for funding. FX conversion is deferred and needs a new
  decision that keeps the currency hard block.
- All are recorded in the decision log in `SPEC.md` § Decisions and open questions.

**Open:** no model questions remain. The full solver/API contract, objective economics, MIP options and dual semantics also still
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

1. ~~**Merge PR #167**~~ (merged, as is PR #168). The earlier `build/spec012-sources-uses-optimizer`
   branch no longer exists on the remote, so ignore any older reference to it.
2. ~~**Owner approval** (SU-001).~~ Done 2026-10-18: questions 1–4 resolved and the full spec,
   plan, tasks and design paper approved.
3. ~~**Service contracts.**~~ Done (SU-002): `services/sources_uses_api` holds the versioned
   request contract, provenance, single-currency and question-1 checks, and canonical hashes that
   match `src/lib/sourcesUsesContract.ts` byte for byte. See the service `README.md`. The result
   contract is defined with the LP.
4. **Production LP.** The compatibility engine must enforce the currency hard block from
   question 1 and reject an `allowed` rule on any currency-mismatched pair. Validation rejects a
   multi-currency run (question 4). Keep the model unrounded (question 2) and compute the
   internalization rate as decided (question 3). Then build
   `services/sources_uses_api` on `services/optimization_core` (HiGHS) with the compatibility
   engine, the lexicographic LP and an independent verifier (SU-003–005).
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
