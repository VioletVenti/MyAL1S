"""Build the PydanticAI model from settings, with optional custom base URL / key.

Default (no `llm_base_url` / `llm_api_key`): return the model string and let
PydanticAI infer the provider + credentials from the environment — unchanged
behaviour.

With a custom base URL and/or key (e.g. a proxy / relay / gateway — common for
accessing Claude where the official endpoint isn't directly reachable):
construct the provider explicitly so the endpoint and key are honoured. Both
Anthropic-compatible (`anthropic:` prefix, `/v1/messages`) and OpenAI-compatible
(`openai:` prefix, `/v1/chat/completions`) relays are supported.

Two entry points share one provider-router:
- [`build_model`] — the agent's default model (from `settings.llm_model`).
- [`build_model_for`] — the chat model picker: a specific model string chosen
  per request (e.g. a cheaper Claude, or a Kimi/OpenAI-compatible relay model),
  reusing the same base_url/api_key.
"""

from __future__ import annotations

from typing import Any

from .settings import Settings

# Model-string prefixes routed through the OpenAI chat-completions client.
_OPENAI_PREFIXES = {"openai", "openai-chat", "openai-compatible"}


def build_model(settings: Settings) -> Any:
    """Return a PydanticAI model string (env-based) or a configured Model."""
    return _build(settings.llm_model, settings.llm_base_url, settings.llm_api_key)


def build_model_for(model_str: str, settings: Settings) -> Any:
    """Return a model for the chat picker's chosen `model_str` (a provider-prefixed
    string like `anthropic:claude-opus-4-8`), reusing the configured base_url/key.
    Raises RuntimeError for an unsupported provider (the caller degrades to the
    agent default)."""
    return _build(model_str, settings.llm_base_url, settings.llm_api_key)


def _build(model_str: str, base_url_cfg: str | None, api_key_cfg: str | None) -> Any:
    provider_name, sep, model_name = model_str.partition(":")
    if not sep:  # no prefix, e.g. "claude-opus-4-8" -> assume Anthropic
        provider_name, model_name = "anthropic", model_str

    # No custom endpoint/key -> keep the simple, env-driven default.
    if not base_url_cfg and not api_key_cfg:
        return model_str

    base_url = base_url_cfg or None
    api_key = api_key_cfg or None  # None -> provider falls back to env

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

