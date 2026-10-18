# IBAL Inventory Optimizer API

This companion service is the only QuantMeridian boundary allowed to construct, validate, solve,
or export InventoryBallast data. It pins InventoryBallast commit
`bb425cac10d1da29e74fe8f854fd41b31f460773` (merged upstream PRs #38 and #39) and fails readiness if the engine's identity does not
match `capability-manifest.json` or no supported solver backend is installed.

Market Terminal does not require `highspy` by default. The service can solve LP/MIP runs through
SciPy's HiGHS wrappers, while QP runs require installing the optional `highs` extra because IBAL's
QP adapter is owned by `highspy`.

## Supplying the InventoryBallast engine

The engine (`inventory_optimizer`) is not a hard dependency and does not have to come from GitHub.
Pick one source:

| Source | How | `/health` `engine_source` |
|---|---|---|
| Local checkout, no install | `INVENTORY_OPTIMIZER_ENGINE_PATH=/path/to/InventoryBallast` | `path` |
| pip from a local directory | `pip install /path/to/InventoryBallast` (or `-e` for editable) | `local` / `editable` |
| pip from a wheel | `pip install ./inventory_optimizer-0.1.0-py3-none-any.whl` | `archive` |
| pip from a package index | `pip install -e ".[engine]"` (or `pip install inventory-optimizer==0.1.0`) | `index` |
| pip from GitHub | `pip install -e ".[engine-github]"` | `vcs` |

`INVENTORY_OPTIMIZER_ENGINE_PATH` accepts a checkout root (with `src/inventory_optimizer/`) or a
directory that holds `inventory_optimizer/` directly. When set, it takes precedence over any
pip-installed copy. The service's own dependencies already cover the engine's runtime
dependencies, so a checkout needs no install of its own. If no engine can be imported, the service
refuses to start and names the options above.

**Readiness does not trust the source.** At startup and on every `/health`, the service hashes the
engine's Python sources and compares the result with `engine_fingerprint` in
`capability-manifest.json`, alongside `engine_package_version`. When a commit is known (git
install, editable install or checkout with a `.git`, or the `INVENTORY_OPTIMIZER_ENGINE_COMMIT`
override), it must also equal `engine_commit`. Any source that delivers the pinned code is ready.
A checkout on another commit or with local edits is `unready`. `/health` then reports
`error_category: "incompatible_engine"` and lists the reasons in `engine_mismatches` (`version`,
`fingerprint`, `commit`, `engine_not_importable`, `engine_path_not_used`).

To print an engine's identity, for example before re-pinning:

```bash
.venv/bin/python -m inventory_optimizer_api.engine_fingerprint /path/to/InventoryBallast
```

When re-pinning, update `engine_package_version`, `engine_commit` and `engine_fingerprint` in
`capability-manifest.json` together, along with the `engine-github` extra in `pyproject.toml` and
the Dockerfile default.

## Local run

Python 3.12 or newer is required (the pinned SciPy needs it).

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"
INVENTORY_OPTIMIZER_ENGINE_PATH=/path/to/InventoryBallast \
INVENTORY_OPTIMIZER_API_TOKEN=local-only-change-me \
  .venv/bin/uvicorn inventory_optimizer_api.app:app --host 127.0.0.1 --port 8013
```

Leave out `INVENTORY_OPTIMIZER_ENGINE_PATH` if you installed the engine with pip (see above).

For full LP/MIP/QP coverage, install the optional HiGHS binding:

```bash
.venv/bin/pip install -e ".[dev,highs]"
```

## Docker

The image installs the engine from the `INVENTORY_OPTIMIZER_ENGINE` build argument, which takes
any pip requirement. The default is the pinned GitHub URL.

```bash
docker build -t ibal .                                  # pinned GitHub commit
cp /path/to/inventory_optimizer-0.1.0-py3-none-any.whl wheels/
docker build -t ibal --build-arg INVENTORY_OPTIMIZER_ENGINE=./wheels/inventory_optimizer-0.1.0-py3-none-any.whl .
docker build -t ibal --build-arg INVENTORY_OPTIMIZER_ENGINE=inventory-optimizer==0.1.0 .   # index
```

Build a wheel from a checkout with `python -m build --wheel /path/to/InventoryBallast`.

Port `8013` matches `src/lib/server/inventoryOptimizerProxy.ts`'s default
`INVENTORY_OPTIMIZER_API_URL` -- change both together if you use a different port.
`GET /health` is public and contains readiness metadata only. Every `/v1/*` endpoint requires a
server-held bearer token and `X-Correlation-ID`; run creation and scenario stress runs also require
`Idempotency-Key`.
Uploaded rows, normalized requests, and result values are held only for the request lifetime and
are never logged or persisted.

## Scenario API

`GET /v1/scenarios/catalog` returns the pinned InventoryBallast scenario registry, applicable
problem families, version, and each parameter model's JSON Schema. `POST
/v1/scenarios/stress-test` accepts a prepared dataset, run configuration, the matching verified
baseline result, one registry scenario type, and explicit parameters. The service validates the
dataset and baseline hashes/configuration, delegates generation and stress execution to the
engine, and returns generated scenario lineage, ranked outcomes, entity driver deltas, and driver
reconciliation residuals. A batch is limited to ten generated scenarios and a five-minute
aggregate solver budget. Borrower-default recovery is never inferred: omitted recovery means zero.

The endpoint does not persist scenarios or results. Clients must retain the returned request,
baseline, and generated scenario identities with any exported analysis.

To wire this into Market Terminal's own dev server: set the same
`INVENTORY_OPTIMIZER_API_TOKEN` value in the repo root's `.env` (see `.env.example`), then
(re)start `npm run dev` -- Vite only reads `.env` at startup, so an already-running dev server
needs a restart to pick up a newly added token.

## Production gate

Market Terminal's server-side proxy refuses to call this service in production unless all of the
following are true:

- `INVENTORY_OPTIMIZER_API_TOKEN` or `IBAL_API_TOKEN` is set in Market Terminal.
- `IBAL_PRODUCTION_ENABLED=true` is set by the operator.
- `IBAL_TRUSTED_ACCESS_BOUNDARY` identifies the approved server-side boundary protecting the
  service.

`/api/dataops/health` reports the resulting IBAL state as `LIVE`, `STALE`, or `ERROR` with
sanitized diagnostics only. It never returns the service base URL, bearer token, uploaded rows,
normalized request, or solve result values.
