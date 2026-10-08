# Plan: Warehouse Explorer

- **Spec:** spec010-warehouse-explorer (`SPEC.md`)
- **Status:** Draft — pending owner review
- **Author:** Joshua Lutkemuller, CFA
- **Last updated:** 2026-10-07

> HOW. This document is the implementation handoff for the read-only `WHSE` module. `TASKS.md`
> is the progress ledger and must be updated as work is completed.

## Approach

Build a bounded warehouse-specific server adapter on top of QuantMeridian's configured database,
expose typed read-only endpoints under `/api/warehouse/*`, and add a five-view React module at
`/warehouse`. Use the source-aware coverage view as the inventory, enrich it with optional metadata,
and query observation data only after a complete `(source, series_id)` selection. Use the Silver
observation table for current and point-in-time history because it preserves source identity and
has useful series indexes. Use Gold products for catalog and FRED revision summaries. Use the audit
schema for operational views.

```text
Browser: /warehouse
  ├─ Overview ─────── GET /api/warehouse/summary
  ├─ Catalog ──────── GET /api/warehouse/catalog
  ├─ Series
  │    ├─ search ──── GET /api/warehouse/series
  │    └─ history ─── GET /api/warehouse/observations
  ├─ Vintages
  │    ├─ as-of ───── GET /api/warehouse/vintages
  │    └─ revisions ─ GET /api/warehouse/revisions
  └─ Operations
       ├─ runs ────── GET /api/warehouse/runs
       └─ DQ ──────── GET /api/warehouse/dq
                              │
                              ▼
                 warehouseStore.ts (fixed queries,
                 validation, decoding, limits, cache)
                              │
                    goldStore.raw / health
                              │
               SQLite snapshot or PostgreSQL warehouse
```

Seven invariants apply to every slice:

1. All warehouse access is read-only.
2. Every series is addressed by both `source` and `seriesId`.
3. User input can bind values but can never choose SQL syntax or physical objects.
4. Every large-table query requires a series key, a bound, and a hard row limit.
5. Missing or stale data remains visible as such; no simulation or fixture is substituted.
6. API contracts are backend-neutral and use camelCase; adapters own physical naming and decoding.
7. A disabled WHSE module does not change existing module behavior.

## Baseline

### QuantMeridian

- React 18, Vite 5, React Router 6, and Tailwind.
- API route modules are discovered from `src/app/api/**/route.ts` by `src/server/registry.ts`.
- `src/lib/server/goldStore.ts` detects SQLite, PostgreSQL, or Databricks from environment and
  exposes `latest`, `history`, `asOf`, `raw`, and `health`.
- Physical Gold naming is `gold_<object>` on SQLite and `gold.<object>` on PostgreSQL.
- `src/lib/useGoldView.ts` is hard-coded to `/api/econ/*`; WHSE needs its own query-aware hook.
- Navigation lives in `src/lib/nav.ts`, application routing in `src/App.tsx`, and module switches in
  `settings/modules.config.json`.
- `src/app/api/dataops/runs/route.ts` has a schema mismatch against the live audit tables and must
  be migrated to the shared audit adapter built here.
- The current local environment uses the pipeline's SQLite snapshot. Production can use PostgreSQL
  by changing `MACRO_DB_URL`; no second database setting is introduced.

### Inspected warehouse snapshot

The live PostgreSQL schema and local SQLite snapshot were inspected read-only on 2026-10-07.

| Logical object | PostgreSQL | SQLite | Relevant scale/notes |
| --- | --- | --- | --- |
| Series coverage | `gold.v_source_coverage` | `gold_v_source_coverage` | 5,670 source-aware rows |
| Gold catalog | `gold.powerbi_catalog` | `gold_powerbi_catalog` | 54 objects, 19 module groups |
| Curated dimension | `gold.dim_series` | `gold_dim_series` | 290 curated rows at inspection |
| Supplemental metadata | `meta.fred_series` | `meta_fred_series` | FRED-oriented; no source column |
| Observations | `silver.fred_observation` | `silver_fred_observation` | 33,957,274 rows |
| Revision summary | `gold.fred_revision_stats` | `gold_fred_revision_stats` | 20,464,281 rows; FRED-only |
| Runs | `audit.etl_run` | `audit_etl_run` | Live contract uses `ended_at` |
| Series runs | `audit.etl_series_run` | `audit_etl_series_run` | Bronze/Silver write counts |
| DQ results | `audit.data_quality_result` | `audit_data_quality_result` | No `checked_at` column |

