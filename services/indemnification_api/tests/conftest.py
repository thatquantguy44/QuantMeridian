import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts" / "indemnification"
SCHEMA_FILES = [
    "closeout-profile-1.0.schema.json",
    "rating-pd-table-1.0.schema.json",
    "model-card-1.0.schema.json",
    "snapshot-1.0.schema.json",
    "result-1.0.schema.json",
]


def load(relative: str):
    return json.loads((CONTRACTS / relative).read_text("utf-8"))


@pytest.fixture(scope="session")
def schemas():
    return {name: load(name) for name in SCHEMA_FILES}


@pytest.fixture(scope="session")
def validator_for(schemas):
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )

    def build(name: str) -> Draft202012Validator:
        return Draft202012Validator(schemas[name], registry=registry)

    return build


@pytest.fixture(scope="session")
def snapshot():
    return load("fixtures/snapshot.example.json")
