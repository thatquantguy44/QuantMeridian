# Tasks: Warehouse Explorer

- **Spec:** spec010-warehouse-explorer (`SPEC.md`)
- **Plan:** `PLAN.md`
- **Status:** Draft implementation backlog
- **Last updated:** 2026-10-07
- **Overall progress:** 2 of 27 tasks done (7%)

> This is the build ledger. Update it in every implementation PR. Requirements describe intended
> behavior; only this file records execution status and completion evidence.

## Status Rules

Allowed task values:

- `todo` — ready or awaiting its dependency; no implementation claim.
- `in-progress` — actively being implemented on a named branch/PR.
- `blocked` — cannot proceed; the blocking condition and owner are recorded.
- `done` — implementation, mapped tests, documentation, and review evidence are complete.

When changing a task:

1. Update its status, owner, and `Updated` date.
2. Add the PR or commit under Completion Evidence.
3. Record tests actually run, including skipped backend suites.
4. Update the Acceptance Coverage Map.
5. Update Overall Progress and the Change Log.
6. If behavior changed from the approved spec, amend `SPEC.md` or `PLAN.md` in the same PR.

## Definition of Done

Every implementation task is done only when:

- the requested behavior and failure states are implemented;
- relevant unit, route, integration, component, or end-to-end tests pass;
- SQLite/PostgreSQL parity is tested where the task touches data access;
- query limits, provenance, error handling, and accessibility are covered;
- no credential, raw connection string, SQL text, or sensitive value is logged or returned;
- documentation and configuration examples are updated;
- `git diff --check` passes; and
- completion evidence is recorded below.

## Milestones

| Milestone | Scope | Exit condition | Status |
| --- | --- | --- | --- |
| M0 — Spec approval | Scope, contracts, decisions, gates | Owner approval recorded | in-progress |
| M1 — Data foundation | Backend map, validation, contracts, fixtures, audit adapter | Dual-backend contract suite passes | todo |
| M2 — Read APIs | All `/api/warehouse/*` routes | Route/security tests pass | todo |
| M3 — Module UX | Five views, URL state, chart/table, failures | Component and e2e suites pass | todo |
| M4 — Integration | DATAOPS repair, docs, telemetry | Existing regressions pass | todo |
| M5 — Production readiness | Security, performance, accessibility, Postgres pilot | Owner signs rollout gate | todo |

## Task List

### Slice A — Discovery, scope, and approval

| ID | Task | Covers | Status | Owner | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-001 | Inspect the warehouse document, live PostgreSQL schema/data quality, local SQLite parity, and QuantMeridian integration points. | Baseline | done | Codex | 2026-10-07 | Read-only assessment; no DB/repo mutation. |
| T-002 | Draft `SPEC.md`, `PLAN.md`, and `TASKS.md` with update protocol and traceability. | All | done | Codex | 2026-10-07 | Pending owner review. |
| T-003 | Review and approve product name, module boundary, data sources, backend scope, security gates, freshness gate, and initial deep-link map. | D-01–D-10, AC-022 | in-progress | Owner | 2026-10-07 | Owner directed implementation to begin on `spec_010-implementation` with `macro_medallion` preferred; remaining rollout and product decisions are still pending. |

### Slice B — Server foundation

| ID | Task | Covers | Status | Owner | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-004 | Implement backend support/gate and exhaustive logical-to-physical object mapping for SQLite/PostgreSQL; fail closed on Databricks. | REQ-021, NFR-001 | in-progress | Codex | 2026-10-07 | Branch: `spec_010-implementation`; PostgreSQL target is the configured `macro_medallion` warehouse. |
| T-005 | Implement parameter validation: composite keys, strict dates, escaped search, limits, allowlisted sorts/filters, and normalized errors. | REQ-019–020, NFR-003 | todo | — | — | Fuzz invalid Unicode/control/date/limit inputs. |
| T-006 | Implement API/domain contracts, database row decoders, numeric/boolean coercion, metadata-completeness rules, and stored-error sanitization. | REQ-007–018, REQ-020 | todo | — | — | Live audit columns are authoritative. |
| T-007 | Implement endpoint-bound cursor validation/signing and bounded short-TTL cache. | REQ-005, REQ-009, NFR-009 | todo | — | — | Production cursors signed; filters hash included. |
| T-008 | Build shared logical fixtures and contract harness for temporary SQLite/PostgreSQL databases. | NFR-001 | todo | — | — | Include shared ID across sources and PIT edge cases. |
| T-009 | Implement the shared warehouse audit adapter for runs, series runs, and DQ results. | REQ-015–018 | todo | — | — | Must not reference `finished_at` or `checked_at`. |

