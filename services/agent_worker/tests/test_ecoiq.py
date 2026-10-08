from agent_worker.ecoiq import ECOIQ_STAGES, build_ecoiq_directive


def test_ecoiq_directive_is_governed_and_bounded() -> None:
    directive = build_ecoiq_directive("economics.explain", "x" * 3000)
    assert directive["module"] == "ECOIQ"
    assert len(directive["question"]) == 2000
    assert len(directive["stages"]) == len(ECOIQ_STAGES)
    assert any("Do not invent" in rule for rule in directive["rules"])
