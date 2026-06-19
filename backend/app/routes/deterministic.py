"""Deterministic data endpoints (**the no-LLM path**).

These handlers call MCP tools *directly* via the gateway and return the result
envelope verbatim. This module deliberately imports **no agent and no LLM** —
architecture decision #3 ("deterministic data never passes through the LLM") is
enforced structurally by what this file is allowed to touch, not by convention.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["deterministic"])


def _gateway(request: Request):
    return request.app.state.gateway


@router.get("/course-table")
async def course_table(request: Request) -> dict:
    """Current-semester personal course table (envelope: status ok|needs_otp)."""
    return await _gateway(request).call_tool("get_course_table")


@router.get("/assignments")
async def assignments(request: Request, include_finished: bool = False) -> dict:
    """Assignments with deadlines, sorted by DDL; unfinished only by default."""
    return await _gateway(request).call_tool(
        "list_assignments", {"include_finished": include_finished}
    )


@router.get("/grades")
async def grades(request: Request) -> dict:
    """Published grade items for current-semester courses."""
    return await _gateway(request).call_tool("get_grades")