Existing Silver indexes include `(series_id, observation_date)`, `(series_id, realtime_start
DESC)`, `(series_id, ingested_at)`, and `ingested_at`. The inspected Gold PIT and revision tables
did not expose indexes. Version one therefore does not use `gold.fred_point_in_time` for interactive
PIT queries.

## Architecture & Ownership

### Server boundary

Create `src/lib/server/warehouse/` as the only place allowed to know WHSE physical object names,
row schemas, SQL templates, sorting rules, pagination, and cross-backend differences.

Responsibilities:

- `backend.ts`: backend detection, logical-to-physical object map, placeholder helper, supported
  backend gate, and redacted target description.
- `contracts.ts`: API/domain types, error codes, pagination types, and decoders.
- `validation.ts`: query parameter parsing, ISO date validation, enum allowlists, length and limit
  enforcement, and opaque cursor signing/validation.
- `catalog.ts`: Gold catalog queries and reviewed object/module deep-link mapping.
- `series.ts`: series inventory/search, metadata enrichment, current history, PIT, and revisions.
- `audit.ts`: run, series-run, and DQ queries using the live schema.
- `summary.ts`: small aggregations over coverage and audit queries.
- `cache.ts`: optional short-lived server cache keyed by normalized query parameters.
- `index.ts`: narrow exported service used by API routes.

React code receives typed route responses and does not construct SQL, infer backend naming, or
reconcile metadata sources.

### Data access decision

Continue to use `goldStore().raw()` and `goldStore().health()` so connection configuration and
driver loading remain centralized. `warehouse/backend.ts` maps a fixed logical object enum to
physical names:

```ts
type WarehouseObject =
  | "coverage"
  | "catalog"
  | "dimSeries"
  | "fredMetadata"
  | "observations"
  | "revisionStats"
  | "etlRuns"
  | "etlSeriesRuns"
  | "dqResults";
```

The mapping is internal and exhaustive. No API parameter can become a `WarehouseObject`.

Supported backends:

| Backend | Version-one behavior |
| --- | --- |
| SQLite | Supported for local development, CI fixtures, and snapshot inspection |
| PostgreSQL | Supported for live use after security/read-only gates pass |
| Databricks | `BACKEND_UNSUPPORTED`; no inferred `audit`, `meta`, or `silver` naming |

### Read-only production gate

Add the following configuration contract:

```text
WAREHOUSE_EXPLORER_PRODUCTION_ENABLED=false
WAREHOUSE_EXPLORER_READ_ONLY_ACK=false
WAREHOUSE_EXPLORER_NETWORK_RESTRICTED_ACK=false
WAREHOUSE_EXPLORER_QUERY_TIMEOUT_MS=5000
```

- Local development with SQLite does not require the acknowledgements.
- In production, routes fail with `PRODUCTION_GATE_CLOSED` unless all three flags are true and the
  backend is PostgreSQL.
- Deployment documentation requires a dedicated role with `CONNECT`, schema `USAGE`, and `SELECT`
  only on approved objects; no ownership, create, temporary, or write grants.
- The database or role supplies the statement timeout. The route-level setting is clamped to
  1,000–15,000 ms and included in the documented role/session setup; it is never interpolated from
  a request.
- Network access must be restricted to an approved interface or private connection. The application
  does not attempt to reconfigure the database host.

## Target File Layout

```text
docs/specs/spec010/
  SPEC.md
  PLAN.md
  TASKS.md

src/lib/server/warehouse/
  backend.ts
  cache.ts
  catalog.ts
  contracts.ts
  audit.ts
  series.ts
  summary.ts
  validation.ts
  index.ts
  *.test.ts

src/app/api/warehouse/
  summary/route.ts
  catalog/route.ts
  series/route.ts
  observations/route.ts
  vintages/route.ts
  revisions/route.ts
  runs/route.ts
  dq/route.ts

src/features/warehouse/
  api.ts
  types.ts
  useWarehouseQuery.ts
  WarehouseShell.tsx
  OverviewView.tsx
  CatalogView.tsx
  SeriesView.tsx
  VintagesView.tsx
  OperationsView.tsx
  components/
    BackendStatus.tsx
    FreshnessNotice.tsx
    FilterBar.tsx
    PagedTable.tsx
    SeriesIdentity.tsx
    SeriesHistoryChart.tsx
    StatusExplanation.tsx
  *.test.tsx

src/app/warehouse/page.tsx
test/warehouse.spec.ts
scripts/verify-warehouse.sh
docs/deployment/DEPLOY.md                # WHSE gate and read-only role
docs/data/PLATFORM_DATA_CONNECTIVITY.md  # approved objects and backend behavior
```

