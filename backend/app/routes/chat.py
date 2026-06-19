"""Agent chat endpoint (the LLM path).

Runs the PydanticAI agent, whose tools are the same MCP tools the deterministic
routes call — but here the LLM decides which to call and synthesizes an answer.
Non-streaming for P0; streaming over WebSocket is a fast-follow.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["chat"])
log = logging.getLogger("myal1s.chat")


class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    reply: str


@router.post("/chat", response_model=ChatOut)
async def chat(body: ChatIn, request: Request) -> ChatOut:
    agent = request.app.state.gateway.agent
    try:
        result = await agent.run(body.message)
        return ChatOut(reply=result.output)
    except Exception as e:
        # Degrade gracefully instead of 500: the agent run can fail on an LLM
        # error or a tool error (e.g. the teaching network is unreachable or the
        # session isn't logged in — pydantic-ai escalates a failing tool to an
        # unhandled exception). Keep the UI usable and log the detail server-side.
        log.exception("agent.run failed")
        return ChatOut(
            reply=(
                "抱歉，这次没能完成。可能原因：教学网未登录（请在终端运行 "
                "`pku3b ct` 登录一次）、当前网络/证书无法访问教学网，或模型服务异常。"
                "可以换个问题或稍后重试。"
                f"\n(技术细节: {type(e).__name__})"
            )
        )

