"""Agent chat endpoint (the LLM path), extended in P1.

P0 ran the agent single-shot with a fixed model. P1 adds:
- a **model picker** — `model` (a provider-prefixed string) resolved per request
  via [`build_model_for`], defaulting to the agent's model when unset or invalid;
- **persistent multi-turn conversations** — `conversation_id` loads the stored
  message history (`message_history=`), and the new turn is persisted so the
  thread can be reopened exactly;
- a **tool-call trace** — derived from `result.all_messages()` so the UI can show
  what the agent did ("思考可见");
- conversation-management endpoints (`GET /conversations`, `GET /conversations/{id}`,
  `DELETE /conversations/{id}`) and `GET /models` for the picker dropdown.

Non-streaming for now; streaming over WebSocket remains a fast-follow (P4).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from pydantic_ai.messages import ModelRequest, ModelResponse, ToolCallPart, ToolReturnPart

from ..llm import build_model_for
from ..settings import get_settings

router = APIRouter(prefix="/api", tags=["chat"])
log = logging.getLogger("myal1s.chat")


class ChatIn(BaseModel):
    message: str
    model: str | None = None  # provider-prefixed string from the picker; None = agent default
    conversation_id: str | None = None  # None = start a new conversation
    attachment_file_id: str | None = None  # P2: a chat-attached file's id, for the write tool


class ChatOut(BaseModel):
    reply: str
    trace: list[dict[str, Any]]
    conversation_id: str


def _trace(messages: list) -> list[dict[str, Any]]:
    """Flatten the agent's message stream into a display-friendly tool trace:
    each tool call and its return, in order. Non-tool messages are skipped."""
    out: list[dict[str, Any]] = []
    for m in messages:
        parts = getattr(m, "parts", None) or []
        for p in parts:
            if isinstance(p, ToolCallPart):
                out.append({"type": "tool_call", "tool": p.tool_name, "args": p.args})
            elif isinstance(p, ToolReturnPart):
                out.append({"type": "tool_result", "tool": p.tool_name, "content": _stringify(p.content)})
    return out


def _stringify(value: Any) -> str:
    """Best-effort coerce a tool return value to a short string for the trace."""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


@router.post("/chat", response_model=ChatOut)
async def chat(body: ChatIn, request: Request) -> ChatOut:
    agent = request.app.state.gateway.agent
    store = request.app.state.store
    settings = get_settings()

    # Resolve the picked model (None on any failure -> agent default).
    model: Any = None
    if body.model:
        try:
            model = build_model_for(body.model, settings)
        except Exception as e:  # unknown provider etc. -> degrade, don't 500
            log.warning("model picker rejected %r: %r — using agent default", body.model, e)
            model = None

    # Load (or create) the conversation and its history.
    conv_id = body.conversation_id
    history: list = []
    first_turn = True
    if conv_id and await store.conversation_exists(conv_id):
        history = await store.get_history(conv_id)
        first_turn = len(history) == 0
    else:
        conv_id = await store.create_conversation(title=body.message[:48])

    # P2: if the user attached a file this turn, inject its opaque file_id into
    # the message text so the agent can pass it to submit_assignment. The file_id
    # (never a path) is the only handle the LLM ever sees.
    message = body.message
    if body.attachment_file_id:
        uploads = request.app.state.uploads
        fname = uploads.filename_for(body.attachment_file_id) or body.attachment_file_id
        message = (
            f"{message}\n\n（已上传附件：{fname}，file_id={body.attachment_file_id}。"
            "如需交作业请用此 file_id 调用 submit_assignment。）"
        )

    try:
        result = await agent.run(
            message, model=model, message_history=history if history else None
        )
    except Exception as e:
        # Degrade gracefully: the run can fail on an LLM error, a tool error,
        # or a relay that rejects the picked model. Keep the UI usable and log
        # the detail server-side. The conversation is still created so the user
        # can retry into the same thread.
        log.exception("agent.run failed")
        return ChatOut(
            reply=(
                "抱歉，这次没能完成。可能原因：教学网未登录（请在顶部登录条用 OTP 登录一次）、"
                "当前网络/证书无法访问教学网、所选模型服务异常或不支持。可以换个问题、换个模型或稍后重试。"
                f"\n(技术细节: {type(e).__name__})"
            ),
            trace=[],
            conversation_id=conv_id,
        )

    reply = result.output
    trace = _trace(result.all_messages())

    # Persist this turn: split new_messages into the user request + the response
    # tail, so get_history() concatenation yields a valid message_history and
    # get_messages() yields display-shaped user/assistant pairs.
    new = list(result.new_messages())
    request_slice = [new[0]] if new and isinstance(new[0], ModelRequest) else []
    rest_slice = new[len(request_slice):]
    await store.add_message(conv_id, "user", body.message, request_slice)
    await store.add_message(conv_id, "assistant", reply, rest_slice)
    # Title from the first user turn; subsequent turns only bump updated_at.
    if first_turn:
        await store.touch_conversation(conv_id, title=body.message[:48])
    else:
        await store.touch_conversation(conv_id)

    return ChatOut(reply=reply, trace=trace, conversation_id=conv_id)


# ---- conversation management ---------------------------------------------


@router.get("/conversations")
async def list_conversations(request: Request) -> dict:
    return {"conversations": await request.app.state.store.list_conversations()}


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str, request: Request) -> dict:
    store = request.app.state.store
    if not await store.conversation_exists(conv_id):
        raise HTTPException(status_code=404, detail="conversation not found")
    return {
        "id": conv_id,
        "messages": await store.get_messages(conv_id),
    }


@router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str, request: Request) -> dict:
    store = request.app.state.store
    ok = await store.delete_conversation(conv_id)
    if not ok:
        raise HTTPException(status_code=404, detail="conversation not found")
    return {"status": "ok", "deleted": conv_id}


# ---- model picker --------------------------------------------------------


@router.get("/models")
async def models() -> dict:
    """The selectable models for the chat picker, in order (first = default)."""
    entries = get_settings().chat_model_entries
    return {"models": [{"label": label, "model": model} for label, model in entries]}
