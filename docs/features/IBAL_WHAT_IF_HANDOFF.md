# IBAL What-If and Browser Verification Handoff

**Updated:** 2026-09-17
**Branch:** `feature/ibal-frontend-workbench`

## Scope Completed

- Fixed the prepared-request hash mismatch that blocked browser-originated base case runs after JSON round trips normalized numeric values.
- Made the run workflow clearer in the IBAL workbench:
  - Dataset intake now shows `NO DATA`, `LOADED`, or `INVALID`.
  - A success banner confirms the loaded dataset source, hash, and row counts.
  - The run readiness state explains why the base run is or is not available.
  - The base solve button is labeled `Base Case Run` once data is ready.
- Added multi-scenario what-if capability in `src/app/inventory-optimizer/page.tsx`.
  - Presets include Base Case, Scarce Supply, Specials Squeeze, Borrower Concentration, Strict Entity Confidence, and More Balance Sheet.
  - The comparison table shows scenario-level value, value delta, fill rate, utilization, binding constraints, net allocation, and status.
  - Selecting a scenario shows scenario-specific detail at the inventory route level, including inventory balance changes and route allocation rows.
- Added focused Playwright browser verification for IBAL in `test/ibal.spec.ts`.
  - Covers load-data gating, synthetic dataset preparation, `Base Case Run`, result rendering, export enablement, what-if runs, scenario comparison, and scenario route detail.
  - Asserts that `REQUEST_HASH_MISMATCH` does not appear in the browser flow.
- Added `playwright.local.config.ts` for testing against an already-running local or standalone server.

## Files Touched

- `services/inventory_optimizer_api/src/inventory_optimizer_api/engine_service.py`
- `services/inventory_optimizer_api/tests/test_service.py`
- `src/app/inventory-optimizer/page.tsx`
- `test/ibal.spec.ts`
- `playwright.local.config.ts`

## Local Verification Flow

Start the pinned Python service:

```bash
cd services/inventory_optimizer_api
INVENTORY_OPTIMIZER_API_TOKEN=<same-token-as-market-terminal-env> \
  .venv/bin/uvicorn inventory_optimizer_api.app:app --host 127.0.0.1 --port 8013
```

From the repo root, build and run the standalone terminal server:

```bash
npm run build:client
npm run build:server
INVENTORY_OPTIMIZER_API_TOKEN=<same-token-as-service> \
  PORT=3010 HOST=127.0.0.1 npm start
```

Run the focused browser test:

```bash
PLAYWRIGHT_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  BASE_URL=http://127.0.0.1:3010 \
  npx playwright test test/ibal.spec.ts --config=playwright.local.config.ts --reporter=line
```

Use the standalone server for this IBAL Playwright flow right now. In this local sandbox, the Vite dev server path can hang browser POSTs to `/api/inventory-optimizer/datasets/synthetic` even when `curl` and the standalone server respond normally.

## Verification Results

- `services/inventory_optimizer_api/.venv/bin/python -m pytest -q services/inventory_optimizer_api/tests` passed: `177 passed`, one upstream deprecation warning.
- `npm run build:client` passed with the existing Vite chunk-size warning.
- `npm run build:server` passed with existing Rollup eval warnings in chart/template code.
- Focused Playwright passed: `1 passed`.
- `npm run typecheck` is still blocked by unrelated pre-existing TypeScript errors outside the IBAL files.

## Suggested Next Work

1. Add user-editable custom shocks for what-if scenarios instead of preset-only scenario generation.
2. Add scenario export, ideally including the selected scenario detail and route-level allocation rows.
3. Investigate the Vite dev-server browser POST hang so the focused Playwright test can run against `npm run dev`, not only standalone `npm start`.
