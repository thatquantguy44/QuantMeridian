# Spec010: Warehouse Explorer

- **ID:** spec010-warehouse-explorer
- **Module code:** `WHSE`
- **Route:** `/warehouse`
- **Status:** Draft — pending owner review
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-07

> WHAT and WHY. Architecture and contracts are in `PLAN.md`; ordered implementation work and
> completion state are in `TASKS.md`.

## Summary

Add a separate, read-only Warehouse Explorer module to QuantMeridian. The module makes the
`macro_medallion` warehouse discoverable and auditable without becoming a SQL console or
duplicating the terminal's existing analytical modules. It lets an analyst answer five questions:

1. What data and Gold analytical products exist?
2. Which sources and series are current, stale, or missing?
3. What observations are available for a selected `(source, series_id)`?
4. What did the warehouse know as of a historical date, and how was a FRED value revised?
5. Did recent pipeline runs and data-quality checks succeed?

The module uses the existing `MACRO_DB_URL` connection and application route layer. PostgreSQL is
the live target and the pipeline's SQLite snapshot is the local-development target. It never
falls back to fixtures or simulated values. An unavailable, stale, partial, or unsupported result
is shown explicitly with its reason.

## Problem & Context

QuantMeridian already has domain modules for macro, curves, inflation, credit, funding, FOMC,
regimes, equities, and model outputs. Those modules answer analytical questions, but they do not
provide a coherent inventory of the underlying warehouse, source coverage, point-in-time history,
or operational health. `DATAOPS` partially covers provider health and lineage, but its current
Gold audit integration does not match the live audit schema and the page also includes legacy and
fixture-oriented behavior.

The warehouse is broad enough to support a dedicated explorer. A read-only inspection on
2026-10-07 found:

- 57 Gold tables and 7 Gold views;
- 54 rows in `gold.powerbi_catalog`, mapped to 19 module groups;
- 5,670 series/source rows in `gold.v_source_coverage`;
- 33,957,274 rows in `silver.fred_observation` and `gold.fred_point_in_time`;
- 20,464,281 rows in `gold.fred_revision_stats`;
- 10 candidate analytical tables with no duplicate or null key findings in the inspected state;
- a latest ingestion date of 2026-09-07, one month behind the inspection date; and
- a latest partial run with 67 failed series, 9 error-level DQ failures, and 453 warning failures.

The application is also ready for the module mechanically: `goldStore.ts` supports PostgreSQL and
SQLite, API files are auto-discovered, modules are feature-flagged, and navigation and React
routing have established extension points.

Important constraints shape this spec:

1. **The warehouse is not currently live-current.** Freshness must be visible; the UI must never
   imply that old observations are current.
2. **Production access is not yet safe.** The inspected Docker database is published on all host
   interfaces using a weak documented superuser setup. Production enablement requires a dedicated
   read-only role and restricted network access.
3. **The catalogs are incomplete.** `meta.fred_series` has no `source` column and covers only part
   of the multi-source inventory. At inspection, 2,810 of 5,670 coverage rows lacked a matching
   metadata row.
4. **Series identity is composite.** Every explorer contract uses `(source, series_id)`, even
   though the current data happened not to contain cross-source bare-ID collisions.
5. **Large history tables require bounded access.** No UI action may issue an unfiltered scan or
   unbounded `SELECT *` over observation, vintage, or revision data.
6. **Dates are stored as text.** Routes validate ISO dates and compare normalized `YYYY-MM-DD`
   strings only. Invalid dates fail closed.
7. **The live audit schema differs from the existing DataOps route.** The live columns include
   `ended_at`, `series_total`, `series_succeeded`, `series_failed`, and `error_message`; DQ results
   use `passed`, `severity`, `message`, and `metric_value` and have no `checked_at` column.

## Goals

- Give analysts a searchable inventory of sources, series, and Gold analytical objects.
- Show source-level and series-level freshness, coverage, observation counts, and stale flags.
- Provide a bounded history view for one source-aware series at a time.
- Provide correct point-in-time semantics: the latest vintage known on or before an as-of date.
- Show FRED revision history and revision statistics without treating revision tables as
  cross-source data.
- Show recent ETL runs, per-series failures, and data-quality exceptions using the live schema.
- Link cataloged Gold objects to existing QuantMeridian modules where a reviewed mapping exists.
- Work against both the local SQLite snapshot and live PostgreSQL with the same response contracts.
- Preserve QuantMeridian's explicit provenance contract: `DB`, `LOADING`, `ERR`, or `UNAVAILABLE`;
  never fixture or simulated fallback.
