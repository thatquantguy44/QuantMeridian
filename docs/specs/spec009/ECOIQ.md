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
