# IBAL Vite Dev-Server POST Hang Investigation

**Updated:** 2026-09-17
**Branch:** `feature/ibal-handoff-followthrough`

## Current Finding

The focused IBAL browser path remains verified against the standalone server (`npm start`) rather
than the Vite dev server (`npm run dev`). The local symptom is specific to browser-originated POSTs
through Vite's dev API middleware, while direct `curl` calls and the standalone server path remain
healthy.

The likely risk point is the dev-only API middleware in `vite-plugins/dev-api.ts`: it buffers the
entire incoming request body with `readBody(req)`, then creates a Web `Request` for the shared API
registry. The standalone server uses the same route registry but not Vite's SSR middleware path, so
the difference is dev-server request adaptation rather than the IBAL Python service or the
InventoryBallast engine.

## What Remains Open

- Reproduce the browser hang under `npm run dev` with server-side timestamps around
  `readBody(req)`, `toWebRequest(...)`, `handleApiRequest(...)`, and `sendWebResponse(...)`.
- Compare the browser request headers/body behavior against a direct `curl` POST to
  `/api/inventory-optimizer/datasets/synthetic`.
- Patch `vite-plugins/dev-api.ts` only after the stalled phase is confirmed; do not change the
  shared proxy or Python service based on this symptom alone.

## Current Runbook

Use the standalone server for IBAL Playwright verification:

```bash
npm run build:client
npm run build:server
INVENTORY_OPTIMIZER_API_TOKEN=<same-token-as-service> \
  PORT=3010 HOST=127.0.0.1 npm start

PLAYWRIGHT_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  BASE_URL=http://127.0.0.1:3010 \
  npx playwright test test/ibal.spec.ts --config=playwright.local.config.ts --reporter=line
```

This preserves end-to-end browser-to-solver coverage while the Vite-specific middleware behavior is
still under investigation.