- Make implementation and rollout auditable through the tracked tasks and acceptance tests in
  `TASKS.md`.

## Non-Goals

- No arbitrary SQL editor, query builder, database shell, or user-provided table/column name.
- No insert, update, delete, DDL, pipeline trigger, retry, repair, or backfill action.
- No replacement for `ECON`, `CURV`, `INFL`, `CRDT`, `FUND`, `FOMC`, `MGC`, or other analytical
  modules.
- No generic database administration, user management, schema migration, or secret management UI.
- No promise that every source has rich title or descriptive metadata.
- No synthetic or snapshot fallback when the configured warehouse is unavailable. SQLite is a
  supported database backend, not a UI fallback.
- No Databricks support in version one. Existing GoldStore support remains untouched; WHSE returns
  an explicit unsupported-backend response until its non-Gold schemas and contracts are reviewed.
- No downloadable bulk warehouse export. A filtered CSV export may be specified later.
- No chart-studio replacement. Version one uses a focused single-series history chart and links to
  existing studios or domain modules.
- No change to the pipeline repository's schemas or indexes from QuantMeridian. Required upstream
  performance or security changes are tracked as dependencies.

## Users & Core Use Cases

### Analyst

- Search for a series by ID, title, category, source, or frequency.
- Confirm the latest observation, stale state, units, and available date range.
- Review observations and distinguish missing values from absent rows.
- Reconstruct the value known as of a selected date.
- Inspect how a FRED observation was revised.
- Open the corresponding analytical module when one exists.

### Data operator

- Review source coverage and freshness.
- Inspect recent ETL runs and failed series.
- Filter DQ exceptions by severity, check, series, and run.
- Distinguish a stopped/orphaned run from a completed or partial run without silently rewriting
  warehouse state.

### Developer

- Confirm which Gold object and grain backs an existing module.
- Validate PostgreSQL/SQLite contract parity.
- Diagnose missing metadata, stale data, and route/schema drift.

## Product Boundary

`WHSE` is a catalog and evidence surface. Existing modules remain the place for interpretation,
comparative analytics, scenarios, and desk decisions. `DATAOPS` remains the cross-provider
operations page; version one may share audit adapters with it, but WHSE owns the warehouse-specific
views described here. It does not merge the two pages.

The module has five top-level views:

| View | Purpose | Primary sources |
| --- | --- | --- |
| Overview | Connection state, freshness, source coverage, run and DQ summary | `gold.v_source_coverage`, `audit.*` |
| Catalog | Gold object inventory and reviewed module links | `gold.powerbi_catalog` |
| Series | Source-aware search, metadata, bounded observations | coverage/meta/dimension catalogs, `silver.fred_observation` |
| Vintages | As-of reconstruction and FRED revision exploration | `silver.fred_observation`, `gold.fred_revision_stats` |
| Operations | Runs, series failures, DQ exceptions | `audit.etl_run`, `audit.etl_series_run`, `audit.data_quality_result` |

## Data Ownership & Semantics

### Sources of truth

- `gold.powerbi_catalog` is the inventory of curated analytical objects.
- `gold.v_source_coverage` is the source-aware inventory for coverage and freshness.
- `meta.fred_series` supplies optional FRED-oriented descriptive metadata.
- `gold.dim_series` supplies optional curated series metadata.
- `silver.fred_observation` is the version-one source for source-aware observations and vintages.
- `gold.fred_revision_stats` supplies precomputed FRED-only revision summaries.
- `audit.etl_run`, `audit.etl_series_run`, and `audit.data_quality_result` supply operational state.

### Series identity

The canonical identifier is:

```text
SeriesKey = { source: string, seriesId: string }
```

Bare `series_id` is never used as a route-level identity. `meta.fred_series` is joined only as
optional metadata and never used to decide that a series exists. `gold.dim_series` is similarly
optional because it contains a curated subset.

### Observation semantics

- `observation_date`, `realtime_start`, `realtime_end`, and `ingested_at` are returned as ISO text.
- `value IS NULL` or `is_missing = 1` is missing data; it is not converted to zero or interpolated.
- Current history selects the latest record per observation date using descending
  `realtime_start`, then descending `ingested_at` as the deterministic tie-break.
- Point-in-time history selects the latest record per observation date whose `realtime_start` is
  non-empty and less than or equal to the requested as-of date.
- Rows with an empty `realtime_start` cannot prove historical availability. They may appear in
  current history, but they are excluded from strict point-in-time results and counted in the
  response warning.
- Revision views are labeled FRED-only unless a later schema introduces source-aware revision
  products.

