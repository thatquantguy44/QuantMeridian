"""ECOIQ worker contract.

The worker receives governed Gold evidence from QuantMeridian. It never queries the
macro database directly and it must keep observations, mechanism hypotheses, and
conditional scenarios as separate stages.
"""

from dataclasses import dataclass
from typing import Literal

Workflow = Literal["economics.explain", "economics.transmission", "economics.scenario"]


@dataclass(frozen=True)
class EcoIqStage:
    agent: str
    purpose: str


ECOIQ_STAGES: tuple[EcoIqStage, ...] = (
    EcoIqStage("economists.macro_indicator_analyst", "release, vintage, and surprise context"),
    EcoIqStage("economists.monetary_policy_analyst", "policy stance and rate-path context"),
    EcoIqStage("asset_classes.fixed_income_rates", "curve mechanics and rate transmission"),
    EcoIqStage("economists.macro_regime_classifier", "regime and confidence framing"),
    EcoIqStage("economists.cross_asset_macro_linkages", "conditional cross-asset effects"),
    EcoIqStage("economists.macro_scenario_analyst", "explicit forward scenarios when requested"),
)


def build_ecoiq_directive(workflow: Workflow, question: str) -> dict[str, object]:
    """Return a deterministic, auditable directive for the pinned QuantSmith worker."""
    return {
        "module": "ECOIQ",
        "workflow": workflow,
        "question": question[:2000],
        "stages": [{"agent": s.agent, "purpose": s.purpose} for s in ECOIQ_STAGES],
        "output_schema": {
            "claims": [{"id": "string", "type": "observation|mechanism|effect|alternative|falsifier", "text": "string", "evidenceIds": ["gold evidence id"], "confidence": "high|medium|low"}],
            "stages": [{"agent": "string", "status": "completed|failed", "summary": "string", "evidenceIds": ["gold evidence id"]}],
        },
        "rules": [
            "Use only evidence rows supplied by the Gold reader.",
            "Label observations, mechanism hypotheses, alternatives, and falsifiers separately.",
            "Do not claim causation from correlation without an identification design.",
            "Do not invent values, releases, probabilities, or effect sizes.",
            "Return JSON matching output_schema; reject any claim without evidenceIds.",
        ],
    }
