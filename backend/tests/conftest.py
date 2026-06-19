"""Test fixtures. Set a dummy API key so `Agent(...)` constructs without real
credentials — the integration tests never call `agent.run` (no LLM needed)."""

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-dummy")
