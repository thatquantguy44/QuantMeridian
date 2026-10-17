# Spec012 build handoff

**Updated:** 2026-10-17

**Branch:** `build/spec012-sources-uses-optimizer`

**Base:** `main` at `60cfc52621f3e196d083c3f965ce7d2bc65100e0`
**State:** Setup-only slice implemented; changes are being prepared for review. This is not a solver or production service release.

## Start here

Read `SPEC.md`, then `PLAN.md` and `TASKS.md`. The full optimizer spec remains a draft. The
owner approved the bounded setup-only phase, including a configurable haircut on each source.
Do not infer or implement solver behavior from unresolved decisions.

## Implemented in this branch

- Replaced the generated Sources & Uses page with a setup-only configuration workspace in
  `src/app/sources-uses/page.tsx`.
- Added versioned configuration data and validation in `src/data/sourcesUses.ts`.
- Supports named configurations stored in browser local storage, source/use editing, explicit
  `allowed`/`denied`/`unspecified` compatibility states, and compatibility notes.
- Source haircuts are editable percentages and survive JSON/CSV round-trips.
- JSON/CSV import validates before applying; export preserves configured fields and CSV quoting.
- Added eight focused contract tests in `src/data/sourcesUses.test.ts`.
- Added upstream Agent Skills snapshots, provenance pins, repository guidance, and a CI integrity
  check. Source: `thatquantguy44/agent-skills` at
  `f63ec56a3cc936408d792956ae583c3c96a825bd`; its MIT license is retained. See
  `contracts/agent/agent-skills.pin.json`.

## Explicitly out of scope for this slice

There is no optimization API/service, LP/MIP formulation, run hash, solver, result verifier,
recommendation, result table/Sankey, OPT run-history integration, or live data dependency. The
browser schema is a setup-only draft and must not be treated as the final service contract. A pair
in the UI records configuration state only; no flow is calculated.

## Recorded decisions and remaining gates

- **Resolved:** Haircut is attached to a source, configurable by the user, and applies uniformly to
  that source's compatible flows. Nominal flow consumes capacity; haircut-adjusted flow contributes
  `flow × (1 − source haircut)` to use coverage. Pair-specific haircuts are out of scope initially.
- **Open:** Fractional capacity/coverage rounding convention.
- **Open:** Whether currency and legal-entity mismatches are absolute incompatibilities or may be
  overridden.
- **Open:** Whether one solve may contain multiple currencies; otherwise the run must enforce one.
- **Open:** Internalization numerator/denominator and classification of internal sources.
- Full solver/API contract, objective economics, compatibility rules, MIP options, result/dual
  semantics, and child design docs still require owner decisions/review.

## Verification evidence

Run from the repository root:

- `npm test -- src/data/sourcesUses.test.ts` — passed, 8 tests.
- `npm run typecheck` — passed.
- `npm run build:client` — passed. Vite reports the existing large JavaScript chunk warning
  (about 2.06 MB minified); this does not fail the build.
- `npm run check:agent-skills-pin` — passed for all 13 pinned files.
- `git diff --check` — passed after the spec and handoff updates.

## Next steps

1. Resolve the open decisions in `SPEC.md` and approve the complete spec, plan, task list, and
   child design documents before starting the optimizer/service slice.
2. Keep SU-002/SU-003/SU-007 marked in progress: current setup-only artifacts do not satisfy the
   eventual canonical run-hash, rules-engine, solver-result, or end-to-end acceptance criteria.
3. Define versioned service request/result contracts and canonical configuration/run hashing;
   then build compatibility and solver slices with hand-derived golden cases and an independent
   verifier.
4. Add approved LP/MIP behavior, service hardening and observability, result presentation, verified
   OPT run history, and release/as-built validation in the task order.
5. Follow the pinned Agent Skills for each implementation slice and preserve reproducible
   verification evidence in this handoff/task record.
