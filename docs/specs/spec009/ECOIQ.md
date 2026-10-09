# ECOIQ implementation slice

ECOIQ is the Spec 009 Economics & Macro module for evidence-backed explanations of Treasury-curve and macro-data moves.

## Contract

- `economics.explain`: explain an observed move and separate facts from mechanism hypotheses.
- `economics.transmission`: map first-, second-, and third-order effects.
- `economics.scenario`: state a conditional forward path, triggers, and monitoring signals.

Every response contains observed facts, Gold evidence, a mechanism hypothesis, alternatives, confidence, falsifiers, and disclosures. Observational correlation is never presented as identified causation.

## Data and agent boundary

Numeric evidence comes from `macro_medallion` Gold tables (`treasury_curve`, `treasury_curve_metrics`, and `macro_indicator_dashboard`) through QuantMeridian's governed reader. The browser and Node route do not import QuantSmith or query the database through QuantSmith. The local worker receives the evidence envelope and uses the pinned QuantSmith agent chain described in `services/agent_worker/src/agent_worker/ecoiq.py`.

## Rollout

The module is enabled in attended, read-only mode. It does not place trades, write back to Gold, or publish autonomous briefs. Production worker execution remains subject to the existing Spec 009 queue, profile, verification, and rollout gates.

## Local LLM recommendation

For a Mac with 24 GB of memory, start with `qwen3:14b` in Ollama. Ollama lists the 14B package at about 9.3 GB with a 40K context window, leaving room for macOS, the terminal, Postgres, and the worker. Use `qwen3:8b` if latency is more important than reasoning depth. Keep the deterministic profile as the safe default and select `local-openai` only for attended ECOIQ runs:

```bash
ollama pull qwen3:14b
ollama serve
export LLM_PROFILE_DEFAULT=local-openai
export LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
export LOCAL_LLM_MODEL=qwen3:14b
```

The model receives the governed evidence envelope and question; it does not receive database credentials or direct database access.

Verification is strict by default. For local testing only, `ECOIQ_VERIFICATION_MODE=permissive` allows numeric prose from the LLM while retaining Gold-source and unsupported-causality checks. Do not enable this mode in production.

## Queue API

Set `AGENT_QUEUE_DB_URL` before using the job API. It is intentionally separate from `MACRO_DB_URL`; if it is missing, `POST /api/agent/jobs` returns `AGENT_QUEUE_NOT_CONFIGURED` rather than silently storing jobs in the macro database. The initial endpoints are:

- `GET /api/agent/catalog?module=ECOIQ` — module configuration, offered workflows, profiles, worker status (sets the requester cookie)
- `POST /api/agent/jobs` — create a queued job; requires an `Idempotency-Key` header and echoes `X-Correlation-ID`
- `GET /api/agent/jobs?module=ECOIQ&thread=<uuid>` — the requester's jobs for a thread
- `GET /api/agent/jobs/:id/audit` — lifecycle events and versions (no question text)
- `GET /api/agent/health` — queue depth, oldest queued age, outcomes, worker heartbeats
- `GET /api/agent/jobs/:id` — read a job owned by the requester
- `POST /api/agent/jobs/:id/cancel` — cancel a queued/running job
- `POST /api/agent/jobs/:id/retry` — create a new job (`retry_of`) from a failed or expired one
- `POST /api/agent/jobs/:id/execute` — attended worker execution; resolves the requested LLM profile, verifies the result, and records terminal status

The browser uses the queue path when configured. Without `AGENT_QUEUE_DB_URL`, it falls back to the deterministic ECOIQ route and labels the run accordingly. This keeps local development useful while preventing an unconfigured queue from silently losing jobs.

For the PostgreSQL queue, install the worker extras and point the worker at the same database:

```bash
pip install -e 'services/agent_worker[dev]'
export AGENT_QUEUE_DB_URL=postgresql://fred:fred@localhost:55432/macro_medallion
export QUANTMERIDIAN_API_URL=http://127.0.0.1:3000
export AGENT_WORKER_TOKEN=<same value as the server>
PYTHONPATH=services/agent_worker/src python3 -m agent_worker.worker
```

PostgreSQL claims use a transaction with `FOR UPDATE SKIP LOCKED`, so multiple local workers do not claim the same job. The worker only claims `ECOIQ` rows and records `running`/`failed` transitions; production heartbeat, lease expiry, and worker-token gates remain required before unattended deployment.

## Gate, identity, and pause

Requester IDs are `HMAC(AGENT_SESSION_SECRET, sid)`; in production the gate (`AGENT_WORKFLOWS_PRODUCTION_ENABLED`, `AGENT_WORKFLOWS_TRUSTED_ACCESS_BOUNDARY`, `AGENT_TRUSTED_IDENTITY_HEADER`, `AGENT_SESSION_SECRET`) must pass and identity comes from the boundary header. The worker authenticates to `execute` with `Authorization: Bearer $AGENT_WORKER_TOKEN`. Pause or resume everything without a redeploy with `node scripts/agent-control.mjs pause|resume|status`; `AGENT_WORKFLOWS_DISABLED=1` is the deploy-level switch.

## Queue schema migration

The first run against a database that holds the earlier single-table queue renames `agent_job` and `agent_control` to `*_legacy_v0` and creates the `agent-queue/1` schema; nothing is dropped, and jobs in the old table are not carried over. Set `AGENT_TEST_POSTGRES_URL` to also run the queue-store suite on Postgres (it creates and drops its own schemas).
