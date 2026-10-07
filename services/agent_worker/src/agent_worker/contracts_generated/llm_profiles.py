# GENERATED from contracts/agent/llm-profiles.schema.json by scripts/generate-agent-contracts.mjs.
# Do not edit by hand; run `npm run generate:agent-contracts`.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, constr
from typing_extensions import TypeAliasType


class ApiStyle(StrEnum):
    anthropic_messages = 'anthropic_messages'
    openai_chat_completions = 'openai_chat_completions'
    none = 'none'


HeaderEnvsAdditionalProperty = TypeAliasType(
    "HeaderEnvsAdditionalProperty",
    Annotated[str, Field(max_length=64, pattern='^[A-Z][A-Z0-9_]*$')],
)


class DataClass(StrEnum):
    public_market_data = 'public_market_data'
    module_context = 'module_context'
    desk_simulated = 'desk_simulated'


class Use(StrEnum):
    copilot = 'copilot'
    interpreter = 'interpreter'
    narrator = 'narrator'
    drafter = 'drafter'


class FallbackProfile(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z][a-z0-9\\-]*$')]


class Scheme(StrEnum):
    provider_default = 'provider_default'
    bearer = 'bearer'
    header = 'header'
    none = 'none'


class Auth(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    scheme: Scheme
    credential_env: Annotated[
        str | None, Field(max_length=64, pattern='^[A-Z][A-Z0-9_]*$')
    ] = None
    header_name: Annotated[
        str | None, Field(max_length=64, pattern='^[A-Za-z0-9\\-]+$')
    ] = None


class DailyTokenBudget(RootModel[int]):
    root: Annotated[int, Field(ge=1)]


class ProfileLimits(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    max_output_tokens: Annotated[int, Field(ge=1, le=32000)]
    timeout_ms: Annotated[int, Field(ge=1000, le=600000)]
    max_retries: Annotated[int, Field(ge=0, le=5)]
    per_job_token_cap: Annotated[int, Field(ge=1)]
    daily_token_budget: DailyTokenBudget | None


class Profile(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    enabled: bool
    label: Annotated[str, Field(max_length=80, min_length=1)]
    api_style: ApiStyle
    model: Annotated[
        str | None,
        Field(
            max_length=128, min_length=1, pattern='^[A-Za-z0-9][A-Za-z0-9._:/@\\-]*$'
        ),
    ] = None
    model_env: Annotated[
        str | None, Field(max_length=64, pattern='^[A-Z][A-Z0-9_]*$')
    ] = None
    base_url_env: Annotated[
        str | None, Field(max_length=64, pattern='^[A-Z][A-Z0-9_]*$')
    ] = None
    auth: Auth | None = None
    header_envs: (
        dict[constr(pattern=r'^[A-Za-z0-9\-]+$'), HeaderEnvsAdditionalProperty] | None
    ) = None
    limits: ProfileLimits | None = None
    data_classes: Annotated[list[DataClass], Field(min_length=1)]
    uses: list[Use]
    fallback_profile: FallbackProfile | None = None


class LlmProfilesConfig(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['llm-profiles/1']
    default_profile: Annotated[str, Field(pattern='^[a-z][a-z0-9\\-]*$')]
    default_profile_env: Annotated[
        str | None, Field(max_length=64, pattern='^[A-Z][A-Z0-9_]*$')
    ] = None
    profiles: Annotated[
        dict[constr(pattern=r'^[a-z][a-z0-9\-]*$'), Profile], Field(min_length=1)
    ]
