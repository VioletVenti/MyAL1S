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


async def _cached_route(request: Request, key: str, coro_factory):
    """Snapshot-cache wrapper for composer-backed routes. `coro_factory` is a
    no-arg callable returning an awaitable that yields the route's `data` dict.
    On success, persists the full envelope; on failure (timeout, exception),
    serves the stale snapshot if available. This prevents slow MCP crawls from
    hanging the frontend's loading state."""
    try:
        data = await coro_factory()
        env = {"status": "ok", "data": data}
        await _store(request).put_snapshot(key, env)
        return env
    except Exception:
        snap = await _store(request).get_snapshot(key)
        if snap:
            return {**snap["payload"], "stale": True, "fetched_at": snap["fetched_at"]}
        raise


@router.get("/todo")
async def todo(request: Request) -> dict:
    """The 待办 module: starred assignments + starred announcements + custom
    items, unified and sorted by anchor date."""
    async def make():
        return {"items": await _composer(request).todo()}
    return await _cached_route(request, "todo", make)


@router.get("/calendar")
async def calendar(request: Request, week: str | None = None) -> dict:
    """The weekly calendar: course table + the starred/custom items falling in
    the requested ISO week (``YYYY-Www``)."""
    cache_key = f"calendar:{week or 'current'}"
    async def make():
        return await _composer(request).week(week)
    return await _cached_route(request, cache_key, make)


@router.get("/new-notices")
async def new_notices(request: Request) -> dict:
    """Items new since the last mark-seen."""
    async def make():
        return await _composer(request).new_notices()
    return await _cached_route(request, "new_notices", make)


@router.post("/new-notices/mark-seen")
async def mark_seen(request: Request) -> dict:
    await _composer(request).mark_seen()
    return {"status": "ok"}
