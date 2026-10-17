# Plan: Configurable Sources and Uses Optimizer

- **Spec:** spec012-configurable-sources-uses (`SPEC.md`)
- **Status:** Draft — pending owner review
- **Last updated:** 2026-10-17

## Approach

Treat user configuration as the sole source of supply, demand, costs, and compatibility. Validate and canonicalize it before solving; compute a stable hash for the run envelope. The terminal stores/selects named configurations and composes the service call. The Python service receives all data in the request and has no database dependency.

The LP has flow variables per compatible source/use pair. Capacity and haircut-adjusted coverage constrain flows. Lexicographic stages satisfy higher-priority hard/soft objectives before optimizing economics. Optional MIP variables activate discrete rules. The shared `optimization_core` builds and verifies the formulation.

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

## Sequence

Owner resolves open questions and approves this spec, plan, task list, and white-paper design. Then scaffold service and contracts, implement compatibility and the LP, add optional MIP rules, build the editor and result views, and finish with OPT run history and as-built evidence. No code starts before approval.
