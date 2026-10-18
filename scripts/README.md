# scripts/dev-all.sh

Starts the terminal and every runnable model service for local development, then stops them all
on Ctrl-C.

```bash
npm run dev:all              # or: scripts/dev-all.sh
scripts/dev-all.sh --no-agent   # skip the agent worker
scripts/dev-all.sh --no-coll    # skip the collateral optimizer
scripts/dev-all.sh --no-news    # skip news_nlp
```

## What it starts

| Name | Port | What it is |
|---|---|---|
| `terminal` | 3000 | Vite dev server (`npm run dev`) |
| `ibal` | 8013 | `inventory_optimizer_api` on the pinned InventoryBallast engine |
| `mmkt` | 8014 | `money_market_api` |
| `coll` | 8017 | `collateral_optimizer_api` on the reviewed collateral wheel |
| `news-nlp` | 8088 | `news_nlp` sentiment/NER/clustering; the script sets `NEWS_NLP_URL` for the terminal |
| `agent-worker` | none | Polls the ECOIQ agent queue |

SXU (8015) and the liquidity API (8016) have no runnable service yet, so they are not started.
A port that is already in use is left alone and reported; the script will not stop that process.

## Requirements

- `python3.12` and `npm` on your PATH.
- A local InventoryBallast **git checkout** that contains the pinned commits. Default location is
  `../../models/InventoryBallast`; override with `INVENTORY_BALLAST_REPO=/path/to/it`.
- `.env.local` with the service tokens (see [docs/services.md](../docs/services.md)):
  `INVENTORY_OPTIMIZER_API_TOKEN`, `MONEY_MARKET_API_TOKEN`, `COLLATERAL_OPTIMIZER_API_TOKEN`,
  `COLLATERAL_OPTIMIZER_API_URL`, `AGENT_QUEUE_DB_URL`, `AGENT_WORKER_TOKEN`. The script exits with a message naming any that
  are missing.
- `MACRO_DB_URL` in `.env.local` (the Postgres gold DB, default
  `postgresql://fred:fred@localhost:55432/macro_medallion`). Without it the terminal reads no
  market data; the script prints a warning but still starts.

## First run versus later runs

The first run builds what the services need under `.data/` (gitignored); later runs reuse it.

- Virtualenvs: `services/<service>/.venv` (IBAL, MMKT, agent worker) and
  `.data/coll-<commit>/venv` (COLL).
- `.data/ibal-engine-<commit>/`: `git archive` of the engine commit in
  `services/inventory_optimizer_api/capability-manifest.json`. Your checkout is never modified.
- `.data/coll-<commit>/`: the collateral wheel and attestation, built by
  `scripts/build-collateral-wheel.py` from the commit in `binding-manifest.json`.

Re-pinning a manifest makes the script build the new commit automatically on the next run.

## Output

- Logs: `.data/logs/<name>.log`.
- After starting, the script waits until IBAL, MMKT and COLL report `"ready":true` and the terminal
  answers, then prints the terminal URL. A service that is not ready after 20 seconds is reported
  as not healthy; check its log.
- The agent worker starts after the terminal is healthy, because the terminal creates the queue
  tables on first use. The worker cannot run jobs until an LLM profile is set in `.env.local`
  (see the spec009 block in `.env.example`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `InventoryBallast checkout not found` | Set `INVENTORY_BALLAST_REPO`. |
| `commit <sha> not in <repo>` | Your checkout has not fetched the pinned commit: `git fetch` in it. |
| `ibal` reports `incompatible_engine` | The engine export does not match the manifest. Delete `.data/ibal-engine-*` and rerun. |
| A service says port in use | An earlier run or a manual process holds it. Stop that process, then rerun. |
| Stale or corrupt `.data/coll-*` | Delete that folder and rerun; it is rebuilt. |
