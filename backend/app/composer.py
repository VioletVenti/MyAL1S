"""The dashboard composer (**Seam 6**) — joins live teaching-network data with
the Store into the three dashboard shapes.

It is the deterministic brain of the dashboard: it pulls live data through the
MCP gateway (`gateway.call_tool` — never the LLM) and merges it with persisted
state (stars / custom items / seen-ids) to produce:

- [`todo`] — the 待办 module: starred assignments + starred announcements + all
  custom items, unified and sorted by their anchor date.
- [`week`] — the weekly calendar: the live course table (the default-clean 课表)
  plus the starred/custom items that fall in the requested ISO week, for the
  per-day click-to-reveal overlay.
- [`new_notices`] / [`mark_seen`] — the 新到通知 panel: live assignment +
  announcement ids that the user has not yet acknowledged, diffed against the
  Store's seen-id watermark.

**Why a module, not pass-through routes:** deleting it would force the
join + diff + ISO-week math to be re-derived in ≥3 route handlers
(`/calendar`, `/todo`, `/new-notices`). It centralizes that knowledge and keeps
the routes thin. Its interface is 4 methods over two injected dependencies; the
implementation is real composition (merge, sort, date-range filter, set diff),
not delegation.

**Deterministic:** this module imports no agent and no `pydantic_ai` — the
no-LLM invariant (architecture decision #3) holds here exactly as it does in
`routes/deterministic.py`. A structural test asserts this.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Protocol

from .store import SOURCE_ANNOUNCEMENT, SOURCE_ASSIGNMENT, Store


class _GatewayLike(Protocol):
    """The slice of McpGateway the Composer needs. Kept as a Protocol so tests
    can pass a fake without spinning up the `pku3b mcp` subprocess."""

    async def call_tool(self, name: str, args: dict[str, Any] | None = None) -> dict: ...


# Live-tool payload keys per source: where the item list lives inside the
# envelope's `data`, and which field holds a stable id.
_SOURCE_TOOL = {
    SOURCE_ASSIGNMENT: {"tool": "list_assignments", "list_key": "assignments", "id_key": "id"},
    SOURCE_ANNOUNCEMENT: {"tool": "get_announcements", "list_key": "announcements", "id_key": "id"},
}


class Composer:
    def __init__(self, store: Store, gateway: _GatewayLike) -> None:
        self._store = store
        self._gateway = gateway

    # ---- 待办 --------------------------------------------------------------

    async def todo(self) -> list[dict]:
        """All starred assignments + starred announcements + custom items, unified
        and sorted by anchor date (undated items last). Renders from Store
        snapshots — no live crawl — so the dashboard is fast and works offline.
        The snapshot is refreshed each time the user (un-)stars an item."""
        items: list[dict] = []
        for s in await self._store.list_stars():
            items.append(
                {
                    "kind": "star",
                    "source": s["source"],
                    "id": s["item_id"],
                    "title": s["title"],
                    "course": s["course"],
                    "date": s["date"],
                }
            )
        for c in await self._store.list_items():
            items.append(
                {
                    "kind": "custom",
                    "id": f"custom:{c['id']}",
                    "custom_id": c["id"],
                    "title": c["title"],
                    "course": c["course"],
                    "date": c["due"],
                    "note": c["note"],
                    "source": c["source"],
                    "done": c["done"],
                }
            )
        # Undated last; otherwise ascending by anchor date string (RFC3339 sorts
        # lexicographically in chronological order).
        items.sort(key=lambda x: (x.get("date") is None, x.get("date") or ""))
        return items

    # ---- weekly calendar ---------------------------------------------------

    async def week(self, iso_week: str | None = None) -> dict:
        """The weekly calendar view.

        Returns:
          - ``course_table``: the raw MCP envelope for ``get_course_table``
            (so the frontend branches on ``status``: ``ok``/``needs_otp``/
            ``error`` and renders the 课表 grid exactly as before).
          - ``items``: the starred + custom items whose anchor date falls inside
            the requested ISO week (the per-day click-to-reveal overlay).
          - ``week``: the resolved ``YYYY-Www`` (handy for the frontend header).
        """
        course_table = await self._gateway.call_tool("get_course_table")

        week_start, week_end, week_label = _iso_week_range(iso_week)
        in_week: list[dict] = []
        for it in await self.todo():
            d = it.get("date")
            if d is not None and _date_in(d, week_start, week_end):
                in_week.append(it)

        return {
            "course_table": course_table,
            "items": in_week,
            "week": week_label,
        }

    # ---- 新到通知 ----------------------------------------------------------

    async def new_notices(self) -> dict:
        """Items new since the last ``mark_seen``: live assignment ids +
        announcement ids NOT yet in the Store's seen-id watermark.

        Degrades to empty lists when the live tools return ``needs_otp`` /
        ``error`` (e.g. not logged in) — never raises.
        """
        out: dict[str, list[dict]] = {}
        for source, meta in _SOURCE_TOOL.items():
            env = await self._gateway.call_tool(meta["tool"])
            out[source] = _unseen(env, meta, await self._store.seen_ids(source))
        return out

    async def mark_seen(self) -> None:
        """Acknowledge all currently-visible items: merge their ids into the
        seen-id watermark for both sources."""
        for source, meta in _SOURCE_TOOL.items():
            env = await self._gateway.call_tool(meta["tool"])
            await self._store.mark_seen(source, _ids(env, meta))


# ---- helpers (pure) --------------------------------------------------------


def _live_items(env: dict, list_key: str) -> list[dict]:
    """Extract the item list from an ``{status, data}`` envelope. Empty on any
    non-``ok`` status or missing key."""
    if env.get("status") != "ok":
        return []
    data = env.get("data") or {}
    if not isinstance(data, dict):
        return []
    items = data.get(list_key)
    return items if isinstance(items, list) else []


def _ids(env: dict, meta: dict) -> list[str]:
    return [str(it[meta["id_key"]]) for it in _live_items(env, meta["list_key"]) if meta["id_key"] in it]


def _unseen(env: dict, meta: dict, seen: set[str]) -> list[dict]:
    """The live items whose id is not in `seen`."""
    return [it for it in _live_items(env, meta["list_key"]) if str(it.get(meta["id_key"])) not in seen]


def _iso_week_range(iso_week: str | None) -> tuple[date, date, str]:
    """Resolve an ISO week (``YYYY-Www``, e.g. ``2026-W25``) to its Mon..Sun date
    range and a label. ``None`` → the current ISO week."""
    if iso_week:
        try:
            year_s, week_s = iso_week.split("-W", 1)
            year, week = int(year_s), int(week_s)
            start = date.fromisocalendar(year, week, 1)
        except (ValueError, IndexError):
            # Malformed input → fall back to the current week rather than 500.
            start = date.fromisocalendar(*_today_iso())
    else:
        start = date.fromisocalendar(*_today_iso())
    return start, start + timedelta(days=6), f"{start.isocalendar().year}-W{start.isocalendar().week:02d}"


def _today_iso() -> tuple[int, int, int]:
    """Today's (iso_year, iso_week, iso_weekday). In a helper so tests can monkeypatch."""
    today = date.today()
    cal = today.isocalendar()
    # date.isocalendar() returns IsoCalendarDate(year, week, weekday) in 3.9+
    return (cal[0], cal[1], cal[2])


def _date_in(value: str, start: date, end: date) -> bool:
    """True if the date portion of an RFC3339-ish string is within [start, end]."""
    try:
        # Take just the date part (handles full datetimes too).
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        # Not a recognizable date — exclude it from the week rather than crash.
        return False
    return start <= parsed <= end
