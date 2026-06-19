"""Backend configuration, loaded from environment / `.env`.

`load_dotenv()` populates `os.environ` from `.env` so that both these settings
*and* the Anthropic SDK (which reads `ANTHROPIC_API_KEY` directly) see the same
values. The real `.env` is gitignored; only `.env.example` is tracked.
"""

from __future__ import annotations

from functools import lru_cache

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MYAL1S_", extra="ignore")

    # PydanticAI model string; provider-agnostic, default latest Claude.
    llm_model: str = "anthropic:claude-opus-4-8"

    # Optional custom LLM endpoint + key, for a proxy / relay / gateway.
    # When unset, the provider's standard endpoint and env var are used.
    llm_base_url: str | None = None
    llm_api_key: str | None = None

    # Path to the pku3b binary built with `--features mcp`.
    pku3b_bin: str = "../pku3b/target/release/pku3b"

    # Optional explicit pku3b config path (passed as `--config`); None = default.
    pku3b_config: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
