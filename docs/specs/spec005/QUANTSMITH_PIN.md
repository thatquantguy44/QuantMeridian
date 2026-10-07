# QuantSmith Pin Record

Market Terminal does not `pip install quantsmith` (see `spec005`'s Explicit
Non-Goals), so QuantSmith's own `hooks/stages/quantsmith-version-check.sh`
gate cannot fire here — it looks for a `quantsmith==X.Y.Z` line in
`requirements.txt`/`pyproject.toml` and an importable package, neither of
which exists in a Node/Vite repo. Spec `0047` documents this exact gap as
`RISK-004` and names the fallback: for a consumer that only reads rendered
artifacts, the guard is `schema_version` on the payload itself, not the
package pin.

This file is that fallback's record for everything Market Terminal has
actually looked at or consumed from QuantSmith so far — narrower than a
package pin, but the same idea: a reviewed-against commit, so drift is
visible instead of silent.

## Current Pin

| Field | Value |
| --- | --- |
| Repo | `joshualutkemuller/QuantSmith` (local path: `../agentic_workflows/qf_workflow_sdk_public`) |
| Commit | `d57cb67257b35a6759f1d5c049c0a78e4fff730d` |
| Commit date | 2026-08-29 |
| `pyproject.toml` version | `0.1.0` (no Git tags cut yet as of this pin) |
| Reviewed by | Claude, for Joshua, while authoring `spec005` |
| Reviewed for | `README.md`, `specs/0045-fred-point-in-time/spec.md`, `specs/0047-downstream-contract/spec.md`, `specs/0059-morning-market-brief/spec.md`, `agents/economists/README.md`, `adapters/dashboard_render/README.md` + `specs/0017-dashboard-render-adapters/spec.md` |

### spec009 content pin

spec009 (module agent workflows) runs QuantSmith code in a local worker, so it is pinned by
content fingerprints, not by commit. The machine-readable record is
[`contracts/agent/quantsmith-pin.json`](../../../contracts/agent/quantsmith-pin.json);
`scripts/check-quantsmith-pin.sh` fails when the values below and the JSON disagree. The worker
(`services/agent_worker/src/agent_worker/pin.py`) recomputes both digests from the copy it
actually loads and refuses to claim jobs on a mismatch.

| Field | Value |
| --- | --- |
| Pin file | `contracts/agent/quantsmith-pin.json` |
| Package version | `0.1.0` |
| Code digest | `sha256:e54b0f69215ba6abf9b2434e88e9fa7efd9d71bc3c4e67ec3ce6f2573b39c3e9` |
| Assets digest | `sha256:cf8d8780b316f0fdc152649d98736c7e649780bbe8fb5cd35caabc58d8c0f088` |
| Reviewed on | 2026-10-07 |
| Reviewed commit (informational) | `0134d403d5a336ce20e7abd7fb7a0935d7917114` (2026-10-06) |
| Reviewed by | Claude, for Joshua, implementing `spec009` T-001 |
| Reviewed for | `specs/0008-metrics-semantic-layer`, `specs/0028-financing-cost-analysis`, `specs/0063-short-term-markets-domain-foundation`, `specs/0070-prompt-context-harness-foundation`, `specs/0080-nl-analytics-insights`, `specs/0081-analytics-domain-packs`, `specs/0093-visualization-packs`, `adapters/llm_runtime/`, `src/quantsmith/{nl_analytics,pipelines,visualization_packs}`, and the asset paths listed in the pin JSON |

The code digest covers every `*.py` file under `src/quantsmith/`; the assets digest covers every
file under the JSON's `assets.paths`. Both hash file bytes as stored (no newline normalization).
A wheel built from the reviewed commit has the same code digest as the checkout (verified for
this pin). The reviewed commit is information only: what the worker trusts is the digests.

To re-pin after reviewing a newer copy, run
`python3 -I services/agent_worker/src/agent_worker/pin.py --root PATH_TO_QUANTSMITH`, update the
JSON and the two digest rows above together, and extend "Reviewed for" with what was re-read.

## What This Pin Covers

Only the synergy claims made in `docs/specs/spec005/SPEC.md` are validated
against this commit. It does **not** mean every QuantSmith spec, agent, or
gate has been reviewed — the SDK has 52+ specs and 162 agents; spec005
inventories a handful with a real, confirmed connection to Market Terminal.

Note: the `Commit` row above is spec005's reviewed commit and is only compared informationally.
spec009's trust anchor is the content pin in the section above.

## Updating This Pin

Re-review is needed before treating a newer QuantSmith commit as the basis
for further spec005 work when any of the reviewed files above have changed
upstream, or before starting spec005 Phase 2 (the narrative-drafting pilot).
`scripts/check-quantsmith-pin.sh` reports (advisory, non-blocking) how far
the sibling checkout has drifted from the commit recorded here.
