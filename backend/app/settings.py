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

    # P1 persistence: a single embedded SQLite file (stars / custom items /
    # seen-ids / conversations). Relative paths resolve against the backend's
    # CWD (uvicorn is run from backend/). The file is gitignored (*.sqlite).
    sqlite_path: str = "myal1s.sqlite"

    # P1 chat model picker — a registry of selectable models, comma-separated
    # `Label:model-string` pairs. The first entry is the default. Model strings
    # follow the same provider-prefixed form as llm_model (e.g.
    # `anthropic:claude-opus-4-8`, `openai:kimi-k2.6`). Example:
    #   "Claude:anthropic:claude-opus-4-8, Kimi:openai:kimi-k2.6"
    chat_models: str = "Claude:anthropic:claude-opus-4-8"

    @property
    def chat_model_entries(self) -> list[tuple[str, str]]:
        """Parse `chat_models` into `[(label, model_string), ...]`.

        Each entry is `Label:model-string`; the colon-split is on the FIRST
        colon so a model string like `anthropic:claude-opus-4-8` stays intact.
        Blank entries are skipped.
        """
        entries: list[tuple[str, str]] = []
        for raw in self.chat_models.split(","):
            raw = raw.strip()
            if not raw:
                continue
            label, sep, model = raw.partition(":")
            if not sep or not model:
                continue
            entries.append((label.strip(), model.strip()))
        return entries


@lru_cache
def get_settings() -> Settings:
    return Settings()