The exact component split may be simplified during implementation, but SQL and physical naming
must remain outside UI and route files.

## API Contracts

### Common envelope

Success:

```ts
interface WarehouseSuccess<T> {
  ok: true;
  source: "DB";
  backend: "sqlite" | "postgres";
  observedAt: string;
  freshness?: {
    newestIngestionAt: string | null;
    newestObservationDate: string | null;
    ageDays: number | null;
  };
  data: T;
  page?: {
    limit: number;
    returned: number;
    nextCursor: string | null;
  };
  warnings: Array<{ code: string; message: string; count?: number }>;
}
```

Failure:

```ts
interface WarehouseFailure {
  ok: false;
  source: "ERR" | "UNAVAILABLE";
  code:
    | "INVALID_REQUEST"
    | "BACKEND_UNSUPPORTED"
    | "PRODUCTION_GATE_CLOSED"
    | "DATABASE_UNAVAILABLE"
    | "QUERY_TIMEOUT"
    | "SERIES_NOT_FOUND"
    | "REVISION_SOURCE_UNSUPPORTED"
    | "CURSOR_INVALID";
  message: string;
  retryable: boolean;
}
```

Routes return status 400 for invalid input, 404 for an unknown selected series, 409 for an
unsupported semantic request, 503 for a closed production gate or unavailable database, and 504
for a timeout. Error messages are stable and sanitized.

### `GET /api/warehouse/summary`

No user-selectable object. Returns:

```ts
interface WarehouseSummary {
  connection: { ok: boolean; backend: "sqlite" | "postgres"; target: string; latencyMs: number };
  inventory: { sources: number; series: number; goldObjects: number; moduleGroups: number };
  coverageBySource: Array<{
    source: string;
    seriesCount: number;
    observationCount: number;
    latestObservationDate: string | null;
    staleSeriesCount: number;
  }>;
  latestRun: EtlRun | null;
  dq: { errorFailures: number; warningFailures: number; latestRunId: string | null };
}
```

The route computes source summaries from `gold.v_source_coverage`; it does not trust client-side
aggregation. `target` comes from the existing redacted target description and never contains user,
password, query string, or filesystem credential material.

### `GET /api/warehouse/catalog`

Parameters:

```text
q?: string (0..100 characters)
module?: reviewed module code
objectType?: allowlisted catalog value
sort?: objectName | module | objectType | grain
direction?: asc | desc
limit?: 1..200 (default 50)
cursor?: opaque cursor
```

Rows mirror the six live `gold.powerbi_catalog` fields and add `moduleHref: string | null` from a
static mapping. The query uses a deterministic tie-break on `object_name`.

### `GET /api/warehouse/series`

Parameters:

```text
q?: string (0..100 characters)
source?: allowlisted value discovered from coverage
category?: exact value
frequency?: exact value
stale?: true | false
sort?: source | seriesId | latestObservationDate | observationCount | daysSinceLast
direction?: asc | desc
limit?: 1..200 (default 50)
cursor?: opaque cursor
```

The base relation is coverage. Enrichment rules:

```text
title = dim_series.title
     ?? (source == "fred" ? meta.fred_series.title : null)
     ?? null

units = dim_series.units
     ?? (source == "fred" ? meta.fred_series.units : null)
     ?? null
```

`metadataCompleteness` is `curated`, `supplemental`, or `identity_only`. A missing metadata join
does not remove a coverage row.

### `GET /api/warehouse/observations`

Parameters:

```text
source: required, 1..40 safe identifier characters
seriesId: required, 1..200 characters
from?: YYYY-MM-DD
to?: YYYY-MM-DD
limit?: 1..5000 (default 1000)
cursor?: opaque observation-date cursor
```

The response returns the latest available row for each observation date. Portable window SQL is
preferred over separate PostgreSQL and SQLite semantics:

