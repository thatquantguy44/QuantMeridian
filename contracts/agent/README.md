# Agent contracts (spec009)

JSON Schemas and shared data for module agent workflows. The schemas are the single source of
truth: TypeScript types, pydantic models, and both runtimes' validators all derive from or read
these files, so the Node server and the Python worker cannot disagree.

| File | Contract (`schema_version`) | Written by |
| --- | --- | --- |
| `agent-workflows.schema.json` | `agent-workflows/1` — `settings/agent_workflows.json` | owner |
| `llm-profiles.schema.json` | `llm-profiles/1` — `settings/llm_profiles.json` | owner |
| `job.schema.json` | `agent-job/1` — `POST /api/agent/jobs` body | panel |
| `result.schema.json` | `agent-result/1` — a worker's result payload (no verdict field) | worker |
| `verification.schema.json` | `agent-verification/1` — verifier output | Node verifier only |
| `metric-registry.schema.json` | `metric-registry/1` — `generated/metric_registry.json` | generated |
| `quantsmith-pin.schema.json` | `quantsmith-pin/1` — `quantsmith-pin.json` | reviewer |
| `formula-vectors.schema.json` | `formula-vectors/1` — `fixtures/formulas/*.json` | maintainers |

Other files:

- `quantsmith-pin.json` — reviewed content fingerprints of the QuantSmith copy the worker may
  run. See `docs/specs/spec005/QUANTSMITH_PIN.md` and `npm run check:quantsmith-pin`.
- `module-policy.json` — the reviewed set of modules that may host a panel, per-module context
  field allowlists, known domain packs, and forbidden header names. Read by both validators.
- `generated/metric_registry.json` — generated; never edit by hand.
- `fixtures/` — data shared by both runtimes' tests (settings secret-shape cases, an example
  result, later formula vectors and verifier fixtures).

## Versioning

Every contract carries `schema_version: "<name>/<major>"`. A reader accepts its own major
version and ignores unknown additive fields; any other version is refused and shown as an
incompatible state (`src/lib/agent/compat.ts`, `agent_worker/contracts.py`). A breaking change
needs a new major version. Adding an optional field is not breaking.

## Changing a schema

1. Edit the `.schema.json` file.
2. `npm run generate:agent-contracts` regenerates `src/lib/agent/contracts/*.generated.ts` and
   `services/agent_worker/src/agent_worker/contracts_generated/*.py`. It needs the worker's dev
   dependencies (`pip install -e 'services/agent_worker[dev]'`), or `AGENT_PYTHON` pointing at a
   Python that has `datamodel-code-generator`; pass `--ts-only` to skip the Python half locally.
3. `npm run check:agent-contracts` (also run in CI) fails if the committed output is stale.
4. If the metric registry's shape changed, `npm run export:agent-metric-registry` too.

## Metric registry

`npm run export:agent-metric-registry` rebuilds the registry from `FRED_CATALOG`, the desk
dataset registry (`src/lib/server/agent/deskDatasets.ts`), the reviewed unit table
(`src/lib/server/agent/metricUnits.ts`), and `settings/agent_metric_synonyms.json`. A Vitest check
fails when the committed file is stale.

Verified claims report the raw Gold `lin` level, so a metric's `unit` is the unit of that level.
Where the terminal shows a transform (for example CPI as % y/y), the registry says `index` for the
level and records the chart's unit separately in `chart_unit`. A catalog series that is neither
plain nor listed in the reviewed table is excluded from the registry, never guessed at.
