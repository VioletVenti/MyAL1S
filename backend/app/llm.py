"""Build the PydanticAI model from settings, with optional custom base URL / key.

Default (no `llm_base_url` / `llm_api_key`): return the model string and let
PydanticAI infer the provider + credentials from the environment — unchanged
behaviour.

With a custom base URL and/or key (e.g. a proxy / relay / gateway — common for
accessing Claude where the official endpoint isn't directly reachable):
construct the provider explicitly so the endpoint and key are honoured. Both
Anthropic-compatible (`anthropic:` prefix, `/v1/messages`) and OpenAI-compatible
(`openai:` prefix, `/v1/chat/completions`) relays are supported.
"""

from __future__ import annotations

from typing import Any

from .settings import Settings

# Model-string prefixes routed through the OpenAI chat-completions client.
_OPENAI_PREFIXES = {"openai", "openai-chat", "openai-compatible"}


def build_model(settings: Settings) -> Any:
    """Return a PydanticAI model string (env-based) or a configured Model."""
    provider_name, sep, model_name = settings.llm_model.partition(":")
    if not sep:  # no prefix, e.g. "claude-opus-4-8" -> assume Anthropic
        provider_name, model_name = "anthropic", settings.llm_model

    # No custom endpoint/key -> keep the simple, env-driven default.
    if not settings.llm_base_url and not settings.llm_api_key:
        return settings.llm_model

    base_url = settings.llm_base_url or None
    api_key = settings.llm_api_key or None  # None -> provider falls back to env

    if provider_name == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        provider = AnthropicProvider(api_key=api_key, base_url=base_url)
        return AnthropicModel(model_name, provider=provider)

    if provider_name in _OPENAI_PREFIXES:
        try:
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "OpenAI 兼容模型需要额外依赖：pip install 'pydantic-ai-slim[openai]'"
            ) from e

        provider = OpenAIProvider(base_url=base_url, api_key=api_key)
        return OpenAIChatModel(model_name, provider=provider)

    raise RuntimeError(
        f"自定义 base_url 暂不支持 provider '{provider_name}'："
        " 目前支持 'anthropic:' 与 'openai:'(兼容) 前缀。"
    )