```sql
WITH ranked AS (
  SELECT source, series_id, observation_date, realtime_start, realtime_end,
         value, is_missing, revision_number, ingested_at,
         ROW_NUMBER() OVER (
           PARTITION BY observation_date
           ORDER BY
             CASE WHEN COALESCE(realtime_start, '') = '' THEN 0 ELSE 1 END DESC,
             realtime_start DESC,
             ingested_at DESC,
             revision_number DESC
         ) AS rn
  FROM <observations>
  WHERE source = <bind> AND series_id = <bind>
    AND optional_date_bounds
)
SELECT ... FROM ranked
WHERE rn = 1 AND cursor_predicate
ORDER BY observation_date DESC
LIMIT <clamped-limit-plus-one>;
```

The server removes the extra row and emits the next cursor. The UI reverses the current page for
chronological chart rendering while the table preserves newest-first ordering.

### `GET /api/warehouse/vintages`

Parameters are the history parameters plus required `asOf=YYYY-MM-DD`. The rank input adds:

```sql
AND realtime_start IS NOT NULL
AND realtime_start <> ''
AND realtime_start <= <as-of-bind>
```

This is the semantic requirement: latest eligible vintage at or before `asOf`, not equality with
`asOf`. The route separately counts selected-series rows with empty realtime dates in the requested
observation range and emits `INCOMPLETE_VINTAGE_METADATA` when the count is nonzero.

### `GET /api/warehouse/revisions`

Two modes are explicit; neither scans all revisions:

```text
mode=summary
  source=fred&seriesId=...&from?&to?&limit?&cursor?
  -> bounded rows from gold.fred_revision_stats

mode=observation
  source=fred&seriesId=...&observationDate=YYYY-MM-DD
  -> all vintages for exactly one observation date, ordered by realtime_start
```

Any non-FRED source returns `REVISION_SOURCE_UNSUPPORTED`. Summary rows contain revision count,
first/latest value and vintage date, absolute delta, and percentage. Observation-mode rows come
from Silver so their source is explicit.

### `GET /api/warehouse/runs`

Parameters:

```text
runId?: exact ID
status?: allowlisted stored status
limit?: 1..200 (default 50)
cursor?: startedAt + runId cursor
includeSeries?: false by default
seriesStatus?: used only when includeSeries=true and runId is supplied
```

`EtlRun` maps the live columns without renaming their meaning:

```ts
interface EtlRun {
  runId: string;
  environment: string | null;
  triggeredBy: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  seriesTotal: number | null;
  seriesSucceeded: number | null;
  seriesFailed: number | null;
  seriesSkippedNotDue: number | null;
  errorMessage: string | null; // sanitized and length-limited
}
```

`manifest_path` is not returned to the browser. Series-run rows expose observation/write counts,
DQ state, and a sanitized error.

### `GET /api/warehouse/dq`

Parameters:

```text
runId?: exact ID (defaults to latest run with DQ rows)
seriesId?: exact ID
severity?: error | warning | other discovered allowlist
passed?: true | false
checkName?: exact discovered check
limit?: 1..200 (default 100)
cursor?: deterministic composite cursor
```

Ordering is `severity`, `passed`, `check_name`, `series_id`, with a deterministic tie-break. The
live table has no event timestamp, so the UI labels rows with the selected run's start/end time and
does not fabricate a check timestamp.

## Query Safety & Pagination

### Validation

- `source`: trim, lowercase for matching, maximum 40 characters, restricted to letters, digits,
  `_`, `-`, and `.`; the stored value remains authoritative.
- `seriesId`: trim, maximum 200 characters, reject controls and invalid UTF-8; bind as a value.
- Text search: maximum 100 characters; escape `%`, `_`, and the chosen SQL LIKE escape character.
- Dates: strict calendar-valid `YYYY-MM-DD`; `from <= to`; no implicit locale parsing.
- Limits: parse integer and clamp or reject consistently. Version one rejects out-of-range values.
- Sort/direction: enums mapped to hard-coded SQL fragments.

### Cursors

Cursors are URL-safe base64 JSON plus an HMAC using an application secret already suitable for
server tokens, or a new `WAREHOUSE_CURSOR_SECRET`. The decoded payload includes endpoint, backend,
normalized filters hash, sort fields, and last values. A cursor from another endpoint, backend, or
filter set returns `CURSOR_INVALID`. No raw SQL or credentials are encoded.

If introducing a cursor secret is operationally undesirable for local use, unsigned cursors may be
accepted only in non-production. Production cursors are signed.

### Limits and timeouts

