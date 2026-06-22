"""Pending write-approval queue + decide endpoint (**P2** agent path, LLM-free).

`GET /api/approvals[?status=pending]` lists approvals; `POST
/api/approvals/{id}/decide {decision}` confirms or denies a pending one. The
confirm dispatches the write out-of-band through the gate (the agent run that
created the approval has already ended).
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["approvals"])


@router.get("/approvals")
async def list_approvals(request: Request, status: str | None = None) -> dict:
    return {"approvals": await request.app.state.store.list_approvals(status)}


class DecideIn(BaseModel):
    decision: str  # "confirm" | "deny"


@router.post("/approvals/{approval_id}/decide")
async def decide(approval_id: str, body: DecideIn, request: Request) -> dict:
    return await request.app.state.gate.decide(approval_id, body.decision)
