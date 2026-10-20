"""The complete analysis of a snapshot: the run, the sensitivities and the named stresses (spec020).

This is what the service returns for one request. The main run uses the snapshot's own path count;
the sweeps may use fewer (`sensitivity_paths`). Stresses are deterministic and can take profile
overrides that apply to them alone.
"""

from __future__ import annotations

from typing import Any

from .engine import simulate
from .results import build_result
from .sensitivity import default_sensitivities
from .stress import run_stresses


def run_analysis(
    snapshot: dict[str, Any],
    *,
    sensitivity_paths: int | None = 5000,
    stress_profile_overrides: dict[str, Any] | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    output = simulate(snapshot)
    return build_result(
        snapshot,
        output,
        created_at=created_at,
        sensitivities=default_sensitivities(snapshot, paths=sensitivity_paths),
        stresses=run_stresses(snapshot, profile_overrides=stress_profile_overrides),
    )
