# Spec011 build handoff: Money Market Optimizer (MMKT)

**Updated:** 2026-10-18

**Branch:** `claude/synthetic-snu-poc-27n9hu`, open as
[PR #166](https://github.com/thatquantguy44/QuantMeridian/pull/166) into `main`, which it merges
into cleanly. The same PR carries the spec012 SU-SIM showcase; see `docs/specs/spec012/HANDOFF.md`.

**State:** the terminal module `/money-market` drives the existing `services/money_market_api`
continuous LP end to end, on explicitly selected SIM rate sets. Results are verified by the
service before they are shown. They are **not execution-ready** and not recommendations.

**Spec status:** `SPEC.md` is still a draft and not approved. The owner authorized the
integration, LP and module slices as work in progress (see `PLAN.md`, the 2026-10-18 note).
Owner questions 1–3 in `SPEC.md` are still open and must not be encoded.

## Start here

1. Read `SPEC.md` (requirements MM-001–010, AC-001–008, open questions), then `PLAN.md` and
   `TASKS.md`.
2. Read `services/money_market_api/README.md` for the model conventions. Every run also returns
   them as `assumptions`.
3. Run it locally (below) and click through the five scenario cards before changing anything.

## Run it locally

```bash
pip install ./services/optimization_core -e ./services/money_market_api
MONEY_MARKET_API_TOKEN=local-dev-token MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1 \
  uvicorn money_market_api.app:app --app-dir services/money_market_api/src --port 8014
# .env.local (then restart `npm run dev`)
MONEY_MARKET_API_TOKEN=local-dev-token
```

Open `/money-market`. The **Model service** panel checks off each setup step and says which one
is missing.

**Gotchas we hit:**
- **Port 8014 already in use.** A stale `uvicorn` from an earlier start keeps answering on 8014,
  and the new one silently fails to bind. Kill the old process first.
- **Tests import old code.** Install the service with `-e` (editable). Otherwise `pytest` and
  `uvicorn` import a stale copy from site-packages.
- **Running behind an outbound proxy.** Server-side `fetch` now honours `NO_PROXY` and always
  bypasses loopback (`src/lib/server/fetchProxy.ts`). Before that fix, the terminal could not
  reach `127.0.0.1:8014` when `HTTPS_PROXY` was set.

## What exists

**Service (`services/money_market_api`, port 8014; no database or market-data access):**
- `contracts.py`: strict v1.0.0 request/result contracts.
- `optimizer.py`: a multi-period cash-continuity LP. It covers liquidity floors, WAM/WAL proxies,
  exposure limits (amount and fraction), rating floors and the RRP cap, solved with HiGHS through
  `optimization_core`. The shared verifier checks bounds, rows and the objective.
- `scenarios.py`: selects the p10/p50/p90 forecast case and rebases opening cash.
- `app.py`: bearer auth, `/health`, `/v1/capabilities` and `/v1/runs`. The model is off unless
  `MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1` is set.
- `tests/test_runs.py`: 4 tests: a hand-computable floor-and-return case, the null-maximum
  regression, the capabilities-from-source regression, and the rating-floor exclusion. CI job
  `mmkt-service`.

**Terminal routes:**

| Route | Purpose |
|---|---|
| `GET /api/econ/mmkt-service` | Readiness: health, binding and token state. Never reveals the token. |
| `GET /api/econ/mmkt-rate-snapshot?source=sim&sim_set_id=…` (or `source=gold`, or `sets=1`) | Returns the hashed snapshot with every row's status and pricing eligibility, or lists the SIM sets. |
| `POST /api/econ/mmkt-runs` | Attaches the server-read snapshot and hash, gates non-OK rates, and proxies to the service. Clients cannot supply a snapshot. |

**SIM rate sets** (`src/lib/server/mmktSimRateSets.ts`):
- Two sets: `SIM-MMKT-2026-10-BASE` and `SIM-MMKT-2026-10-CUT25`.
- Each has one stale row and one unavailable row, to exercise fail-closed pricing.
- Quotes are normalized to an ACT/365 money-market yield by basis (simple ACT/360, discount
  ACT/360, bond-equivalent, 7-day SEC).
- Instrument IDs follow FRED naming. They must be reconciled with EcoMedallion's instrument map
  when its PR #81 merges (handoff XR-2).

**Client** (`src/data/mmkt.ts`): TypeScript contract types, the illustrative two-entity USD book
(10 business days), five named scenarios, the result analytics (holdings, ladder, floor
headroom) and the CSV export.

**Page** (`src/app/money-market/`):
- `page.tsx` holds the state and layout.
- `components/panels.tsx` holds the setup guide, rate table, candidate and policy editors,
  allocation table, lineage, verification and scenario comparison.
- `components/charts.tsx` holds the balance composition, floor charts, maturity ladder and yield
  bars.

**Registration:** nav code `MMKT` (`src/lib/nav.ts`), the `App.tsx` route, and
`settings/modules.config.json`. `nav.test.ts` and `test/smoke.spec.ts` include the route.

**Scenario results on the base book** (verified on the real service, 2026-10-18):

| Scenario | Modeled net return | Avg invested | Notes |
|---|---|---|---|
| Base | $2,732.8k | $2,380mm | Floors binding on most days |
| Rate cut (CUT25) | $2,590.8k | $2,398mm | CP enters as overnight rates fall |
| Prime fund fee & gate | $2,711.1k | $2,380mm | Prime MMF drops out; government MMF picks up |
| Cash forecast miss (p10) | $2,034.9k | $1,739mm | Less held past the horizon; more overnight repo |
| Counterparty downgrade | $2,703.8k | $2,280mm | Repo and ACME CP excluded; RRP and government MMF pick up |

## What does not exist yet

- **Execution blotter and cutoff timeline.** These need the MIP rules (MM-006): minimum tickets,
  lot sizes, ticket counts and cutoffs. Until then the UI labels output as an LP allocation, not
  a blotter.
- **Baseline comparison.** The baseline definition is owner question 1, so do not invent one.
- **Shadow prices.** The service does not return duals. HiGHS exposes row marginals through
  SciPy, so add them to the contract with the convention disclosed (MM-006, AC-006).
- **Yield/liquidity frontier.** This would be a run series over a liquidity parameter, each run
  verified (AC-008).
- **OPT run history** (MM-008). Results and hashes live only in the browser session today.
- **Gold rates.** `gold.mmkt_rate_snapshot` is not wired upstream (XR-1 to XR-3). The Gold option
  fails closed with a clear message.
- **Contract parity and idempotency.** There are no generated TS/Python contract parity checks
  (MM-002), and the idempotency key is logged but not enforced (MM-009).
- **Multi-currency.** The service solves each currency independently. The demo book is USD only
  (owner question 2).

## Verification evidence (2026-10-18, branch head)

- **Terminal unit tests:** `mmkt` 11, `mmktSimRateSets` 8, `mmkt-runs` route 4, `fetchProxy` 2.
  All pass.
- **Full `npm test`:** 626 passed, 1 failed. The failure is the badge-coverage test, which also
  fails on `main` (MMFO and SXU pages). The MMKT page passes it.
- **Service:** `pytest` in `services/money_market_api` passed 4.
- **`npm run typecheck` and `npm run build:client`:** passed.
- **Playwright smoke** (`test/smoke.spec.ts -g MMKT`): passed.
- **Manual end to end:** all five scenarios ran against a local service and passed the service
  verifier, with no JavaScript errors in the browser. No horizontal overflow at 390px.

## Next steps (in order)

1. Merge PR #166 after review, and confirm the 2026-10-18 owner-authorization note in `PLAN.md`.
2. Owner decisions: questions 1–3 in `SPEC.md`, then approve the spec, plan, tasks and white
   paper (MM-001).
3. **MM-006 MIP slice.** Add ticket, lot, count and cutoff rules with formulation disclosure,
   and verify integrality. Only after this can the UI present an execution blotter and cutoff
   timeline (MM-007).
4. **Duals.** Return row marginals from the service with the sign and units disclosed, then
   label shadow prices in the UI (MM-006, MM-007).
5. **OPT run history (MM-008).** Persist run envelopes (request hash, snapshot hash, SIM set,
   forecast case) and show them in `/optimization`.
6. **Gold path.** When EcoMedallion XR-1 to XR-3 land, reconcile the instrument IDs and verify
   the Gold option end to end. The route already supports it.
7. **Contract parity and hardening.** Generate TS types from the Pydantic contracts or check
   parity (MM-002), enforce idempotency durably, and add telemetry (MM-009).
8. **Model card and as-built white paper (MM-010).**
