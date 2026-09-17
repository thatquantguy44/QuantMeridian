# IBAL Inventory Optimizer API

This companion service is the only QuantMeridian boundary allowed to construct, validate, solve,
or export InventoryBallast data. It pins InventoryBallast commit
`74737e53bf9821089c6aa2aeca5dffc4e67c81b7` and fails readiness if the installed package identity
or HiGHS backend does not match the checked capability manifest.

## Local run

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e ".[dev]"
INVENTORY_OPTIMIZER_API_TOKEN=local-only-change-me \
  .venv/bin/uvicorn inventory_optimizer_api.app:app --host 127.0.0.1 --port 8013
```

Port `8013` matches `src/lib/server/inventoryOptimizerProxy.ts`'s default
`INVENTORY_OPTIMIZER_API_URL` -- change both together if you use a different port.
`GET /health` is public and contains readiness metadata only. Every `/v1/*` endpoint requires a
server-held bearer token and `X-Correlation-ID`; run creation also requires `Idempotency-Key`.
Uploaded rows, normalized requests, and result values are held only for the request lifetime and
are never logged or persisted.

To wire this into Market Terminal's own dev server: set the same
`INVENTORY_OPTIMIZER_API_TOKEN` value in the repo root's `.env` (see `.env.example`), then
(re)start `npm run dev` -- Vite only reads `.env` at startup, so an already-running dev server
needs a restart to pick up a newly added token.
