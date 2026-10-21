# Running QuantMeridian's services

This is the high-level guide to the model services that sit beside the terminal: what each one
is for, how to start it locally, and how to point the terminal at it. Each service's own README
has the full detail; this page links to it rather than repeating it.

## How the pieces fit

```
browser ──► terminal (Vite dev server, :3000) ──► model service (127.0.0.1:80xx)
            server routes hold URLs and tokens      no database, no market-data client
```

- The browser only ever calls the terminal's same-origin `/api/...` routes. Service URLs and
  tokens stay on the terminal's server side.
- Each module has its own Python service. Services never call each other; the terminal's server
  routes compose them (owner decision, InventoryBallast `0018`).
- Every service runs locally only. Production access is blocked unless an operator sets that
  module's production gate (see each README). Results are SIM or local previews, never
  recommendations or executions.

## At a glance

| Service | Module / page | Port | Runnable? | Pickup document |
|---|---|---|---|---|
| Terminal (`npm run dev`) | everything | 3000 | yes | [`README.md`](../README.md) |
| [`inventory_optimizer_api`](../services/inventory_optimizer_api/README.md) | IBAL `/inventory-optimizer` | 8013 | yes, needs the InventoryBallast engine | `docs/specs/spec013/` |
| [`money_market_api`](../services/money_market_api/README.md) | MMKT `/money-market` | 8014 | yes | [`spec011/HANDOFF.md`](specs/spec011/HANDOFF.md) |
| [`sources_uses_api`](../services/sources_uses_api/README.md) | SXU `/sources-uses` | 8015 (reserved) | **not yet**: contracts and tests only | [`spec012/HANDOFF.md`](specs/spec012/HANDOFF.md) |
| `liquidity_api` | `/cash-optimizer/liquidity` | 8016 (reserved) | **not yet**: spec014 is a draft | `docs/specs/spec014/` |
| [`collateral_optimizer_api`](../services/collateral_optimizer_api/README.md) | COLL `/collateral`, OPT preview | 8017 | yes, needs an authorized InventoryBallast checkout | `docs/specs/spec016/` |
| [`indemnification_api`](../services/indemnification_api/README.md) | INDEM `/securities-lending/indemnification` | 8018 | yes, no external engine | [`spec020/HANDOFF.md`](specs/spec020/HANDOFF.md) |
| [`news_nlp`](../services/news_nlp/README.md) | NEWS sentiment, NER, clustering | 8088 | yes (lexicon fallback without the model stack) | [`services/news_nlp/README.md`](../services/news_nlp/README.md) |
| [`macro_data_etl`](../services/macro_data_etl/README.md) | ETL batch jobs for global macro data | — (CLI) | yes, run on demand | [`services/macro_data_etl/README.md`](../services/macro_data_etl/README.md) |
| `agent_worker` | ECOIQ agent panel | — (polls a queue) | yes | `docs/specs/spec009/` |
| [`optimization_core`](../services/optimization_core/README.md) | shared library | — | no, it is installed into other services | — |

All Python services need **Python 3.12 or newer**. Use one virtual environment per service.

**Everything at once:** `npm run dev:all` (or `scripts/dev-all.sh`) starts the terminal, IBAL, MMKT,
COLL and the agent worker, builds what they need under `.data/` on first run, and stops them all on
Ctrl-C. It reads tokens from `.env.local` and needs an InventoryBallast checkout
(`INVENTORY_BALLAST_REPO`, default `../../models/InventoryBallast`). Flags: `--no-agent`, `--no-coll`.
Logs go to `.data/logs/`.

## 1. The terminal

```bash
npm ci
cp .env.example .env.local      # then uncomment what you need (sections below)
npm run dev                     # http://localhost:3000
```

The dev server reads `.env` and `.env.local` **only at startup**. After adding or changing a
service URL or token, restart `npm run dev`.

Many modules work with no service running; they show their own data source (`SIM`, `DB`,
`PENDING`, `ERR`) in a provenance badge. A module whose service is missing says so and does not
substitute data.

## 2. IBAL inventory optimizer: `inventory_optimizer_api` (port 8013)

Solves InventoryBallast inventory allocation runs for `/inventory-optimizer`. It pins one
InventoryBallast engine commit and reports *unready* if the installed engine does not match.

```bash
cd services/inventory_optimizer_api
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"            # add ",highs" for QP runs
INVENTORY_OPTIMIZER_ENGINE_PATH=/path/to/InventoryBallast \
INVENTORY_OPTIMIZER_API_TOKEN=local-only-change-me \
  .venv/bin/uvicorn inventory_optimizer_api.app:app --host 127.0.0.1 --port 8013
```

Terminal `.env.local`:

```bash
INVENTORY_OPTIMIZER_API_TOKEN=local-only-change-me
# INVENTORY_OPTIMIZER_API_URL=http://127.0.0.1:8013   # the default
```

