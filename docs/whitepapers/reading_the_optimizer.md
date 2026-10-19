# Reading the Inventory Optimizer

> **Superseded (2026-10-19).** IBAL is implemented. For how it works today read the as-built guides:
> `docs/guides/optimization/ibal-whitepaper.md` and `docs/guides/optimization/ibal-help.md` (also in the
> terminal under **Guide** on the InventoryBallast page). This page is kept as the original design note.

**Status:** Design draft — pending spec013 approval; not implemented.
**Parent:** InventoryBallast 0018 REQ-011–015 and REQ-041.

## Application

IBAL guides an analyst from a base lending book through a controlled shock, diagnosis, and comparison. It helps interpret a verified optimization result; it does not replace the engine or make a trading decision.

## Mechanics

The terminal sends a typed request to the pinned InventoryBallast service. The service validates, compiles, solves, and independently verifies the result. A capability manifest determines which controls are available. The UI displays allocation, disclosure, diagnostics, and scenario comparisons from service outputs, with request/run hashes and source labels.

## Interpretation and limitations

A binding row identifies a constraint at its configured bound; a shadow value is interpreted under the solve formulation and the engine's declared availability. Infeasibility explanations and scenario deltas are diagnostic evidence, not automatic repairs or forecasts. A presenter sequence is only as complete as the pinned engine's capabilities and the selected synthetic books. Production and governance gates remain disabled.

## Validation

The as-built paper will cite each panel's contract, a worked scenario pinned to a service golden test, viewport/keyboard evidence, and explicit unsupported-capability examples.
