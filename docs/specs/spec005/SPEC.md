# Spec005: QuantSmith Integration Layer

## Status

Draft. Phase 0 (contract audit, this document) and Phase 1's Market
Terminal-side half (commit pin + drift-check gate) are done. Phase 2 (one
narrative-drafting pilot) is done — see `PHASE2_PILOT_DRAFT.md` and
`PHASE2_PILOT_VERIFICATION.md`. No UI or automation has shipped; the pilot
was a manual, one-off exercise per its own recommendation. Phase 1's other
half (registering Market Terminal in QuantSmith's own downstream-repo list,
which requires editing the separate `QuantSmith` GitHub repo) and Phase 3
(deciding on items 3/4 below) remain open.

**2026-09-17 revisit:** the original Non-Goals ruled QuantSmith's
optimization/portfolio/trading agent families out of scope on the premise
that "Market Terminal is a display/analytics terminal, not a trading or
portfolio system." That premise no longer fully holds — `IBAL`
(InventoryBallast) shipped since this spec was written: a real, pinned
MILP/QP securities-lending inventory optimizer living inside this repo (see
`services/inventory_optimizer_api/tests/VALIDATION.md`,
`src/app/inventory-optimizer/`). The general optimization/trading/portfolio
Non-Goal is reaffirmed as still correct — Market Terminal is not becoming a
trading or portfolio system — but a narrow, IBAL-specific exception is added
as candidate synergy item 6 below: registering IBAL with QuantSmith's model
plugin adapter (spec `0026`), which is purpose-built for exactly this case
("route work to a model an adopter has already built internally... without
reimplementing it inside this SDK"). Not yet approved for implementation —
see item 6 and the updated Decisions Before Implementation table.

**2026-10-06 note:** `docs/specs/spec009/` (draft, pending owner review)
proposes automating items 2 and 4 in an attended form: module-embedded agent
panels that queue QuantSmith workflows in a separate Python worker pinned to
this file's QuantSmith pin, with every number re-verified against Gold before
display. It keeps every non-goal below and adds one invocation mode beside the
external Claude Code/agent SDK session: a pinned QuantSmith checkout inside a
QuantMeridian-hosted worker, the same pattern IBAL's service uses for
InventoryBallast.

## Owner

Joshua Lutkemuller / Market Terminal

## What QuantSmith Is

`QuantSmith` (formerly `qf_workflow_sdk_public`, now at
`../agentic_workflows/qf_workflow_sdk_public` under `Quant Sandbox/`, public
repo `joshualutkemuller/QuantSmith`) is a separate, Python, spec-driven
agentic SDK for quant research: 162 narrow agent role-contracts, 33 quality
gates, 52+ specs each with a tested stdlib-only reference runtime, a
provider-boundary `adapters/` layer, and a committed `memory/` workflow-memory
store. It follows its own Spec-Driven Development flow (Constitution → Specify
→ Plan → Tasks → Implement → Verify → Operate) and its own constitution in
`instructions/engineering_principles.md`.

QuantSmith is not a web app and has no UI of its own beyond a read-only
Knowledge Console (`0057`). It is a toolkit two ways: a versioned Python
package (`pip install quantsmith`) of dependency-free reference runtimes, and
a copyable scaffold of agents/gates/standards adopted into another repo. Market
Terminal is a Next.js/Vite/React/TypeScript terminal UI. **These two repos
should never merge.** This spec defines the boundary contract between them,
not a rewrite of either.

## Product Thesis

Market Terminal already enforces a strict discipline for its own numeric data:
Gold/FRED-only, no synthetic or fallback values, explicit unavailable states,
full source/as-of/transform citation (see `spec004`'s Data Policy and Trust
And Citation Contract). QuantSmith independently enforces the same discipline
for quant research: leakage-safe, point-in-time-correct, reproducible,
grounded-not-invented, secrets-never-in-repo. Neither repo needs to compromise
that discipline to work together — the synergy is that they are already
philosophically compatible, and in one concrete place, literally reading the
same upstream database.

The goal of this spec is to identify where QuantSmith's agent workflows can
produce **draft narrative, detection logic, or governed chart contracts** that
Market Terminal's existing or planned modules (chiefly `MPUB`, spec004) can
consume as a *starting point* — never as a numeric source of truth. Market
Terminal's own Gold read path remains the only origin for any number displayed
or exported.

## Confirmed Shared Ground

### The Gold/FRED database

Both repos are independent, read-only consumers of the same upstream project,
`fred-bronze-to-gold-pipeline`:

- Market Terminal reads Gold analytical views (`gold.macro_indicator_dashboard`,
  `treasury_curve`, `curve_spread_daily`, `benchmark_rate_board`,
  `funding_tape_daily`, `credit_spread_daily`, `macro_regime_daily`,
  `inflation_explorer`, `equity_total_return_index`, `dim_series`,
  `powerbi_catalog.module`, etc.) through a `GoldStore` abstraction behind
  `MACRO_DB_URL` (SQLite locally, Postgres/Databricks-Delta in deploy). See
  `docs/features/GOLD_DB_MIGRATION_HANDOFF.md` and `docs/gold-db/`.
- QuantSmith's spec `0045` (`src/quantsmith/pipelines/fred_point_in_time.py`)
  reads the same pipeline's `gold_fred_point_in_time` table directly —
  `series_id`, `observation_date`, `realtime_start`, `realtime_end`, `value`,
  `revision_number`, `is_missing` — to answer vintage-correct "what was known
  as of date X" questions for its backtest engine (spec `0044`).

Neither repo writes to that database. Both treat a missing table, missing
file, or empty result as a named error, never a silent empty/zero fallback.
This is the single most concrete point of contact between the two repos today
and requires no new code to be true — it is already true independently.

### The downstream-consumer contract QuantSmith already built

QuantSmith's spec `0047` ("Downstream Consumer Contract") was written
explicitly anticipating "a client in a separate repository consumes
QuantSmith." It ships:

- `schema_version` on `DashboardSpec` plus `check_schema_compatibility`, so a
  consumer can refuse a payload it doesn't understand instead of crashing.
- A release-notify GitHub Actions workflow that dispatches a
  `repository_dispatch` event to configured downstream repos on a version tag
  (notification only, never an auto-merge).
- `hooks/stages/quantsmith-version-check.sh`, a copyable gate that flags a
  consuming repo whose `quantsmith` pin is missing, floating, or behind the
  installed version, and reports "not a consumer; skipped" everywhere else.

Market Terminal is the first real candidate for this contract. Today no repo
outside QuantSmith itself declares a `quantsmith` dependency, so the gate has
never fired for real. Registering Market Terminal here is low-risk (a version
pin plus an offline gate script) and gives QuantSmith the real second consumer
its own spec assumed would eventually exist.

## Candidate Synergies

Ranked roughly by confidence and effort. None are approved for
implementation by this spec alone — see Decisions Before Implementation.

### 1. Register Market Terminal as a QuantSmith downstream consumer (infra only)

Adopt spec `0047`'s mechanism even though Market Terminal will not `pip
install quantsmith` into its Node/Vite runtime:

- Record the QuantSmith commit/tag Market Terminal's docs and any copied
  artifacts (chart contracts, agent-produced drafts) were validated against,
  in a small pinned-reference file (e.g. `docs/specs/spec005/QUANTSMITH_PIN.md`
  or a `quantsmith.lock` note) — the moral equivalent of a version pin for a
  non-package consumer.
- Add Market Terminal to QuantSmith's downstream-repository list so the
  release-notify workflow has somewhere to dispatch to (opens a bump-review
  task here on a new QuantSmith tag; never auto-merges).
- Add a Market Terminal-side check (in the spirit of the existing
  `scripts/check-gold-db-policy.sh` gate) that fails loudly if a QuantSmith
  artifact consumed here (see items 2-4) is older than the last reviewed pin.

This item has no product-facing effect. It exists so the other items below
don't quietly drift out of sync with an SDK that ships frequent spec-numbered
changes.

### 2. QuantSmith `economists/` agents as MPUB's narrative drafting layer

QuantSmith's `agents/economists/` pillar is a close structural match for
`spec004` (`MPUB`)'s editorial workflow:

| QuantSmith agent | MPUB package/workspace it maps to |
| --- | --- |
| `macro_indicator_analyst/` | Post-Release Note candidate detection |
| `monetary_policy_analyst/` | Rates/policy sections of Market Close Wrap, Monthly package |
| `macro_regime_classifier/` | Regime-change detection feeding `Today`'s ranked candidates |
| `cross_asset_macro_linkages/` | "Cross-Asset Confirmation" narrative approach |
| `macro_scenario_analyst/` | "Week Ahead" package, Quarterly Guide scenario chapter |
| `macro_backdrop_summarizer/` | Monthly State Of Markets narrative synthesis |
| `economic_outlook_report_writer/` | Quarterly Market Guide long-form chapters |
| `morning_brief_writer/` (spec `0059`) | Pre-Market Brief narrative draft |

The fit is structural, not just topical: QuantSmith's own principle for this
group is "grounded, not invented — an indicator value, policy statement, or
forecast traces to a supplied input or a registered `sources/` entry; what
isn't known yet is a stated gap, never a plausible guess." That is the same
rule spec004 states for `MPUB` ("do not... invent a narrative when the
evidence is weak").

Proposed contract: a QuantSmith economists agent is invoked externally (as a
Claude Code / agent SDK session against the QuantSmith scaffold, not as an
imported Python module inside Market Terminal's server) and produces a draft
artifact — commentary text, a ranked list of candidate observations, a
proposed narrative structure. Market Terminal never trusts a number inside
that draft. Before a draft can populate an `MPUB` candidate:

- every numeric claim in the draft must be re-resolved against Market
  Terminal's own `GoldStore` read for the same series/date, and
- any claim that cannot be re-resolved is dropped or flagged
  `unverified — no matching Gold series`, never displayed as-is.

This preserves spec004's non-negotiable rule ("Reused module output is
permitted only when its resolved rows satisfy the same approved-source and
no-fallback contract") while letting the drafting step start from an agent's
work instead of a blank editorial queue.

`morning_brief_writer` specifically sources live market **commentary** (not
macro indicators) from `sources/{newsapi,alpha_vantage_news,finnhub_news}.yml`
— free-tier news/sentiment APIs. This is the same *category* of input as
Market Terminal's existing `NEWS`/`SENT` Tier B live exception (out of scope
for the Gold-only cutover, per the `gold-db-cutover` migration decision), not
a new numeric data source. It still requires its own Source Gate review
(spec004's Source Gate) before any `morning_brief_writer` output reaches
`MPUB`, since it is a new upstream provider Market Terminal has not
individually approved.

### 3. QuantSmith monitoring/alerting pattern as a reference for MPUB's material-change detectors and CAL

`MPUB` Phase 1 needs "material-change detection and ranking" (spec004,
Gap To Fill) and `CAL` wants a week-ahead catalyst briefing. QuantSmith
already ships a tested version of the adjacent problem:

- `agents/monitoring/model_signal_monitoring/` — watches a live signal
  against a point-in-time baseline, reports honest degraded/healthy state,
  emits an `Observation` rather than paging directly (spec `0021`).
- `agents/alerts/{alert_policy,alert_router,incident_notification}/` — turns
  an `Observation` into a deduplicated, severity-routed, owner/channel-routed
  alert (spec `0020`), delivered through `adapters/alert_delivery/` — all
  seven channel providers (email, webhook, Slack, Teams, ticketing,
  PagerDuty/Opsgenie, SMS/push) are executable (specs `0032`/`0037`).

Proposal: use this design (baseline → breach → `Observation` → policy-routed
alert, never remediating silently) as the reference architecture for a
Market-Terminal-native material-change detector reading `GoldStore` directly,
rather than importing QuantSmith's Python alerting code into the Node/Vite
runtime. If Joshua wants delivery (e.g. "notify me when MPUB stages a
high-ranked candidate"), `adapters/alert_delivery/` is a candidate to invoke
as an external process, keeping the detection logic and the delivery channel
on the QuantSmith side of the boundary while Market Terminal only supplies
the Gold-sourced trigger data.

### 4. `DashboardSpec` as an optional chart-authoring contract for MGC/MKC/`MPUB` Publish

QuantSmith's `analytics/dashboard_design` produces a tool-agnostic
`DashboardSpec` (governed metrics, panel layout, one design → seven rendered
targets including a React scaffold, spec `0017`). Market Terminal's `MGC`/
`MKC` chart studios and `MPUB`'s Publish workspace both need "chart-level
source, transform, frequency, and as-of metadata" and a "reproducible archive
of chart definitions" (spec004).

QuantSmith's React renderer scaffolds a **standalone** React app — it is not
a component library Market Terminal can import directly. The realistic
integration is narrower: treat `DashboardSpec` JSON as an optional
*authoring/interchange format*. A new, Market-Terminal-side adapter (living in
this repo, not QuantSmith) could translate a `DashboardSpec` payload's panel
definitions (metric, dimensions, transform) into an `MGC`/`MKC` chart
definition, giving that chart a spec-driven provenance trail. This is a
"nice to have" that only pays off once someone is actually authoring chart
definitions in QuantSmith's dashboard-design workflow for a Market Terminal
audience — not before.

### 5. Workflow memory / Knowledge Console — explicitly not merged with MPUB's Archive

QuantSmith's `memory/` store (specs `0048`/`0049`/`0057`) and `MPUB`'s
proposed Archive (spec004 §Archive) are conceptually parallel — both are
point-in-time-aware, typed, versioned records — but they store different
things (QuantSmith: dataset/workflow behavior facts; `MPUB`: publication
definitions and provenance) and have different access-control needs
(QuantSmith's spec `0058` viewer roster vs. Market Terminal's own auth). No
integration is proposed here. Noted only so a future contributor doesn't
assume the two stores should become one.

### 6. Register IBAL as a QuantSmith model plugin (spec `0026`) — added 2026-09-17

Added on revisit; not covered by the original Phase 0 audit, since `IBAL`
did not exist when this spec was written.

QuantSmith's `agents/optimization/` group ships its own built-in solver
formulations (LP, MILP, QP, conic, nonlinear, global, stochastic, robust,
DP, network flow) plus `inventory_supply_chain/` and
`solver_diagnostics_sensitivity/` review roles — the general "optimization
toolkit" family the original Non-Goals correctly excludes. Separately,
`adapters/model_plugin/` (spec `0026`) exists specifically so a workflow can
route to **a model an adopter has already built internally** instead of that
model being reimplemented inside the SDK: a registration-manifest contract
with three invocation profiles (Python callable, REST endpoint, CLI binary),
resolved through a local, gitignored `model_plugins.yml` at the QuantSmith
repo root (real model/endpoint specifics never enter the QuantSmith repo,
tracked/staged copies are gate-blocked), reviewed by
`agents/optimization/model_plugin_registration/`, which produces an
honestly-bounded understanding brief — every declared capability labeled a
*claim*, not a verified fact.

`IBAL`'s FastAPI service (`services/inventory_optimizer_api`,
`/v1/datasets/synthetic`, `/v1/runs`, `/v1/exports/result-tables`, `/health`,
`/v1/capabilities`) is a clean fit for the REST-endpoint invocation profile
as-is — no new surface required on the Market Terminal side.

This is **not** a proposal to adopt QuantSmith's own securities-lending
runtime (spec `0023`, `sec_lending_workflow.py`). That pipeline is a lighter,
research/demo-oriented LP-with-greedy-fallback optimizer with heuristic ML
and synthetic/SQL seed data — built to exercise the agentic-quant pattern,
not a production engine. `IBAL` is materially more mature on every axis that
matters here (pinned MILP/QP engine, full domain/reconciliation validation,
176 backend tests per `tests/VALIDATION.md`). Nothing about item 6 touches
or replaces `IBAL`'s own solve authority; QuantSmith would only ever *review
or report on* an `IBAL` result it independently invoked, never recompute or
override one.

Two things currently block this from being more than a scoped plan:

- Spec `0026` itself ships **no executable dispatcher** — Non-Goals there
  say so explicitly ("a future spec may add an executable dispatcher... once
  a concrete invocation target exists to build and test against"). `IBAL`
  would be the first concrete invocation target, but building the dispatcher
  is QuantSmith-repo work, not Market Terminal work.
- Every existing Non-Goal below still applies: no merged codebase, no
  `pip install quantsmith` inside Market Terminal's Node server, and any
  number a QuantSmith agent reports about an `IBAL` run must be independently
  re-resolved against `IBAL`'s own API response before Market Terminal (or
  anyone) treats it as fact — the same borrowed-authority guardrail Phase 2's
  narrative pilot exists to enforce.

Proposed narrow first pilot, once approved: register `IBAL` in a local
`model_plugins.yml` (QuantSmith side, gitignored, per the existing template
pattern), run `model_plugin_registration` against it to produce the
understanding brief, and — since no dispatcher exists yet — invoke `IBAL`'s
REST API manually/by script from outside both repos' runtimes to produce one
real reviewed run, mirroring Phase 2's manual, one-off pilot shape rather
than wiring live automation on the first attempt.

## Explicit Non-Goals

- No merged codebase, shared process, or shared deploy target. QuantSmith
  stays a Python scaffold/package; Market Terminal stays a Next.js/Vite/React
  terminal. Integration happens at artifact boundaries (a database, a JSON
  payload, an alert delivery call), never at the runtime/process boundary.
- No `pip install quantsmith` (or any Python dependency) inside Market
  Terminal's Node server. If a QuantSmith agent or runtime needs to run, it
  runs in QuantSmith's own environment and hands Market Terminal a file or an
  API response to validate independently.
- No QuantSmith-originated number is ever displayed or exported by Market
  Terminal without being independently re-resolved against `GoldStore`. This
  applies to every synergy above, not just item 2.
- No new Market Terminal data source is approved by this spec. Any provider
  QuantSmith already integrates (FRED point-in-time excepted, since it is the
  same pipeline Market Terminal already reads) still requires its own
  spec004 Source Gate decision before touching `MPUB` or any other module.
- QuantSmith's trading-strategy, portfolio-construction, execution, and
  backtesting agent families (`trading_strategies/`, `portfolio_management/`,
  `0007`/`0012`/`0013`/`0034`-`0036`/`0044`/`0046`) are out of scope. Market
  Terminal is a display/analytics terminal, not a trading or portfolio system,
  and taking on that surface is a separate decision this spec does not make.
  **Reaffirmed on the 2026-09-17 revisit** — `IBAL` existing does not change
  this: Market Terminal is still not adopting QuantSmith's general
  optimization/portfolio/trading agents to *build* anything new. The one
  narrow exception is item 6 (`0026` model-plugin registration), which
  connects an already-built, already-pinned, already-validated engine to a
  review/reporting layer — it does not import solver logic, formulation
  agents, or portfolio-construction agents into Market Terminal, and `IBAL`'s
  own optimization stays entirely outside QuantSmith's authority.
- QuantSmith's own securities-lending runtime (spec `0023`,
  `sec_lending_workflow.py`) is explicitly not adopted, in whole or in part —
  `IBAL` already solves this problem at a higher standard of rigor. See item 6.
- No direct posting, alert delivery, or external notification ships as a side
  effect of this spec. Any alert-delivery use (item 3) still requires the same
  human-approval gate `MPUB`'s Publish workspace already requires for external
  posts.

## High-Level Architecture

```text
                fred-bronze-to-gold-pipeline (Gold/FRED SQLite/Postgres)
                        |                                  |
                        v                                  v
        Market Terminal GoldStore                QuantSmith fred_point_in_time
        (MACRO_DB_URL, display/export)            adapter (spec 0045, research)
                        |                                  |
                        v                                  v
              MPUB candidate queue  <--- draft narrative --- economists/ agents
              (Gold-verified numbers                        (spec 0059 + pillar,
               only; agent drafts                            external invocation,
               re-resolved or dropped)                       never trusted as-is)
```

Both read paths originate at the same upstream pipeline and stay independent.
The only new arrow this spec proposes is the dashed one: an externally
invoked QuantSmith agent producing a draft that Market Terminal re-verifies
before it can enter `MPUB`'s queue.

## Delivery Plan

### Phase 0: Contract Audit (this spec)

- Inventory confirmed shared ground (done above).
- Rank candidate synergies and get an explicit go/no-go per item from Joshua.
- No code changes.

### Phase 1: Downstream-consumer registration (item 1)

- [x] Record the reviewed QuantSmith commit/tag Market Terminal is validated
  against — `QUANTSMITH_PIN.md`.
- [ ] Register Market Terminal in QuantSmith's downstream-repository list for
  release-notify dispatch — not done; requires editing the separate
  `QuantSmith` GitHub repo.
- [x] Add a Market Terminal-side pin-freshness check alongside
  `scripts/check-gold-db-policy.sh` — `scripts/check-quantsmith-pin.sh`,
  wired as `npm run check:quantsmith-pin`.

Deliverable: Market Terminal shows up as a real consumer in QuantSmith's own
gate output instead of "not a consumer; skipped." **Partially met** — true on
the Market Terminal side; the QuantSmith-side registration is still open.

### Phase 2: One narrative-drafting pilot (item 2, narrowest slice) — done

- Package/agent picked: Pre-Market Brief (spec004) /
  `agents/economists/macro_backdrop_summarizer`.
- Draft produced against real Gold DB data, with two deliberately injected
  unsupported claims (an unsourced policy narrative, a fabricated Treasury
  yield, plus an invented GDP-consensus figure) to stress-test the
  re-verification step rather than let a same-author pass trivially confirm
  itself — see `PHASE2_PILOT_DRAFT.md`.
- Independent re-verification against fresh Gold queries: 17/23 claims
  verified, 3 dropped (100% of injected claims caught), 3 flagged —
  including two problems that were *not* injected: a policy-bias claim that
  inverted its own correctly-transcribed numbers once cross-checked against
  the current effective rate, and a "high confidence" assertion that
  contradicted the draft's own noted data gap three sections later. Full
  table, cleaned output, and findings in `PHASE2_PILOT_VERIFICATION.md`.
- Not wired into `MPUB`'s UI queue — per plan, this phase stayed a manual,
  one-off exercise.

Deliverable: a written verification report, not a shipped feature. **Met.**
The report's own recommendation: the concept is sound enough to justify
Phase 3, not yet proven unattended enough to wire into `MPUB` live.

### Phase 3: Decide on items 3-4

- Only after Phase 2's re-verification contract is proven, evaluate whether
  a material-change detector (item 3) or a `DashboardSpec` chart-authoring
  adapter (item 4) is worth building, each requiring its own spec.

### Phase 4: IBAL model-plugin pilot (item 6) — completed 2026-09-17, PR #94

- QuantSmith branch `feature/ibal-model-plugin-pilot` registered `IBAL` in
  local, gitignored `model_plugins.yml`, produced one
  `model_plugin_registration` understanding brief, invoked the real IBAL REST
  API once with synthetic data, independently re-verified the reported numbers
  against IBAL's own API response, and produced a written pilot report.
- The deliverable stayed artifact-only, matching the intended Phase 2 pilot
  shape: no shipped feature, no live wiring, no dispatcher, no real book/request
  data in QuantSmith, and no QuantSmith-originated number accepted without
  rechecking against the IBAL response.
- Remaining QuantSmith-side decision: whether a future spec should add an
  executable `model_plugin` dispatcher now that IBAL exists as a concrete REST
  target.

## Decisions Before Implementation

| Decision | Recommendation |
| --- | --- |
| Runtime boundary | QuantSmith never runs inside Market Terminal's Node/Vite process; artifact/API boundary only |
| Numeric trust | Every number from a QuantSmith artifact is re-resolved against `GoldStore` (or, for item 6, against `IBAL`'s own API response) or dropped; never displayed as-is |
| First pilot package | Pre-Market Brief (`MPUB`), narrowest package type in spec004 |
| First pilot agent | `morning_brief_writer` or `macro_backdrop_summarizer` |
| News/commentary sources | Treated as Tier B live exception category, still requires its own spec004 Source Gate decision |
| Trading/portfolio/backtest agent families | Out of scope for Market Terminal entirely — reaffirmed on the 2026-09-17 revisit; the only exception is item 6, which does not import solver/formulation/portfolio-construction agents, only a review layer over an already-built, already-pinned engine |
| QuantSmith's own securities-lending runtime (spec `0023`) | Not adopted; `IBAL` already solves this at a higher standard of rigor (item 6) |
| IBAL as a QuantSmith model plugin (spec `0026`, item 6) | Boundary revisit approved; implementation blocked on spec `0026`'s dispatcher (QuantSmith-side) or a manual first pilot (Phase 4) |
| Version tracking | Adopt spec `0047`'s downstream-consumer pattern even without a Python package install |
| Alerting | Reference architecture only in Phase 0-2; no delivery wiring until a later spec |

## Risks And Pitfalls

- **Borrowed authority:** a fluent agent-written draft can read as more
  verified than it is. The re-verification step (Phase 2) exists specifically
  to prevent an unverified claim from inheriting Market Terminal's Gold-only
  trust signal.
- **Drift between repos:** QuantSmith ships frequent spec-numbered changes;
  without Phase 1's pin-freshness check, a synergy built against one
  QuantSmith commit can silently rot.
- **Scope creep toward a merged system:** the two repos solve adjacent but
  different problems (quant research SDK vs. market display terminal).
  Treating this spec as a reason to import QuantSmith wholesale would violate
  both repos' own reproducibility/no-fallback principles by adding an
  unreviewed dependency surface.
- **Source-gate bypass:** it would be easy to treat "QuantSmith already
  integrates this provider" as equivalent to Market Terminal approval. It is
  not — spec004's Source Gate applies regardless of what QuantSmith already
  trusts.
- **Model-plugin scope creep (item 6):** registering `IBAL` as reviewable
  should not be read as license for QuantSmith's optimization agents to
  modify, re-tune, or "improve" `IBAL`'s formulation — they may only review
  or report on a result `IBAL` itself produced. Real IBAL book/request data
  must stay out of QuantSmith's repository even in the gitignored local
  `model_plugins.yml`; use synthetic or already-public example data for any
  pilot, matching `IBAL`'s own `tests/edge_cases.py` synthetic fixtures rather
  than a real book.

## Related Documents

- `docs/specs/spec005/QUANTSMITH_PIN.md` (Phase 1 commit pin record)
- `docs/specs/spec005/PHASE2_PILOT_DRAFT.md` (Phase 2 raw agent draft, unverified)
- `docs/specs/spec005/PHASE2_PILOT_VERIFICATION.md` (Phase 2 verification report and findings)
- `docs/specs/spec004/SPEC.md` (`MPUB`, the primary consumer for item 2/3/4)
- `docs/specs/spec009/SPEC.md` (draft: queued, attended automation of items 2 and 4)
- `services/inventory_optimizer_api/tests/VALIDATION.md` (`IBAL`'s own backend
  test/validation status, primary source for item 6)
- `docs/handoff.md` (`IBAL` narrative and current state)
- `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`
- `docs/gold-db/README.md`, `docs/gold-db/MODULE_DATA_AUDIT.md`
- `../agentic_workflows/qf_workflow_sdk_public/README.md`
- `../agentic_workflows/qf_workflow_sdk_public/specs/0045-fred-point-in-time/spec.md`
- `../agentic_workflows/qf_workflow_sdk_public/specs/0047-downstream-contract/spec.md`
- `../agentic_workflows/qf_workflow_sdk_public/specs/0059-morning-market-brief/spec.md`
- `../agentic_workflows/qf_workflow_sdk_public/agents/economists/README.md`
- `../agentic_workflows/qf_workflow_sdk_public/instructions/engineering_principles.md`
- `../agentic_workflows/qf_workflow_sdk_public/specs/0026-model-plugin-adapter/spec.md`
  (item 6's mechanism)
- `../agentic_workflows/qf_workflow_sdk_public/specs/0023-securities-lending-workflow/spec.md`
  (the runtime item 6 explicitly does not adopt)
- `../agentic_workflows/qf_workflow_sdk_public/agents/optimization/README.md`
  (the general toolkit that stays out of scope)