| Route family | Default | Maximum |
| --- | ---: | ---: |
| Catalog/search/runs/DQ | 50 or 100 | 200 |
| Current/PIT observations | 1,000 | 5,000 |
| One-observation revision vintages | all for exact date | 500 safety ceiling |

All queries request `limit + 1`, never a separate unbounded count. Exact global counts are computed
only on the small catalogs/coverage or by explicit summary queries. PostgreSQL production roles
must have a statement timeout. SQLite relies on strict predicates/limits and measured indexes.

## UI Plan

### Shell and URL state

`src/app/warehouse/page.tsx` mounts `WarehouseShell`. The active view and durable selection use
search parameters:

```text
/warehouse?view=series&source=fred&series=DGS10&from=2020-01-01&to=2026-10-07
/warehouse?view=vintages&source=fred&series=GDP&asOf=2020-07-30
/warehouse?view=operations&run=<id>&severity=error&passed=false
```

Unknown or invalid parameters are removed with `replaceState` and surfaced as a non-destructive
notice. Secrets, connection details, and raw error text never enter the URL.

### Overview

- Compact backend/connection status with redacted target.
- Persistent freshness notice showing newest ingestion and observation dates.
- Source coverage table: series, observations, latest date, stale count/share.
- Latest-run block: status and succeeded/failed/skipped counts.
- DQ exception summary linked to the filtered Operations view.
- No invented health score. Each stored fact is shown directly.

### Catalog

- Search and module/object-type filters.
- Paginated table of catalog objects and their documented grains/visuals.
- “Open module” only for a reviewed mapping.
- Object names are labels, not executable inputs.

### Series

- Search/filter column and source-aware results.
- Selection header always displays source and series ID together.
- Metadata completeness and stale status are text-labeled.
- Date controls, single-series history chart, and newest-first observation table.
- Missing values render as gaps and `Missing`, never zero.
- Pagination extends the table; the chart renders only the currently fetched bounded range and says
  so.

### Vintages

- Reuses the selected `SeriesKey`.
- As-of date control and explicit “known on or before” language.
- PIT history chart/table with incomplete-vintage warning where applicable.
- FRED-only revision summary and exact-observation vintage drill-down.
- Non-FRED selection explains why revision products are unavailable.

### Operations

- Recent-run table and one-run series/DQ detail.
- Filters for stored run status, failure state, DQ severity/check, and series ID.
- Unfinished runs show missing end time as “Not recorded”; they are not reclassified.
- Stored errors are sanitized and shown in an expandable cell with a safe length cap.

### Data fetching

Create `useWarehouseQuery<T>` around the existing fetch cache primitives. Its cache key is the full
normalized route URL. It returns:

```ts
{ data, state: "loading" | "ready" | "empty" | "error" | "unavailable", error, refresh }
```

Changing one view does not clear confirmed data in another. Abort superseded requests. Do not send
requests for history, PIT, or revisions until the required series key and dates validate.

## Audit Adapter Repair

Build `warehouse/audit.ts` first and migrate `/api/dataops/runs` to its row types and query helpers.
The repaired DATAOPS adapter must:

- use `ended_at`, not `finished_at`;
- use `series_total`, `series_succeeded`, and `series_failed`, not `series_count` or a synthetic
  run-level `rows_written`;
- use `error_message`, not `error_msg`;
- use per-series `observations_extracted`, `rows_written_bronze`, and `rows_merged_silver`;
- map DQ `passed`, `severity`, `message`, and `metric_value`;
- not order DQ rows by nonexistent `checked_at`;
- preserve the existing intelligence-feed and legacy-manifest behavior outside the Gold adapter;
  and
- carry an explicit provenance field so callers can distinguish database, manifest, and combined
  results.

This repair is an enabling task, but DATAOPS visual redesign is not part of spec010.

## Backend Parity Strategy

### Physical names

One exhaustive map defines names per supported backend. Route and feature files never hand-roll
`MACRO_DB_URL.startsWith(...)` checks.

### SQL dialect

- Use ANSI-compatible CTEs, window functions, `CASE`, and explicit aliases where SQLite and
  PostgreSQL agree.
- Parameter placeholders come from one helper (`?` on SQLite, `$n` on PostgreSQL).
- Avoid backend-specific case-insensitive operators; normalize with `LOWER` and escaped `LIKE`.
- Decode SQLite integer booleans and PostgreSQL numeric values explicitly.
- Treat all stored dates as strings and validate before returning them as normalized dates.

