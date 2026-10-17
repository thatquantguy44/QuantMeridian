# Plan: IBAL Showcase

- **Spec:** spec013-ibal-showcase (SPEC.md)
- **Status:** Draft — pending owner review
- **Last updated:** 2026-10-17

## Approach

The FastAPI service remains the sole owner of optimization and verification. QuantMeridian validates the request, invokes the pinned service through server-only routes, and renders typed result sections. A startup/health response identifies engine version and capabilities. The client derives available controls from this manifest and gives a reason when a capability is absent.

Diagnostics and scenario comparisons are views over service outputs; the frontend does not recompute model rows, objective, or feasibility. Scenario Studio passes a named scenario ID/version/parameters to the engine and renders baseline and stress results. Presenter mode orchestrates the same validated API calls and local deterministic showcase inputs.

## Components

1. Explicit pinned engine source and service capability/health contract.
2. Server-only typed proxy and request/result parity tests.
3. Capability-gated family/formulation controls.
4. Diagnostic tabs backed by result disclosures.
5. Scenario Studio with batch status, rankings, and stable-ID comparison.
6. Presenter flow, warm-up, health banner, and failure controls.
7. Provenance, hash, and production-gate checks.

## Validation

Contract parity and service tests verify the pinned engine. UI tests cover capability combinations, missing/failed service, infeasible result, partial diagnostics, scenario errors, and deterministic presenter navigation. Playwright covers all showcase steps at 375×812, 768×1024, and 1440×900, keyboard operation, console health, overflow, and overlap.

## Sequence

1. Confirm decisions and approve child docs.
2. Review and bump engine pin; verify service health and capability manifest.
3. Implement response contracts and manifest-driven controls.
4. Add diagnostics and Scenario Studio as engine output becomes available.
5. Add presenter sequence after showcase books exist.
6. Close with viewport evidence, white paper, validation record, and updated handoff.