- **Engine:** leave out `INVENTORY_OPTIMIZER_ENGINE_PATH` if you installed the engine with pip.
  The README lists every supported source (checkout, wheel, index, GitHub) and Docker builds.
- **Check:** `curl http://127.0.0.1:8013/health`. `ready: false` with `incompatible_engine`
  means the engine is not the pinned commit.

## 3. MMKT money market optimizer: `money_market_api` (port 8014)

Allocates forecast surplus cash across money-market instruments as a verified continuous LP for
`/money-market`. The terminal builds the rate snapshot and passes it in; the service has no
database access. With the `local-mmkt-execution-v2` binding it solves a verified ticketed MIP and returns an
indicative execution blotter (no orders are routed); `local-mmkt-lp-v1` allows only the continuous LP preview.

```bash
python3.12 -m venv .venv-mmkt
.venv-mmkt/bin/pip install ./services/optimization_core ./services/money_market_api
cd services/money_market_api
MONEY_MARKET_API_TOKEN=local-token MONEY_MARKET_MODEL_BINDING=local-mmkt-execution-v2 \
  ../../.venv-mmkt/bin/uvicorn money_market_api.app:app --app-dir src --port 8014
```

Terminal `.env.local`:

```bash
MONEY_MARKET_API_TOKEN=local-token
# MONEY_MARKET_API_URL=http://127.0.0.1:8014          # the default
```

- **Binding:** without `MONEY_MARKET_MODEL_BINDING` the service starts but reports `UNCONFIGURED` and
  refuses to solve. `local-mmkt-lp-v1` allows only the LP preview; the page's default ticketed plan needs
  `local-mmkt-execution-v2`.
- **Check:** `curl http://127.0.0.1:8014/health` returns `"status":"ready"`. On `/money-market`,
  the **Model service** panel ticks off each setup step and names the one that is missing.
- **Gotcha:** a stale `uvicorn` still holding port 8014 makes a new one fail to bind silently.
  Stop the old process first.
- **Rates:** choose a SIM rate set on the page. The real-rate (Gold) option fails closed until
  EcoMedallion's `gold.mmkt_rate_snapshot` is wired (issue #149).

## 4. Sources & Uses: `sources_uses_api` (port 8015, not runnable yet)

So far this package holds only the versioned request contracts and the canonical configuration
and run hashes (spec012 SU-002). It has no solver and no HTTP endpoint, so there is nothing to
start. The `/sources-uses` page works without it: the configuration workspace and the Synthetic
PoC tab run entirely in the browser.

To run its checks:

```bash
python3.12 -m venv .venv-sxu
.venv-sxu/bin/pip install -e ./services/sources_uses_api pytest ruff
cd services/sources_uses_api && ../../.venv-sxu/bin/ruff check . && ../../.venv-sxu/bin/pytest -q
```

SU-003 to SU-005 add the solver on `optimization_core` and SU-009 adds the API; this section will
gain start commands then.

## 5. Collateral optimizer: `collateral_optimizer_api` (port 8017)

Runs InventoryBallast's separately packaged collateral optimizer on synthetic books for
`/collateral` and the OPT page's collateral preview. It refuses to solve unless the installed
wheel matches the reviewed commit recorded in `binding-manifest.json`.

You need an authorized InventoryBallast checkout at the pinned commit. Then:

```bash
python scripts/build-collateral-wheel.py /path/to/InventoryBallast/projects/collateral_optimizer \
  --output /tmp/collateral-wheel --require-git
python3.12 -m venv /tmp/collateral-venv
/tmp/collateral-venv/bin/pip install -r services/collateral_optimizer_api/requirements.lock
/tmp/collateral-venv/bin/pip install --no-deps /tmp/collateral-wheel/collateral_optimizer-0.1.0-py3-none-any.whl
PYTHONPATH=services/collateral_optimizer_api/src \
COLLATERAL_BINDING_ATTESTATION=/tmp/collateral-wheel/binding-attestation.json \
COLLATERAL_OPTIMIZER_API_TOKEN=local-secret \
  /tmp/collateral-venv/bin/uvicorn collateral_optimizer_api.app:app --port 8017
```

Terminal `.env.local` (there is no default URL; both are required):

```bash
COLLATERAL_OPTIMIZER_API_URL=http://127.0.0.1:8017
COLLATERAL_OPTIMIZER_API_TOKEN=local-secret
```

- **Check:** `/health` reports `UNCONFIGURED` without the attestation and `INCOMPATIBLE` if the
  commit, wheel, lock or schema has drifted; runs then fail closed.

## 5a. Indemnification risk: `indemnification_api` (port 8018)

Monte Carlo of correlated markets and borrower defaults (wrong-way link, reinvestment pool, close-out profile)
for the INDEM page. The terminal builds the simulated lending book and sends the settings; the service has no
database access and needs no external model. Local only. The model is complete and validated
([`spec020/VALIDATION.md`](specs/spec020/VALIDATION.md)); the page works end to end.