### Freshness semantics

- The route returns the warehouse's `is_stale` and `days_since_last` values unchanged.
- The response also includes the latest successful or partial ingestion timestamp and the age of
  that run relative to server time.
- The UI displays observed dates and ages; it does not invent a universal freshness threshold.
- Run statuses are rendered as stored. A missing `ended_at` is shown as unfinished, not converted
  automatically to failed.

## Functional Requirements

### Module shell and navigation

- **REQ-001:** Register `WHSE` in module configuration, navigation under `DATAOPERATIONS`, and
  React routing at `/warehouse`.
- **REQ-002:** The module exposes Overview, Catalog, Series, Vintages, and Operations views while
  preserving selection in URL search parameters where practical.
- **REQ-003:** Every view has explicit loading, empty, unavailable, stale, and error states. No
  fixture or simulated result is displayed.

### Summary and catalog

- **REQ-004:** Overview reports configured backend, redacted target description, connection
  health, server-observed time, newest ingestion, source counts, stale counts, recent run summary,
  and DQ failure counts.
- **REQ-005:** Catalog supports allowlisted filters for module, object type, and text search;
  allowlisted sorting; stable cursor or page pagination; and a maximum page size of 200.
- **REQ-006:** Catalog rows show object name, type, module, grain, intended visual, description,
  and a reviewed deep link when one exists.

### Series discovery and history

- **REQ-007:** Series search supports source, category, frequency, stale state, and bounded text
  search over series ID and available title metadata.
- **REQ-008:** Search results show `(source, series_id)`, optional title, category, frequency,
  units when available, latest observation date, observation count, days since last, stale state,
  and metadata completeness.
- **REQ-009:** Observation history requires a complete `SeriesKey`, uses parameterized values,
  defaults to 1,000 rows, returns at most 5,000 rows per request, and supports deterministic cursor
  pagination and optional ISO `from`/`to` bounds.
- **REQ-010:** The history response reports the exact selected date range, returned-row count,
  next cursor, missing-row count, vintage selection rule, and warehouse provenance.

### Point-in-time and revisions

- **REQ-011:** A point-in-time request requires `source`, `seriesId`, and `asOf`; it returns, for
  each observation date, the latest non-empty `realtime_start <= asOf`, never exact-date-only
  matching.
- **REQ-012:** Point-in-time results are bounded and paginated using the same limits as history.
- **REQ-013:** Revision history and statistics are available only for supported FRED series and are
  labeled accordingly. Unsupported sources return `UNAVAILABLE`, not an empty success.
- **REQ-014:** The Vintages view shows original/latest values, revision count, delta, percentage,
  vintage dates, missing-state information, and warnings for incomplete vintage metadata.

### Operations

- **REQ-015:** Runs use the live `audit.etl_run` contract, including `ended_at`, total/succeeded/
  failed/skipped series, duration, and `error_message`.
- **REQ-016:** Run drill-down uses the live `audit.etl_series_run` contract and supports filters
  for run, status, load type, DQ result, and series ID.
- **REQ-017:** DQ results use `passed`, `severity`, `message`, and `metric_value`; they are ordered
  deterministically without referencing a nonexistent `checked_at` field.
- **REQ-018:** WHSE and DATAOPS use one audited adapter or shared types for warehouse audit rows so
  the existing schema mismatch cannot recur independently.

### Safety and integration

- **REQ-019:** Every endpoint uses a fixed query template and allowlists all sort keys, filter
  fields, table names, and object-to-module links. User input is never interpolated as SQL syntax.
- **REQ-020:** The browser never receives connection strings, credentials, manifest paths, raw
  stack traces, or unrestricted `error_message` content that could contain secrets. Error fields
  are normalized and length-limited.
- **REQ-021:** Production enablement fails closed unless the backend is PostgreSQL, the configured
  role is read-only, and the deployment operator has acknowledged the network-access requirement.
  Local SQLite remains supported for development and tests.
- **REQ-022:** Expensive routes set bounded limits and a database statement timeout where the
  backend supports it. Timeouts return an explicit retryable error.
- **REQ-023:** Deep links are kept in a reviewed static mapping; catalog text cannot generate an
  arbitrary URL.
- **REQ-024:** The module reports backend and query-family telemetry without SQL text, credentials,
  searched terms, series values, or manifest paths.

## Non-Functional Requirements

- **NFR-001 — Correctness:** PostgreSQL and SQLite fixture tests produce equivalent response
  contracts and ordering for all version-one endpoints.
- **NFR-002 — Read only:** Application credentials used by WHSE cannot write to warehouse schemas;
  automated production-readiness checks verify read-only transaction state or documented grants.
