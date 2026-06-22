"""Deterministic dashboard endpoints (the no-LLM path, P1).

Thin adapters over the Composer (Seam 6) and the Store (Seam 5). Like
``routes/deterministic.py``, this module imports **no agent and no LLM** — the
no-LLM invariant (architecture decision #3) is structural here too (a test
asserts it). The routes only:

- hand star/custom-item/new-notice/calendar requests to the Composer/Store, and
- return the result envelope or the composed shapes verbatim.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..store import SOURCE_ANNOUNCEMENT, SOURCE_ASSIGNMENT

router = APIRouter(prefix="/api", tags=["dashboard"])

# The only sources that may be starred (assignment / announcement). Keeps the
# star endpoint from accepting arbitrary strings.
_STAR_SOURCES = {SOURCE_ASSIGNMENT, SOURCE_ANNOUNCEMENT}


def _composer(request: Request):
    return request.app.state.composer


def _store(request: Request):
    return request.app.state.store


# ---- stars ----------------------------------------------------------------


class StarIn(BaseModel):
    source: str
    item_id: str
    title: str | None = None
    course: str | None = None
    date: str | None = None  # RFC3339 anchor: deadline (assignment) or publish time (announcement)


class StarToggleIn(BaseModel):
    starred: bool


@router.get("/stars")
async def list_stars(request: Request, source: str | None = None) -> dict:
    return {"stars": await _store(request).list_stars(source)}


@router.post("/stars")
async def set_star(body: StarIn, request: Request) -> dict:
    """Idempotently star (or refresh the snapshot of) an item."""
    if body.source not in _STAR_SOURCES:
        raise HTTPException(status_code=400, detail=f"invalid source: {body.source}")
    await _store(request).star(
        body.source, body.item_id, title=body.title, course=body.course, date=body.date
    )
    return {"status": "ok", "starred": True, **body.model_dump()}


@router.delete("/stars/{source}/{item_id}")
async def delete_star(source: str, item_id: str, request: Request) -> dict:
    if source not in _STAR_SOURCES:
        raise HTTPException(status_code=400, detail=f"invalid source: {source}")
    await _store(request).unstar(source, item_id)
    return {"status": "ok", "starred": False, "source": source, "item_id": item_id}


# ---- custom to-do items ---------------------------------------------------


class CustomItemIn(BaseModel):
    title: str
    due: str | None = None
    note: str | None = None
    course: str | None = None
    source: str | None = None  # free-form origin label, e.g. "微信群"


class CustomItemPatch(BaseModel):
    title: str | None = None
    due: str | None = None
    note: str | None = None
    course: str | None = None
    source: str | None = None
    done: bool | None = None


@router.get("/custom-items")
async def list_items(request: Request) -> dict:
    return {"items": await _store(request).list_items()}


@router.post("/custom-items")
async def create_item(body: CustomItemIn, request: Request) -> dict:
    item_id = await _store(request).add_item(
        title=body.title, due=body.due, note=body.note, course=body.course, source=body.source
    )
    return {"status": "ok", "id": item_id}


@router.patch("/custom-items/{item_id}")
async def patch_item(item_id: int, body: CustomItemPatch, request: Request) -> dict:
    ok = await _store(request).update_item(
        item_id,
        title=body.title,
        due=body.due,
        note=body.note,
        course=body.course,
        source=body.source,
        done=body.done,
    )
    if not ok:
        raise HTTPException(status_code=404, detail=f"custom item {item_id} not found")
    return {"status": "ok", "id": item_id}


@router.delete("/custom-items/{item_id}")
async def delete_item(item_id: int, request: Request) -> dict:
    ok = await _store(request).delete_item(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"custom item {item_id} not found")
    return {"status": "ok", "deleted": item_id}


# ---- 待办 ----------------------------------------------------------------


@router.get("/todo")
async def todo(request: Request) -> dict:
    """The 待办 module: starred assignments + starred announcements + custom
    items, unified and sorted by anchor date. Wrapped in the ``{status, data}``
    envelope for consistency with the other deterministic endpoints — the
    frontend consumes it via EnvelopeBody, which dereferences ``data``."""
    return {"status": "ok", "data": {"items": await _composer(request).todo()}}


# ---- weekly calendar -----------------------------------------------------


@router.get("/calendar")
async def calendar(request: Request, week: str | None = None) -> dict:
    """The weekly calendar: course table + the starred/custom items falling in
    the requested ISO week (``YYYY-Www``). Omit ``week`` for the current week.

    Wrapped in ``{status:"ok", data}``; ``data.course_table`` is itself an
    envelope (ok/needs_otp/error) so the frontend can branch on login state
    while still rendering the week's items."""
    return {"status": "ok", "data": await _composer(request).week(week)}


# ---- 新到通知 ------------------------------------------------------------


@router.get("/new-notices")
async def new_notices(request: Request) -> dict:
    """Items new since the last mark-seen: live assignment + announcement ids
    not yet in the seen-id watermark. Wrapped in the ``{status, data}`` envelope
    (the composer already degrades each source to ``[]`` when not logged in, so
    the route status is always ``ok``)."""
    return {"status": "ok", "data": await _composer(request).new_notices()}


@router.post("/new-notices/mark-seen")
async def mark_seen(request: Request) -> dict:
    await _composer(request).mark_seen()
    return {"status": "ok"}