### Fixtures

Create one small logical dataset loaded into temporary SQLite and PostgreSQL databases with:

- two sources sharing one series ID;
- one series missing metadata;
- multiple vintages before/on/after an as-of date;
- one empty `realtime_start` row;
- null and explicit-missing observations;
- a partial run, unfinished run, failed series, and DQ failures;
- catalog rows with and without reviewed module links.

The same endpoint expectation suite runs against both.

## Performance Plan

### Required measurements

Run representative queries against the 34GB local snapshot and live PostgreSQL:

- source summary;
- catalog first page and filtered page;
- series search by ID and title;
- 10-year daily current history;
- 10-year daily PIT history;
- FRED revision summary for a high-history series;
- recent runs and failed-series drill-down;
- latest-run DQ failures.

Record `EXPLAIN (ANALYZE, BUFFERS)` for PostgreSQL queries that exceed budgets and `EXPLAIN QUERY
PLAN` for SQLite. Do not commit plans containing credentials or sensitive paths.

### Candidate upstream indexes

Only propose these after measurement:

```sql
CREATE INDEX ... ON silver.fred_observation
  (source, series_id, observation_date, realtime_start DESC, ingested_at DESC);

CREATE INDEX ... ON gold.fred_revision_stats
  (series_id, observation_date DESC);

CREATE INDEX ... ON audit.etl_series_run
  (run_id, status, series_id);

CREATE INDEX ... ON audit.data_quality_result
  (run_id, severity, passed, series_id);
```

The pipeline repository owns these migrations. If a required budget fails without them, the
corresponding WHSE task remains `blocked`; QuantMeridian must not create indexes at runtime.

## Security & Privacy

- Production role is SELECT-only on the nine approved logical objects.
- Routes execute fixed queries and normalized values only.
- Apply request and response size limits before database access.
- Sanitize stored error messages by removing URLs with credentials, token-like values, control
  characters, and excessive length.
- Do not return `manifest_path`, connection strings, row hashes, or internal exception stacks.
- Do not log search text, series values, raw SQL, params, or database errors before normalization.
- Do not introduce a browser database client.
- Existing lack of user authentication means WHSE exposes only warehouse information approved for
  the same trust boundary as the terminal. If that boundary changes, authentication is a separate
  prerequisite.

## Validation Strategy

### Unit tests

- Query parameter validation, LIKE escaping, ISO dates, limit enforcement, and cursors.
- Physical name and placeholder resolution for SQLite/PostgreSQL; Databricks fail-closed behavior.
- Row decoders, numeric/boolean coercion, missing values, metadata completeness, and sanitization.
- Current-vintage ranking and PIT ranking with ties and empty realtime dates.
- Deep-link allowlist and module-feature behavior.
- Audit live-schema mappings.

### Route and integration tests

- Shared endpoint suite on SQLite and PostgreSQL fixtures.
- Error status/envelope mapping for invalid input, unavailable DB, timeout, and closed gate.
- Pagination stability across duplicate sort values.
- Query-injection and wildcard-escaping fixtures.
- Existing DATAOPS database, manifest, combined, and empty resolution paths.

### Component tests

- Every view's loading, empty, ready, stale, error, and unavailable states.
- Source-aware labels and metadata-incomplete state.
- Missing observations as gaps.
- PIT language and unsupported non-FRED revision state.
- Run/DQ fields from the live contract.
- Keyboard operation and status text independent of color.

### End-to-end tests

- Enable/disable behavior and routing.
- Search → select series → constrain dates → inspect chart/table.
- Select as-of → verify eligible vintage and warning behavior.
- Open FRED revision drill-down.
- Open partial run → filter failed series → inspect DQ failures.
- Follow reviewed catalog deep link.
- Database unavailable and production-gate-closed flows.
- 360px, 736px, and desktop viewport assertions; no page overflow or console errors.

### Verification command

Add `scripts/verify-warehouse.sh` and `npm run verify:warehouse`. It runs, in order:

1. targeted typecheck and unit/route/component tests;
2. SQLite contract suite;
3. PostgreSQL contract suite when the reviewed test database is configured;
4. Playwright warehouse flow;
5. performance smoke and limit assertions;
6. secret/log scan for affected files;
7. `git diff --check`.