- **NFR-003 — Bounded work:** No request returns more than 5,000 observation rows or 200 catalog,
  series-search, run, or DQ rows. No endpoint issues an unfiltered scan of a large fact table.
- **NFR-004 — Performance:** On the reviewed local snapshot, summary/catalog/search endpoints meet
  p95 <= 1 second after warm-up; a ten-year daily history or PIT query meets p95 <= 2 seconds.
  The benchmark report records dataset size, backend, hardware context, p50, p95, and maximum.
- **NFR-005 — Failure isolation:** One failed panel request does not blank other views or replace
  last confirmed data with a fallback.
- **NFR-006 — Accessibility:** All filters, tabs, tables, status explanations, and chart tooltips
  are keyboard accessible; status is never communicated by color alone.
- **NFR-007 — Responsive layout:** Core workflows remain usable at 360px, 736px, and desktop
  widths without horizontal page overflow. Wide data tables may scroll within their container.
- **NFR-008 — Observability:** Route family, backend, latency, returned-row count, cache status, and
  normalized outcome are logged; inputs and row values are not.
- **NFR-009 — Cache safety:** Only public warehouse metadata and read results are cached in-process;
  cache keys include backend, normalized filters, pagination, and selection semantics. Default TTL
  is at most 60 seconds.
- **NFR-010 — Compatibility:** Existing routes and analytical modules behave identically when WHSE
  is disabled.
- **NFR-011 — Maintainability:** SQL, backend naming, row decoding, and response types are centralized
  in a warehouse server module and tested independently of React components.

## Acceptance Criteria

- **AC-001:** With `WHSE` enabled, the navigation item and `/warehouse` route appear; with it
  disabled, neither is reachable through registered application routes.
- **AC-002:** Overview renders live SQLite and PostgreSQL summary fixtures with identical contract
  shape and explicit backend provenance.
- **AC-003:** A database failure produces `ERR`/unavailable UI and never fixture or simulated data.
- **AC-004:** Catalog filtering, sorting, and pagination return deterministic results and reject
  non-allowlisted sort fields.
- **AC-005:** Series search preserves source-aware identity and works for a series with no
  `meta.fred_series` record.
- **AC-006:** Two rows with the same `series_id` and different sources remain distinct throughout
  search, selection, URL state, and API calls.
- **AC-007:** History returns the latest vintage per observation date, ordered consistently, with
  missing values preserved.
- **AC-008:** A PIT fixture with vintages before, on, and after `asOf` returns the newest eligible
  vintage and excludes the later one.
- **AC-009:** Empty `realtime_start` rows are excluded from strict PIT results and disclosed in the
  response.
- **AC-010:** Requests above row limits are rejected or clamped according to the documented
  contract and never create an unbounded query.
- **AC-011:** Revision endpoints return supported FRED results and an explicit unsupported response
  for non-FRED sources.
- **AC-012:** Operations renders a run with `ended_at`, failures, skipped series, and
  `error_message` using the live column names.
- **AC-013:** DQ rendering uses `passed`, `severity`, `message`, and `metric_value` and contains no
  query or type reference to `checked_at`, `result`, or `detail`.
- **AC-014:** The existing DATAOPS route uses the repaired shared audit adapter and passes regression
  tests for database and legacy-manifest paths.
- **AC-015:** Fuzzed query parameters cannot alter SQL structure, address an unapproved object, or
  create an external deep link.
- **AC-016:** Responses and logs contain no database credential or connection string.
- **AC-017:** Production-readiness fails until read-only credentials and restricted network access
  are attested; local SQLite remains usable.
- **AC-018:** Performance benchmarks meet NFR-004 or the responsible task remains blocked with an
  upstream index proposal and measured query plan.
- **AC-019:** Component and end-to-end tests cover loading, empty, stale, partial-run, timeout,
  unsupported-revision, and backend-error states.
- **AC-020:** Keyboard and viewport tests pass at the required widths with no critical accessibility
  violations or page-level overflow.
- **AC-021:** Existing module smoke tests pass unchanged with WHSE both enabled and disabled.
- **AC-022:** Owner review signs off on module boundary, security gate, freshness language, and
  rollout before `WHSE` is enabled by default.

## Dependencies

### QuantMeridian

- `src/lib/server/goldStore.ts` and the installed `pg` / `better-sqlite3` drivers.
- API discovery in `src/server/registry.ts`.
- Navigation and module configuration in `src/lib/nav.ts`, `src/App.tsx`, and
  `settings/modules.config.json`.
