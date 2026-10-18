# Tasks: Configurable Sources and Uses Optimizer

- **Spec:** spec012-configurable-sources-uses (`SPEC.md`, `PLAN.md`)
- **Status:** Bounded setup-only phase (in `main`) and SU-SIM showcase (merged in PR #166) approved; open questions 1–4 resolved and full spec approved 2026-10-18; production solver/service is authorized but not yet built
- **Last updated:** 2026-10-18
- **Checkpoint:** See [HANDOFF.md](HANDOFF.md) for branch state and pickup instructions
- **Parent requirements:** 0018 REQ-021–029, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| SU-001 | Resolve compatibility, units, internalization, and currency questions; approve child docs. | SU-001–009 | done | **2026-10-18:** all four questions resolved (currency hard block; display-only rounding; internalization definition; one currency per run), and the full SPEC, PLAN, TASKS and design paper (`docs/whitepapers/sources_and_uses.md`, standing in for the child design docs) approved. Both recorded in the SPEC.md decision log. |
| SU-002 | Define versioned contracts, config schema, canonical hash, and CSV/JSON round-trip. | SU-001, SU-009 | done | **Built:** `services/sources_uses_api` (`contracts.py`, `canonical.py`) defines `ConfigurationContent` and `SolveRequest` at `1.0.0`, with per-record `provenance`; the published schema `contracts/sources_uses/solve-request.schema.json`; `src/lib/sourcesUsesContract.ts` maps the browser v1 configuration onto it. Canonical JSON and SHA-256 configuration/request hashes are byte-identical in TypeScript and Python (shared `contracts/sources_uses/fixtures/canonical-vectors.json`). Provenance is an explicit optional field on browser records, set to `sim` by "Copy to workspace". Tests: field, enum and required-field parity with the schema, AC-001 (JSON and CSV export/reimport keep the hash), AC-009 (haircut changes the hash), order independence, question 1 and question 4 rejections, hash mismatch, no type coercion, and CSV import fixes (quoted trailing carriage return, byte-order mark). CI job `sxu-service`. The result contract is defined with the LP (SU-004). **Decided 2026-10-18:** add an explicit per-source `internality` field (`internal`/`external`, unset allowed) with provenance; the run request carries exactly one currency; amounts and the hash keep full precision (no rounding). |
| SU-003 | Implement compatibility rules and editable matrix with explicit override state. | SU-002 | in-progress | Rule-by-rule and override golden tests; current UI records explicit pair states only and does not solve. **Decided 2026-10-18:** the rules engine must reject any `allowed` rule on a currency-mismatched pair (a hard block, with no override). Cross-entity pairs are allowed only through an explicit rule. |
| SU-004 | Implement LP with hard/soft uses and lexicographic tiers. | SU-003, SU-004 | todo | Hand-derived cases include large lower-tier economics. Define the versioned result contract (flows, coverage, status, run hashes) alongside it. The multi-currency rejection naming the records is already enforced by `SolveRequest` (SU-002); no rounding inside the model. |
| SU-005 | Add independent verifier, binding rows, duals, and infeasibility explanation. | SU-006, SU-007 | todo | Tamper tests; MIP dual caveat fixture. Internalization rate per the decision log, with fixtures for an all-classified case, an unclassified contributing source (`n/a` plus disclosed share) and zero delivered coverage (`n/a`). |
| SU-006 | Add optional MIP rules and formulation disclosure. | SU-005 | todo | Per-rule binding/invalid cases |
| SU-007 | Build editor, compatibility matrix, results/Sankey, and CSV/JSON import/export. | SU-001–006, SU-009 | in-progress | Setup-only editor and CSV/JSON import/export implemented. The SU-SIM showcase has result views (network, tableau, coverage, duals) that can be adapted, but production result views must read verified service output. Wiring to the service and its tests remain. |
| SU-008 | Remove random matches and add verified OPT run history. | SU-008 | todo | No random source remains on page; run hashes shown |
| SU-009 | Add service auth/health/telemetry and local launcher integration. | 0018 REQ-027 | todo | Service/API parity, redaction, health evidence |
| SU-010 | Benchmark and document the as-built model and demo path. | REQ-041 | todo | Approved worked example, model card, validation record |
| SU-012 | Synthetic PoC showcase mode (SU-SIM, PR #166): deterministic dataset, scenarios, penalised balanced transport LP, configurable penalties, verifier and LP certificate, and visual front end. | SIM-001–010 | done | `src/data/sourcesUsesSynthetic.ts`, `src/lib/optimization/simplex.ts`, `src/app/sources-uses/synthetic/`; unit tests cover hand-computable LPs, every penalty, both priority modes, verifier and certificate tamper, and infeasibility |
| SU-013 | Module SIM switch and provenance badge on the Sources & Uses page. | SIM-007, SU-009 | done | **2026-10-18 (owner decision):** SIM is on by default until the page is wired to a production model, and an on-screen **SIM ON/OFF** switch persists per browser. On shows the Synthetic PoC and `ProvenanceBadge source="SIM" simSelected`, which stays SIM even when global SIM mode is off. Off hides the PoC, disables its tab, and shows `PENDING`. SXU now passes `badge-coverage.test.ts`; `resolveBadgeSource` has tests. |
| SU-011 | Pin and apply upstream Agent Skills for production engineering, testing, and independent validation. | SU-002–010 | done | `thatquantguy44/agent-skills` snapshot pinned by commit, SHA-256, and Git blob IDs; repository guidance and hosted pin check |

## Definition of Done

- Child spec is owner-approved before implementation.
- Results are independently verified and reconcile to source configuration.
- SIM/user inputs and derived values are visibly labeled and traceable.
- Full unit, service, route, and relevant demo checks pass before closure.
- SXU service/model changes follow the pinned Agent Skills; CI fails on unreviewed skill drift.
