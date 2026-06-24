"""Deterministic data endpoints (**the no-LLM path**).

These handlers call MCP tools *directly* via the gateway and return the result
envelope. This module deliberately imports **no agent and no LLM** — architecture
decision #3 ("deterministic data never passes through the LLM") is enforced
structurally by what this file is allowed to touch, not by convention.

Each route also maintains a **snapshot cache** in the Store (Seam 5): on a
successful live fetch it writes the envelope; on a ``needs_otp`` / ``error``
(= not logged in, or the teaching network is unreachable) it falls back to the
last good snapshot so the dashboard still shows yesterday's data (marked
``stale``) instead of going blank. This is what survives a backend restart.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["deterministic"])


def _gateway(request: Request):
    return request.app.state.gateway


def _store(request: Request):
    return request.app.state.store


async def _cached(
    request: Request, key: str, tool: str, args: dict[str, Any] | None = None
) -> dict:
    """Live-or-snapshot: call the live tool; on success write a snapshot and
    return it; on needs_otp/error, return the cached snapshot (marked stale) if
    one exists, else the original degrade envelope. Never raises."""
    env = await _gateway(request).call_tool(tool, args)
    if env.get("status") == "ok":
        await _store(request).put_snapshot(key, env)
        return env
    # Live unavailable — try the last good snapshot.
    snap = await _store(request).get_snapshot(key)
    if snap is not None:
        payload = dict(snap["payload"])  # the previously-ok envelope
        payload["stale"] = True
        payload["fetched_at"] = snap["fetched_at"]
        return payload
    return env  # no snapshot yet — surface the needs_otp/error as-is


@router.get("/course-table")
async def course_table(request: Request) -> dict:
    """Current-semester personal course table (envelope: ok|needs_otp|stale-ok)."""
    return await _cached(request, "course_table", "get_course_table")


@router.get("/assignments")
async def assignments(request: Request, include_finished: bool = False) -> dict:
    """Assignments with deadlines, sorted by DDL; unfinished only by default."""
    return await _cached(
        request,
        "assignments",
        "list_assignments",
        {"include_finished": include_finished},
    )


@router.get("/grades")
async def grades(request: Request) -> dict:
    """Published grade items for current-semester courses."""
    return await _cached(request, "grades", "get_grades")


@router.get("/announcements")
async def announcements(request: Request) -> dict:
    """Course announcements, newest-first (envelope: ok|needs_otp|stale-ok)."""
    return await _cached(request, "announcements", "get_announcements")


@router.get("/materials")
async def materials(request: Request) -> dict:
    """Course content-tree items (excluding assignments/announcements), read-only."""
    return await _cached(request, "materials", "list_course_materials")


@router.get("/videos")
async def videos(request: Request) -> dict:
    """Course replay video listings, read-only."""
    return await _cached(request, "videos", "list_videos")


@router.get("/treehole")
async def treehole(request: Request) -> dict:
    """北大树洞通知（read-only, no LLM）—— 轻量替代全量爬取。返回关注帖子的未读
    计数 + 最近通知消息 + 收藏夹。需要树洞自己的认证（IAAA OTP → JWT + 令牌验证门）。"""
    gw = _gateway(request)
    # 并行取未读数 + 通知列表。
    import asyncio
    unread, messages = await asyncio.gather(
        gw.call_tool("treehole_unread", {"message_type": "int_msg"}),
        gw.call_tool("treehole_messages", {"message_type": "int_msg", "page": 1}),
        return_exceptions=True,
    )
    # 任一返回 needs_otp / needs_treehole_token → 透传该状态。
    for r in (unread, messages):
        if isinstance(r, dict) and r.get("status") in ("needs_otp", "needs_treehole_token"):
            return r
    count = unread.get("data", {}).get("count", 0) if isinstance(unread, dict) else 0
    msgs = messages.get("data", {}).get("messages", []) if isinstance(messages, dict) else []
    return {"status": "ok", "data": {"unread": count, "messages": msgs}}