### Slice C — Read-only API routes

| ID | Task | Covers | Status | Owner | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-010 | Implement summary and catalog queries/routes, source aggregation, redacted connection state, reviewed deep links, and pagination. | REQ-004–006 | todo | — | — | Small catalogs only; deterministic ordering. |
| T-011 | Implement source-aware series search and optional metadata enrichment. | REQ-007–008, REQ-014 | todo | — | — | Coverage row survives missing metadata. |
| T-012 | Implement bounded latest-vintage observation history and pagination. | REQ-009–010 | todo | — | — | Preserve explicit missing values. |
| T-013 | Implement PIT reconstruction and FRED-only revision summary/exact-observation modes. | REQ-011–014 | todo | — | — | `latest realtime_start <= asOf`; empty realtime warning. |
| T-014 | Implement runs and DQ routes using the shared audit adapter. | REQ-015–017 | todo | — | — | No fabricated DQ timestamps. |

### Slice D — Module shell and user experience

| ID | Task | Covers | Status | Owner | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-015 | Register `WHSE`, `/warehouse`, Data Operations navigation, disabled-by-default rollout state, feature shell, and URL-state parser. | REQ-001–003 | todo | — | — | Disabled state must preserve existing routing. |
| T-016 | Build Overview and Catalog views with freshness, source coverage, run/DQ summaries, filters, pagination, and deep links. | REQ-004–006 | todo | — | — | No composite health score. |
| T-017 | Build Series view: discovery, composite selection, metadata state, bounded history chart/table, date controls, and missing-value rendering. | REQ-007–010 | todo | — | — | Chart states fetched range explicitly. |
| T-018 | Build Vintages view: as-of reconstruction, incomplete-vintage warning, FRED revision summaries, and exact-observation drill-down. | REQ-011–014 | todo | — | — | Non-FRED revision state is explanatory. |
| T-019 | Build Operations view: recent runs, series-run failures, DQ filters, unfinished-run state, and sanitized errors. | REQ-015–017 | todo | — | — | Stored state is not silently reclassified. |

### Slice E — Existing integration and operations

| ID | Task | Covers | Status | Owner | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-020 | Migrate `/api/dataops/runs` to the shared audit adapter while preserving intelligence-feed and legacy-manifest resolution behavior. | REQ-018, AC-014 | todo | — | — | Add regression tests before changing route. |
| T-021 | Add structured metadata-only telemetry, timeout handling, cache metrics, and normalized route outcomes. | REQ-022, REQ-024, NFR-008 | todo | — | — | No SQL, values, or search text in logs. |
| T-022 | Document and test the production read-only role, restricted-network attestation, production flags, and failure-closed behavior. | REQ-020–022, NFR-002 | todo | — | — | Current inspected superuser setup is not acceptable. |

### Slice F — Verification, performance, and rollout

| ID | Task | Covers | Status | Owner | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-023 | Run representative SQLite/PostgreSQL performance benchmarks and query plans; file upstream index changes if budgets fail. | NFR-003–004, AC-018 | todo | — | — | Never create warehouse indexes at application runtime. |
| T-024 | Complete component accessibility, keyboard, status-text, and 360/736/desktop responsive verification. | NFR-006–007, AC-020 | todo | — | — | Status cannot rely on color. |
| T-025 | Add `verify:warehouse`, security/fuzz tests, backend contract suite, Playwright flow, report output, and CI integration. | NFR-001–011 | todo | — | — | Report lists Postgres suite run or skipped. |
| T-026 | Update deployment, connectivity, runbook, `.env.example`, and rollback documentation. | Rollout | todo | — | — | Examples contain placeholders only. |
| T-027 | Run local SQLite pilot, read-only PostgreSQL pilot, resolve freshness decision, record owner acceptance, and enable WHSE for the approved environment. | AC-022 | todo | Owner | — | Production remains disabled until all gates pass. |

## Acceptance Coverage Map