- Existing chart primitives and terminal layout components.
- Existing DATAOPS types and page, which require an audit-contract repair.

### Warehouse

- PostgreSQL schemas `gold`, `silver`, `meta`, and `audit` or their SQLite-prefixed equivalents.
- A local SQLite snapshot for development and parity tests.
- A read-only application role before production use.
- Restricted PostgreSQL network exposure before production use.
- Potential upstream composite indexes identified by measured `EXPLAIN (ANALYZE, BUFFERS)` results;
  QuantMeridian will not create them automatically.

## Risks & Mitigations

| ID | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| RISK-001 | Stale warehouse data is mistaken for current data | Bad analytical decisions | Persistent freshness date/age and stale disclosure |
| RISK-002 | Large PIT/revision queries scan tens of millions of rows | Slow routes or DB pressure | Source/series/date requirement, hard limits, timeout, benchmark, upstream index gate |
| RISK-003 | Weak or write-capable credentials reach deployment | Data loss or exposure | Read-only-role production gate and network attestation |
| RISK-004 | Metadata joins silently drop non-FRED sources | Incomplete explorer | Coverage is the inventory; metadata joins are left/optional |
| RISK-005 | Bare series IDs collide later | Wrong series selected | Composite source-aware identity everywhere |
| RISK-006 | Audit schema drifts again | Broken operations view | Shared decoder/types plus schema-contract tests |
| RISK-007 | WHSE duplicates existing analytical modules | Confusing product surface | Inventory/evidence boundary and reviewed deep links |
| RISK-008 | Text dates contain invalid or non-normalized values | Incorrect ordering/PIT | Strict input validation, data-quality counters, deterministic warnings |
| RISK-009 | Error messages expose operational details | Information disclosure | Normalization, redaction, truncation, no raw stack traces |
| RISK-010 | SQLite/PostgreSQL dialect divergence | Local success, deployment failure | Shared contract suite against both backends |

## Approved Design Decisions

These are proposed by this draft and become approved only when the spec status changes.

| ID | Decision | Rationale |
| --- | --- | --- |
| D-01 | Use module code `WHSE`, route `/warehouse`, group `DATAOPERATIONS` | Clear, separate product boundary |
| D-02 | Keep WHSE separate from DATAOPS | Warehouse exploration and cross-provider operations have different primary users |
| D-03 | Use `(source, series_id)` as canonical identity | Multi-source correctness |
| D-04 | Use `silver.fred_observation` for current history and PIT in v1 | It is source-aware and indexed; Gold PIT products are FRED-only and currently unindexed |
| D-05 | Use fixed route queries, never arbitrary SQL | Security and performance containment |
| D-06 | Support PostgreSQL and SQLite in v1; fail closed on Databricks | Matches inspected environments and avoids unreviewed schema assumptions |
| D-07 | Share the warehouse audit adapter with DATAOPS | One live schema contract and one repair |
| D-08 | Keep module disabled by default until rollout gates pass | Avoid exposing stale or insecure production connectivity |
| D-09 | Make freshness and partial-run state first-class UI | Prevent accidental current-data claims |
| D-10 | Track upstream index/security changes as explicit external dependencies | QuantMeridian remains read-only and repository boundaries stay clear |

## Open Questions For Owner Review

1. Should the visible product name be **Warehouse Explorer** or **Macro Warehouse Explorer**?
2. Should WHSE replace any warehouse-specific panels currently on DATAOPS after the shared audit
   adapter lands, or should both retain read-only summaries?
3. Is production rollout allowed before pipeline freshness is restored, provided the stale banner
   is prominent, or is current ingestion a hard gate?
4. Should a filtered CSV export be added after version one, with explicit row and date limits?
5. Which existing module deep links should be included in the first reviewed mapping?

## Related Documents

- `PLAN.md` — architecture, queries, contracts, file layout, testing, and rollout.
- `TASKS.md` — ordered tasks, statuses, completion evidence, and acceptance coverage.
- `docs/integration/postgres_warehouse.md` in the pipeline repository at commit `7653847` —
  warehouse reference assessed for this spec; not treated as executable instruction.
- `docs/data/PLATFORM_DATA_CONNECTIVITY.md` — existing application data connectivity.
- `docs/gold-db/MODULE_DATA_AUDIT.md` — existing module-to-data audit.
- `docs/validation/LIVE_DATA_READINESS_ASSESSMENT.md` — existing readiness context.

## Exceptions

None approved. Any deviation from composite identity, DB-only provenance, bounded queries,
read-only access, or the rollout gates requires an explicit spec amendment and owner approval.