The script writes a gitignored report under `.data/verify-warehouse/report.json` with commit, date,
backend suites run/skipped, pass counts, and benchmark summaries.

## Traceability

| Requirement group | Primary implementation | Primary verification |
| --- | --- | --- |
| REQ-001–003 | Module config, nav, App route, shell/hook | Route/module and state component tests |
| REQ-004–006 | `summary.ts`, `catalog.ts`, summary/catalog routes | SQLite/Postgres contract tests |
| REQ-007–010 | `series.ts`, series/observations routes | Identity, missingness, pagination tests |
| REQ-011–014 | `series.ts`, vintages/revisions routes | Golden PIT and revision fixtures |
| REQ-015–018 | `audit.ts`, runs/dq routes, DATAOPS migration | Live-schema mapping and regression tests |
| REQ-019–024 | validation, backend gate, logging/telemetry | Security, failure, and observability tests |
| NFR-001–011 | All layers | Verification script and test matrix |

Detailed acceptance-to-test status lives in `TASKS.md`.

## Implementation Sequence

1. **Freeze contracts and gates.** Approve the spec, response envelope, identity, backend scope,
   security posture, and module boundary.
2. **Build the backend foundation.** Object mapping, validation, row decoders, cursor, cache, and
   live-schema audit adapter with dual-backend fixtures.
3. **Deliver bounded read APIs.** Summary/catalog, series/current history, PIT/revisions, and
   operations routes.
4. **Build the module shell and views.** Add navigation/routing, URL state, overview/catalog,
   series/vintages, and operations.
5. **Repair shared DATAOPS audit access.** Switch it to the tested adapter without changing
   unrelated resolution behavior.
6. **Harden.** Security tests, accessibility, viewport checks, performance measurement, upstream
   index decisions, documentation, and production gates.
7. **Roll out.** Owner review, local SQLite pilot, read-only PostgreSQL pilot, then enable WHSE.

## Rollout, Observability & Rollback

### Stages

| Stage | Environment | Entry criteria | Exit criteria |
| --- | --- | --- | --- |
| 0 | Documentation | Draft created | Owner approves spec decisions |
| 1 | Test fixtures | Backend foundation implemented | Parity and security tests pass |
| 2 | Local SQLite | WHSE feature flag enabled locally | Core flows and performance pass |
| 3 | Read-only PostgreSQL | Role/network gates attested | Contract, freshness, and load pilot pass |
| 4 | Production default | Owner signs acceptance record | Monitoring stable and no critical defects |

Pipeline freshness is an explicit owner decision at the Stage 3/4 gate. The application can render
stale data safely, but it cannot decide that stale production data is acceptable.

### Telemetry

Emit structured metadata only:

```text
route_family, backend, outcome, latency_ms, returned_rows,
cache=hit|miss, timeout=true|false, error_code
```

Track p50/p95 latency, timeout rate, error rate, response row distribution, backend availability,
and newest-ingestion age. Never log SQL, values, credentials, or raw search terms.

### Rollback

1. Set `WHSE.enabled=false` and close the production gate.
2. Leave read-only server code dormant; no data migration needs reversal.
3. If the shared DATAOPS adapter causes a regression, revert only that route to the last known
   behavior while retaining its tests and open issue; do not restore schema-invalid SQL.
4. Revoke the dedicated database role if compromise or unexpected access is suspected.
5. Record the incident and reset incomplete tasks to `blocked` with evidence in `TASKS.md`.

## Documentation Update Protocol

The three spec010 files are living documents until rollout:

- Update `TASKS.md` on every merged implementation PR: task status, completion date, PR/commit,
  tests, and evidence.
- Update `PLAN.md` when architecture, contracts, file layout, or rollout mechanics change.
- Update `SPEC.md` only when scope, requirements, acceptance criteria, risks, or decisions change.
- Append decisions; do not silently rewrite an approved decision. Superseded decisions record the
  replacement ID.
- A task is `done` only when its definition of done and mapped tests pass. Code completion alone is
  not sufficient.
- Keep blocked tasks visible with owner, blocking condition, and next action.

## Decisions Required Before Implementation

- Approve module name/code/route and the separate boundary from DATAOPS.
- Approve Silver as the interactive history and PIT source in version one.
- Approve SQLite/PostgreSQL-only scope.
- Approve the production enablement flags and read-only/network attestations.
- Decide whether current pipeline freshness is a hard production gate.
- Approve the first catalog-to-module deep-link map.
