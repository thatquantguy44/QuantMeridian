# Plan: Configurable Sources and Uses Optimizer

- **Spec:** spec012-configurable-sources-uses (`SPEC.md`)
- **Status:** Setup-only phase (in `main`) and synthetic PoC showcase (SU-SIM, merged in PR #166) approved; open questions 1–4 resolved 2026-10-18; full optimizer design approval remains pending
- **Last updated:** 2026-10-18

## Approach

Treat user configuration as the sole source of supply, demand, costs, and compatibility. Validate and canonicalize it before solving; compute a stable hash for the run envelope. Validation rejects a run that spans more than one currency (SPEC question 4) and any `allowed` rule on a currency-mismatched pair (question 1). The terminal stores/selects named configurations and composes the service call. The Python service receives all data in the request and has no database dependency.

The LP has flow variables per compatible source/use pair. Capacity and haircut-adjusted coverage constrain flows. All amounts stay continuous and unrounded; rounding is display-only and the verifier uses tolerances on full-precision values (question 2). The internalization rate is computed from the verified flows as internal haircut-adjusted coverage over total delivered coverage, using each source's explicit `internality` attribute, and is `n/a` when a contributing source is unclassified (question 3). Lexicographic stages satisfy higher-priority hard/soft objectives before optimizing economics. Optional MIP variables activate discrete rules. The shared `optimization_core` builds and verifies the formulation.

## Components

1. Versioned source/use/configuration contracts with JSON Schema and generated TypeScript/Python models.
2. Compatibility rules engine with effective, explainable matrix and explicit per-cell override.
3. LP formulation and priority-tier solve sequence; explicit hard infeasibility and soft residuals.
4. Optional MIP formulation with activation, lot, count, all-or-none, and exclusive-pair rules.
5. Independent verifier, elastic infeasibility explanation, binding rows, and properly qualified duals.
6. UI editor, matrix, results table, Sankey, export/import, and saved configurations.
7. Real run-history integration with OPT and removal of generated matches.

## Validation

Golden cases cover each compatibility field, explicit override, hard/soft use, each tier, binding capacities, and every MIP rule. Contract tests cover CSV/JSON round-trip and configuration hashing. Verifier tampering must fail closed. UI tests check matrix editing, export parity, infeasible states, data provenance, and keyboard/accessibility behavior.

## Pinned Agent Skills

SXU implementation follows the upstream skills `incremental-implementation`,
`test-driven-development`, `doubt-driven-development`, `code-review-and-quality`, and
`frontend-ui-engineering`, with `using-agent-skills` as the workflow router. The byte-for-byte
snapshot and immutable source commit are recorded in `contracts/agent/agent-skills.pin.json`.
Run `npm run check:agent-skills-pin` to verify its SHA-256 and Git blob pins; CI runs the same
check without network access. Skill changes require reviewing the upstream commit and intentionally
updating the manifest.

## Sequence

The owner has approved a bounded setup-only phase: versioned browser configuration, source/use editing, explicit compatibility setup, and validated import/export. This phase does not enable solving or expose recommendations. The owner resolved the four model questions on 2026-10-18 (SPEC decision log). Child-document approval still gates service/model behavior. After that approval, scaffold the service contracts, implement the compatibility engine and LP, add optional MIP rules, connect result views and OPT run history, and finish with independent validation and as-built evidence. Follow the pinned Agent Skills throughout.

Separately, the owner approved a synthetic proof-of-concept showcase (SPEC § SU-SIM). It runs the
illustrative penalised, balanced transportation LP in the browser against a fixed SIM book. It is
clearly labelled and independently verified. It is not the production service. It was built to avoid the then-open
decisions and is consistent with their 2026-10-18 resolutions.

**Production path stays as planned above.** The browser solver
(`src/lib/optimization/simplex.ts`) is showcase-only. Production solving belongs in
`services/sources_uses_api` on `services/optimization_core`, following owner decision 1 in
`docs/handoff.md`. The showcase's hand-computable cases and verifier checks should be reused as
golden and acceptance fixtures for that service.

See [HANDOFF.md](HANDOFF.md) for the current branch checkpoint, verified commands, implementation boundary, recorded decisions, and ordered next steps.