| Acceptance criterion | Planned verification | Status | Evidence |
| --- | --- | --- | --- |
| AC-001 | Module config/nav/App tests; disabled route e2e | todo | — |
| AC-002 | Shared SQLite/PostgreSQL summary contract suite | todo | — |
| AC-003 | Database-error route and component tests | todo | — |
| AC-004 | Catalog allowlist, ordering, cursor, and injection tests | todo | — |
| AC-005 | Missing-metadata search fixture | todo | — |
| AC-006 | Cross-source duplicate-ID fixture and URL-state e2e | todo | — |
| AC-007 | Latest-vintage ranking golden fixture | todo | — |
| AC-008 | Before/on/after as-of golden fixture | todo | — |
| AC-009 | Empty-realtime exclusion/warning fixture | todo | — |
| AC-010 | Limit rejection and maximum-row tests | todo | — |
| AC-011 | FRED/non-FRED revision route tests | todo | — |
| AC-012 | Live audit run decoder and Operations component test | todo | — |
| AC-013 | DQ schema contract/static source assertion | todo | — |
| AC-014 | DATAOPS database/manifest/combined/empty regression tests | todo | — |
| AC-015 | Query parameter fuzzing and deep-link allowlist tests | todo | — |
| AC-016 | Response/log credential and connection-string scan | todo | — |
| AC-017 | Production gate matrix and role setup verification | todo | — |
| AC-018 | Retained benchmark report and query-plan review | todo | — |
| AC-019 | Component/e2e state matrix | todo | — |
| AC-020 | Keyboard, accessibility, and viewport e2e | todo | — |
| AC-021 | Existing module smoke suite with WHSE on/off | todo | — |
| AC-022 | Owner sign-off record in this document | todo | — |

## Completion Evidence

### T-001 — Discovery and assessment

- **Completed:** 2026-10-07
- **Evidence:** Read the pipeline warehouse reference from repository history at commit `7653847`;
  inspected live PostgreSQL schemas, columns, row counts, indexes, freshness, run/DQ state, and
  selected analytical-table quality; inspected the local SQLite schema and application repository.
- **Safety:** All database transactions were read-only. No repository files or database objects
  were changed during discovery.
- **Key findings carried into the spec:** 57 Gold tables, 7 Gold views, 54 catalog objects,
  source-aware identity requirement, partial/stale latest ingestion, audit contract drift, missing
  metadata coverage, and production credential/network concerns.

### T-002 — Draft specification set

- **Completed:** 2026-10-07
- **Evidence:** `SPEC.md`, `PLAN.md`, and `TASKS.md` created under `docs/specs/spec010/`.
- **Review:** Pending owner approval; documents remain Draft.

## Blockers & External Dependencies

| ID | Dependency/blocker | Owner | Affected tasks | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| EXT-001 | Owner decisions in `SPEC.md` Open Questions | Owner | T-003 onward | open | Review spec010 and record decisions |
| EXT-002 | Dedicated read-only PostgreSQL role | Pipeline/DB owner | T-022, T-027 | open | Create grants and verify write denial |
| EXT-003 | Restricted PostgreSQL network exposure | Pipeline/DB owner | T-022, T-027 | open | Bind privately/locally or approve private connection |
| EXT-004 | Pipeline freshness and incomplete runs | Pipeline owner | T-027 | open | Restore/confirm ingestion and decide rollout gate |
| EXT-005 | Potential composite indexes after measurement | Pipeline owner | T-023 | pending evidence | Benchmark first; propose migration only if needed |

## Owner Decision Record

| Decision | Selection | Approved by | Date | Notes |
| --- | --- | --- | --- | --- |
| Product name (`Warehouse Explorer` vs `Macro Warehouse Explorer`) | pending | — | — | — |
| Keep separate from DATAOPS | pending | — | — | — |
| Silver observation/PIT source | pending | — | — | — |
| PostgreSQL + SQLite version-one scope | pending | — | — | — |
| Production security gate | pending | — | — | — |
| Freshness as hard rollout gate | pending | — | — | — |
| Initial deep-link mapping | pending | — | — | — |

## Change Log

| Date | Change | Author | Reference |
| --- | --- | --- | --- |
| 2026-10-07 | Initial spec, plan, backlog, evidence, and dependency ledger created. | Codex | T-001, T-002 |
| 2026-10-07 | Began implementation on `spec_010-implementation`; started the backend boundary and production gate with PostgreSQL preferred. | Codex | T-003, T-004 |

## Follow-Ups Outside Version One

- Filtered, bounded CSV export.
- Databricks parity after its `audit`, `meta`, and `silver` object contracts are reviewed.
- Saved warehouse searches or analyst workspaces.
- Cross-series comparison and chart-studio handoff beyond reviewed deep links.
- Pipeline-trigger or remediation actions under a separately authenticated and authorized spec.
- Source-aware metadata catalog in the warehouse, eliminating optional bare-ID joins.