```bash
python3.12 -m venv .venv-indem
.venv-indem/bin/pip install -e "./services/indemnification_api[dev]"
cd services/indemnification_api
INDEMNIFICATION_API_TOKEN=local-token INDEM_ENV=local \
  ../../.venv-indem/bin/uvicorn indemnification_api.app:app --app-dir src --port 8018
```

Terminal `.env.local`:

```bash
INDEMNIFICATION_API_URL=http://127.0.0.1:8018
INDEMNIFICATION_API_TOKEN=local-token
```

- **Not started by `npm run dev:all` yet** (spec020 IND-T15b). Start it by hand as above.
- **Check:** `curl http://127.0.0.1:8018/health` returns `"status":"ready"`. The page's header badge shows
  "Service ready"; without the URL and token it says the service is not configured and does not substitute data.
- **Run times:** a desk preview with sensitivities takes about 20 s. A reported annual run (252 days, 50,000
  paths) takes about 163 s and 3.5 GB of memory; with sensitivities about 414 s, which is **longer than the
  terminal's 300 s run timeout** (spec020 IND-T15a). Use preview runs, or turn sensitivities off, until that is fixed.
- **Gotcha:** one run at a time. The page's Cancel stops waiting but the service keeps computing until the model
  finishes, so a new run meanwhile gets "busy". Restart the service after changing model code; it does not reload.

## 6. Agent worker: `agent_worker` (no port)

A local worker that claims queued ECOIQ agent jobs and runs them through the terminal's attended
execution endpoint. It needs the same queue database as the terminal.

```bash
python3.12 -m venv .venv-agent
.venv-agent/bin/pip install -e "./services/agent_worker[dev]"
AGENT_QUEUE_DB_URL=sqlite:./.data/agent_queue.db \
AGENT_WORKER_TOKEN=<same value as the terminal> \
QUANTMERIDIAN_API_URL=http://127.0.0.1:3000 \
  .venv-agent/bin/python -m agent_worker.worker
```

Terminal `.env.local` (see the spec009 block in `.env.example` for the LLM profile settings):

```bash
AGENT_QUEUE_DB_URL=sqlite:./.data/agent_queue.db
AGENT_SESSION_SECRET=<random-32-bytes>
AGENT_WORKER_TOKEN=<random-32-bytes>
```

- The worker exits with `AGENT_QUEUE_NOT_CONFIGURED` if `AGENT_QUEUE_DB_URL` is unset.
- QuantSmith-backed workflows also need `QUANTSMITH_ROOT` pointing at your local QuantSmith
  copy; it is never fetched over the network (`npm run check:quantsmith-pin` checks it).

## 7. News NLP: `news_nlp` (port 8088)

FinBERT-style sentiment, entity extraction and event clustering for the NEWS and SENT modules.
Without the optional model stack it falls back to a lexicon scorer, so it always starts.

```bash
cd services/news_nlp
python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"     # add ".[nlp]" for FinBERT/spaCy
.venv/bin/news-nlp serve --port 8088
```

Terminal `.env.local` (no default; unset means the terminal uses its own heuristic scorer):

```bash
NEWS_NLP_URL=http://127.0.0.1:8088
```

- **Check:** `curl http://127.0.0.1:8088/health`, or the NEWS_NLP row of `/api/dataops/health`.

## 8. Macro ETL: `macro_data_etl` (CLI, no port)

Batch ETL for World Bank, BIS and CME data into a local DuckDB and gold parquet files. The terminal
does **not** call it at runtime: it reads the committed JSON snapshots in `src/data/etl/`, which are
exported from this package (`macro-etl export`). Run it only to refresh those snapshots.

```bash
cd services/macro_data_etl
python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/macro-etl --help
```

## 9. Shared library: `optimization_core`

The sparse LP builder, SciPy HiGHS adapter and independent verifier that model services build
on. It is not a service. Install it into the consuming service's environment, as in the MMKT
steps above.

## Modules that need no service of their own

- **MMFO** (`/money-market-fund-optimizer`): the local SIM proof of concept runs inside the
  terminal's own API. `MM_FUND_OPTIMIZER_API_URL` is only for a separately deployed model
  service, which is not yet approved (spec015).
- **VOLF** (volatility forecaster): calls the external QR Haven API, which lives outside this
  repository. Set `QR_HAVEN_VOLATILITY_API_URL` (default `http://127.0.0.1:8000`) and, if
  needed, `QR_HAVEN_VOLATILITY_API_TOKEN`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Page says the service token is not configured | The token is missing from `.env.local`, or `npm run dev` was not restarted after adding it. |
| Page says the service is unreachable | The service is not running, or is on another port than the terminal's URL. |
| Requests behind a corporate proxy never reach `127.0.0.1` | Loopback is always bypassed. Add other internal hosts to `NO_PROXY`. |
| `/health` reports `unready`, `INCOMPATIBLE` or `UNCONFIGURED` | The engine or wheel does not match its pin, or the model binding is not set. See the service README. |
| `401` from a service | The terminal's token differs from the one the service was started with. |
