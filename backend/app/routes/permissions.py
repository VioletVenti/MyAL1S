"""Permission matrix settings (**P2**, LLM-free).

`GET /api/permissions` returns each known group's level (unset = the
``confirm`` default, resolved client-side); `PUT /api/permissions/{group}
{level}` sets deny/confirm (auto is rejected — reserved for P3).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["permissions"])


@router.get("/permissions")
async def get_permissions(request: Request) -> dict:
    store = request.app.state.store
    groups = [
        {"group": g, "level": await store.permission_level(g)}
        for g in request.app.state.gate.known_groups()
    ]
    return {"groups": groups, "default": "confirm", "valid_levels": ["deny", "confirm"]}


class LevelIn(BaseModel):
    level: str


@router.put("/permissions/{group}")
async def set_level(group: str, body: LevelIn, request: Request) -> dict:
    try:
        await request.app.state.gate.set_level(group, body.level)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "group": group, "level": body.level}
