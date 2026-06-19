"""Unit tests for build_model: the env-default path vs. custom base URL / key.

Pure construction — no network. A dummy API key is set in conftest so provider
clients construct.
"""

from __future__ import annotations

from app.llm import build_model
from app.settings import Settings


def test_default_returns_model_string() -> None:
    # No base_url / api_key -> let pydantic-ai infer from env (unchanged).
    # Null both explicitly so an ambient .env (e.g. a configured relay) doesn't
    # bleed into this test.
    model = build_model(
        Settings(llm_model="anthropic:claude-opus-4-8", llm_base_url=None, llm_api_key=None)
    )
    assert model == "anthropic:claude-opus-4-8"


def test_anthropic_base_url_builds_anthropic_model() -> None:
    from pydantic_ai.models.anthropic import AnthropicModel

    model = build_model(
        Settings(
            llm_model="anthropic:claude-opus-4-8",
            llm_base_url="https://relay.example.com",
            llm_api_key="relay-key",
        )
    )
    assert isinstance(model, AnthropicModel)


def test_openai_prefix_builds_openai_chat_model() -> None:
    from pydantic_ai.models.openai import OpenAIChatModel

    model = build_model(
        Settings(
            llm_model="openai:claude-3-5-sonnet",
            llm_base_url="https://relay.example.com/v1",
            llm_api_key="relay-key",
        )
    )
    assert isinstance(model, OpenAIChatModel)


def test_api_key_only_also_triggers_custom_provider() -> None:
    # Even without base_url, an explicit key routes through a built provider.
    from pydantic_ai.models.anthropic import AnthropicModel

    model = build_model(
        Settings(llm_model="anthropic:claude-opus-4-8", llm_api_key="explicit-key")
    )
    assert isinstance(model, AnthropicModel)
