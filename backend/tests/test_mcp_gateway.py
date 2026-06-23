"""Integration + structural tests for the MCP gateway.

The integration tests spawn the *real* `pku3b mcp` subprocess (no mocks, in the
spirit of pku3b's own test style) and skip themselves if the binary hasn't been
built. They need no PKU credentials: tools that require a live login return a
`needs_otp` / `error` envelope rather than failing.
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from app.mcp_gateway import McpGateway
from app.settings import Settings

_PKU3B_DIR = Path(__file__).resolve().parents[2] / "pku3b" / "target"
_BIN_CANDIDATES = [_PKU3B_DIR / "release" / "pku3b", _PKU3B_DIR / "debug" / "pku3b"]


def _binary() -> str | None:
    return next((str(p) for p in _BIN_CANDIDATES if p.exists()), None)


requires_binary = pytest.mark.skipif(
    _binary() is None,
    reason="pku3b mcp binary not built (cd pku3b && cargo build --features mcp)",
)


@pytest.fixture
def settings() -> Settings:
    return Settings(pku3b_bin=_binary() or "pku3b")


@requires_binary
async def test_raw_catalog_includes_submit_primitive(settings: Settings) -> None:
    """The raw MCP catalog (tools/list) includes `submit_assignment` — the
    side-effecting execution primitive the backend's permission gate dispatches to
    directly. It is hidden from the *agent* toolset separately (asserted in
    Increment D, test_agent_toolset_hides_submit_primitive); the raw server still
    exposes it so `gateway.call_tool` can reach it. Its `read_only: false` is
    asserted on the pku3b side; here we only confirm the wire catalog surfaces it
    to a direct caller."""
    gateway = McpGateway(settings)
    async with gateway:
        tools = await gateway._server.list_tools()
    names = {t.name for t in tools}
    assert {"get_course_table", "list_assignments", "get_grades"} <= names
    assert "submit_assignment" in names


@requires_binary
async def test_call_tool_returns_status_envelope(settings: Settings) -> None:
    gateway = McpGateway(settings)
    async with gateway:
        env = await gateway.call_tool("get_course_table")
    assert isinstance(env, dict)
    # ok (warm session) | needs_otp (cold) | error (not configured) — never a crash.
    assert env.get("status") in {"ok", "needs_otp", "error"}


class _FakeGate:
    """Minimal duck-typed gate for attach_write_toolset wiring tests — the local
    tool closure is built but not invoked here."""

    def uploads_filename_for(self, file_id: str) -> str | None:
        return "x.pdf"

    async def create_approval(self, **kw):  # noqa: ANN003
        return {"status": "pending_approval", "approval_id": "fake"}


class _Td:
    """ToolDefinition stub with just `.name` (all the filter_func inspects)."""

    def __init__(self, name: str) -> None:
        self.name = name


@requires_binary
async def test_agent_toolset_hides_submit_primitive(settings: Settings) -> None:
    """The path-based submit_assignment MCP primitive is hidden from the agent
    (it gets a file_id proxy instead), but the raw server still exposes it and
    gateway.call_tool still dispatches it directly (for the UI / gate path)."""
    gateway = McpGateway(settings)
    async with gateway:
        gateway.attach_write_toolset(_FakeGate())
        # 1. The raw MCP server still lists the path primitive.
        raw = {t.name for t in await gateway._server.list_tools()}
        assert "submit_assignment" in raw
        # 2. The agent's filtered server view DROPS it; read tools survive.
        ff = gateway._filtered.filter_func
        assert ff(None, _Td("submit_assignment")) is False
        assert ff(None, _Td("list_assignments")) is True
        # 3. The local write toolset exposes the file_id proxy under the same name,
        #    and its parameters are {assignment_id, file_id} — NEVER file_path. This
        #    is the security-critical half of "hiding the primitive": the LLM must
        #    not see any tool parameter that names a server-local path.
        assert "submit_assignment" in gateway._write_ts.tools
        schema = gateway._write_ts.tools["submit_assignment"].tool_def.parameters_json_schema
        param_names = set(schema.get("properties", {}).keys())
        assert param_names == {"assignment_id", "file_id"}
        assert "file_path" not in param_names and "path" not in param_names
        # 4. gateway.call_tool still reaches the primitive directly — a missing
        #    file fails BEFORE any login (deterministic, no network needed).
        env = await gateway.call_tool(
            "submit_assignment", {"assignment_id": "x", "file_path": "/nonexistent"}
        )
        assert env["status"] == "error"


def test_deterministic_route_cannot_reach_the_llm() -> None:
    """Architecture decision #3, enforced structurally: the deterministic
    module must not import the LLM library. AST-based so a docstring that merely
    *mentions* `pydantic_ai` does not trip a naive substring check (consistent
    with test_composer.py::test_composer_and_dashboard_route_cannot_reach_the_llm)."""
    import ast

    import app.routes.deterministic as det

    src = inspect.getsource(det)
    assert ".agent" not in src  # never touches the agent
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            assert not any(
                a.name == "pydantic_ai" or a.name.startswith("pydantic_ai.") for a in node.names
            ), "deterministic.py imports pydantic_ai"
        elif isinstance(node, ast.ImportFrom):
            assert not (
                node.module and (node.module == "pydantic_ai" or node.module.startswith("pydantic_ai."))
            ), "deterministic.py imports pydantic_ai"
