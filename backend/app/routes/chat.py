"""Agent chat endpoint (the LLM path).

Runs the PydanticAI agent, whose tools are the same MCP tools the deterministic
routes call — but here the LLM decides which to call and synthesizes an answer.
Non-streaming for P0; streaming over WebSocket is a fast-follow.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["chat"])


class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    reply: str


@router.post("/chat", response_model=ChatOut)
async def chat(body: ChatIn, request: Request) -> ChatOut:
    agent = request.app.state.gateway.agent
    result = await agent.run(body.message)
    return ChatOut(reply=result.output)
