"""The MCP gateway (**Seam 4**) — owns the `pku3b mcp` subprocess + the agent.

One `MCPServerStdio` instance is shared by two consumers:
- [`McpGateway.call_tool`] invokes a tool **directly** (no LLM) for the
  deterministic dashboard endpoints;
- [`McpGateway.agent`] is a PydanticAI agent whose toolset is that same server.

`MCPServerStdio.__aenter__` is reference-counted, so the gateway enters the
server once (spawning the subprocess) and the agent re-enters the same instance
per `run()` without re-spawning. The subprocess is torn down on gateway exit.

The small interface (`call_tool` + `agent` + the async-context lifecycle) hides
subprocess management, the MCP handshake, and result unwrapping.
"""

from __future__ import annotations

import json
import os
import tempfile
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

import certifi
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelRetry
from pydantic_ai.mcp import MCPServerStdio

from .llm import build_model
from .settings import Settings

_CERTS_DIR = Path(__file__).resolve().parent.parent / "certs"


def _ca_bundle_path() -> str | None:
    """Combine certifi's CA bundle with the vendored extra CAs in `certs/` and
    return a path for SSL_CERT_FILE. pku3b uses native-tls/OpenSSL, which honours
    SSL_CERT_FILE; course.pku.edu.cn ships an incomplete chain, so the AlphaSSL
    intermediate in `certs/` must be trusted. Returns None when there are no
    extras (the subprocess then uses its default trust store)."""
    extras = sorted(_CERTS_DIR.glob("*.pem"))
    if not extras:
        return None
    fd, path = tempfile.mkstemp(prefix="myal1s-ca-", suffix=".pem")
    with os.fdopen(fd, "wb") as out:
        out.write(Path(certifi.where()).read_bytes())
        for extra in extras:
            out.write(b"\n")
            out.write(extra.read_bytes())
    return path


SYSTEM_PROMPT = """\
你是「MyAL1S」——北京大学校园信息终端助手。

规则:
- 只回答与北大教学网 / 校园信息相关的问题(课表、作业、成绩、公告等)。
- 任何具体数据都必须通过调用工具获取, 绝不凭空编造、猜测或记忆。
- 工具返回的 JSON 信封里 status 字段:
  - "ok": 使用 data 字段作答。
  - "needs_otp": 提示用户点击页面顶部的「连接教学网」输入手机令牌 (OTP) 登录一次,
    之后即可正常查询。**不要**自己调用 login 工具, 也不要编造 OTP——OTP 只能由用户提供。
  - "error": 简要说明出错原因, 建议用户重试或先登录。
- 用中文、简洁地聚焦用户的问题作答; 涉及作业 DDL 时按时间排序并提示紧迫的项。
- 当前为只读阶段: 你没有交作业 / 选课 / 发帖等写操作能力。
"""


class McpGateway:
    def __init__(self, settings: Settings) -> None:
        args: list[str] = []
        if settings.pku3b_config:
            args += ["--config", settings.pku3b_config]
        args.append("mcp")

        # pku3b connects to course.pku.edu.cn, whose TLS chain is incomplete;
        # point its native-tls/OpenSSL at a bundle that includes the missing
        # intermediate. Inherit the rest of the environment (HOME is needed for
        # pku3b's config/cache dirs).
        env = dict(os.environ)
        self._ca_bundle = _ca_bundle_path()
        if self._ca_bundle:
            env["SSL_CERT_FILE"] = self._ca_bundle
        # Surface pku3b's login/session decisions in the backend log (stderr is
        # forwarded). Override via RUST_LOG in the environment if desired.
        env.setdefault("RUST_LOG", "pku3b=info")

        self._server = MCPServerStdio(settings.pku3b_bin, args=args, env=env)
        # NOTE: MCPServerStdio is deprecated in favour of MCPToolset in
        # pydantic-ai v2; pyproject pins <2 so this stays valid for P0.
        self._agent: Agent = Agent(
            build_model(settings),
            system_prompt=SYSTEM_PROMPT,
            toolsets=[self._server],
        )
        self._stack: AsyncExitStack | None = None

    async def __aenter__(self) -> "McpGateway":
        self._stack = AsyncExitStack()
        # Spawn the pku3b mcp subprocess (refcounted; the agent shares it).
        await self._stack.enter_async_context(self._server)
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None
        if self._ca_bundle:
            try:
                os.unlink(self._ca_bundle)
            except OSError:
                pass
            self._ca_bundle = None


    @property
    def agent(self) -> Agent:
        return self._agent

    async def call_tool(self, name: str, args: dict[str, Any] | None = None) -> dict:
        """Call an MCP tool directly (no LLM) and return its result envelope.

        On success the server's `{status: ok|needs_otp, ...}` envelope is
        returned. If the tool reports `isError` (e.g. pku3b not configured),
        pydantic-ai raises `ModelRetry`; we convert that into an `error`
        envelope so the dashboard degrades gracefully instead of returning 500.
        """
        try:
            result = await self._server.direct_call_tool(name, args or {})
        except ModelRetry as e:
            return {"status": "error", "message": str(e)}
        return _as_envelope(result)


def _as_envelope(result: Any) -> dict:
    """Normalize a `direct_call_tool` result into our `{status, ...}` envelope.

    The pku3b server returns both `structuredContent` (the envelope) and a text
    content block carrying the same JSON, so depending on how the MCP client
    surfaces the result we may receive a dict, a JSON string, or a list of
    content parts. Handle all three; fall back to wrapping unknown shapes.
    """
    if isinstance(result, dict) and "status" in result:
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
        return {"status": "ok", "data": result}
    if isinstance(result, list):
        for part in result:
            text = getattr(part, "text", None) or (
                part.get("text") if isinstance(part, dict) else None
            )
            if text:
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        return parsed
                except json.JSONDecodeError:
                    continue
    # Unknown shape — surface it without crashing the endpoint.
    return {"status": "ok", "data": str(result)}
