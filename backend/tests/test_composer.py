"""Tests for the Composer (Seam 6): deterministic composition with a FAKE
gateway + real Store (no `pku3b mcp` subprocess, no network, no LLM).

Plus the structural invariant: the composer and the dashboard route must not
import the agent / pydantic_ai (architecture decision #3).
"""

from __future__ import annotations

import inspect

import pytest

from app.composer import Composer
from app.store import SOURCE_ANNOUNCEMENT, SOURCE_ASSIGNMENT, Store


class FakeGateway:
    """Stand-in for McpGateway: returns canned envelopes per tool name.

    Each envelope mirrors the real `{status, data}` shape so the Composer's
    extraction helpers see the real structure.
    """

    def __init__(self, envelopes: dict[str, dict]) -> None:
        self._env = envelopes
        self.calls: list[str] = []

    async def call_tool(self, name: str, args: dict | None = None) -> dict:
        self.calls.append(name)
        return self._env.get(name, {"status": "error", "message": f"no canned envelope for {name}"})


@pytest.fixture
async def store(tmp_path):
    s = Store(str(tmp_path / "test.sqlite"))
    await s.connect()
    try:
        yield s
    finally:
        await s.close()


# ---- todo -----------------------------------------------------------------


async def test_todo_enriches_with_live_and_sorts_by_date(store):
    gw = FakeGateway(
        {
            "list_assignments": {
                "status": "ok",
                "data": {"assignments": [
                    {"id": "a1", "course": "数学", "title": "作业A", "deadline": "2026-06-27", "submitted": False},
                ]},
            },
            "get_announcements": {
                "status": "ok",
                "data": {"announcements": [
                    {"id": "n1", "course": "数学", "title": "公告N", "time": "2026-06-22"},
                ]},
            },
        }
    )
    comp = Composer(store, gw)
    await store.star(SOURCE_ASSIGNMENT, "a1", title="旧标题", date="2026-06-20")
    await store.star(SOURCE_ANNOUNCEMENT, "n1", title="公告N", date="2026-06-22")
    await store.add_item(title="自定义C", due="2026-06-25")

    items = await comp.todo()
    titles = [it["title"] for it in items]
    assert titles == ["公告N", "自定义C", "作业A"]  # ascending by anchor date
    assert {it["kind"] for it in items} == {"star", "custom"}
    # The starred assignment is enriched with the LIVE snapshot (title refreshed,
    # deadline used), not the stale star title/date.
    a1 = next(it for it in items if it["id"] == "a1")
    assert a1["title"] == "作业A" and a1["live"] is True and a1["submitted"] is False
    assert a1["date"] == "2026-06-27"  # live deadline, not the stale 06-20
    # todo() now does crawl the live tools (1h cache amortizes it).
    assert "list_assignments" in gw.calls and "get_announcements" in gw.calls


async def test_todo_excludes_submitted_assignments_but_keeps_star(store):
    """A starred assignment that is live and submitted is excluded from 待办
    (it's done); the star is retained for /stars + the calendar."""
    gw = FakeGateway(
        {
            "list_assignments": {
                "status": "ok",
                "data": {"assignments": [
                    {"id": "done", "course": "c", "title": "已交", "deadline": "2026-06-20", "submitted": True},
                    {"id": "open", "course": "c", "title": "未交", "deadline": "2026-06-28", "submitted": False},
                ]},
            },
            "get_announcements": {"status": "ok", "data": {"announcements": []}},
        }
    )
    comp = Composer(store, gw)
    await store.star(SOURCE_ASSIGNMENT, "done", title="已交", date="2026-06-20")
    await store.star(SOURCE_ASSIGNMENT, "open", title="未交", date="2026-06-28")

    items = await comp.todo()
    assert [it["id"] for it in items] == ["open"]  # submitted one excluded
    # …but the star itself is still there.
    assert len(await store.list_stars()) == 2


async def test_todo_excludes_done_custom_items(store):
    gw = FakeGateway(
        {
            "list_assignments": {"status": "ok", "data": {"assignments": []}},
            "get_announcements": {"status": "ok", "data": {"announcements": []}},
        }
    )
    comp = Composer(store, gw)
    cid = await store.add_item(title="做完了", due="2026-06-25")
    await store.update_item(cid, done=True)
    await store.add_item(title="还没", due="2026-06-26")
    items = await comp.todo()
    assert [it["title"] for it in items] == ["还没"]


async def test_todo_falls_back_to_snapshot_when_item_not_live(store):
    """When the live tools aren't usable (needs_otp / error), every starred item
    falls back to its stored snapshot — 待办 still renders offline."""
    gw = FakeGateway(
        {
            "list_assignments": {"status": "needs_otp", "mobile_mask": None, "hint": "..."},
            "get_announcements": {"status": "error", "message": "boom"},
        }
    )
    comp = Composer(store, gw)
    await store.star(SOURCE_ASSIGNMENT, "a1", title="快照A", course="数学", date="2026-06-27")
    items = await comp.todo()
    assert len(items) == 1
    a1 = items[0]
    assert a1["live"] is False and a1["title"] == "快照A"
    assert a1["submitted"] is None  # unknown — no live data


async def test_todo_undated_items_go_last(store):
    gw = FakeGateway(
        {
            "list_assignments": {"status": "ok", "data": {"assignments": []}},
            "get_announcements": {"status": "ok", "data": {"announcements": []}},
        }
    )
    comp = Composer(store, gw)
    await store.star(SOURCE_ASSIGNMENT, "dated", title="有日期", date="2026-09-01")
    await store.star(SOURCE_ANNOUNCEMENT, "undated", title="无日期")  # date=None, not live
    items = await comp.todo()
    assert [it["title"] for it in items] == ["有日期", "无日期"]


# ---- week (calendar) ------------------------------------------------------


async def test_week_returns_course_table_and_filters_items_to_range(store):
    gw = FakeGateway(
        {
            "get_course_table": {"status": "ok", "data": {"course": []}},
            "list_assignments": {"status": "ok", "data": {"assignments": []}},
            "get_announcements": {"status": "ok", "data": {"announcements": []}},
        }
    )
    comp = Composer(store, gw)
    # 2026-W25 = Mon 2026-06-15 .. Sun 2026-06-21.
    await store.star(SOURCE_ASSIGNMENT, "in", title="本周内", date="2026-06-18")
    await store.star(SOURCE_ASSIGNMENT, "out", title="下周", date="2026-06-28")

    view = await comp.week("2026-W25")
    assert view["course_table"] == {"status": "ok", "data": {"course": []}}
    assert view["week"] == "2026-W25"
    assert [it["title"] for it in view["items"]] == ["本周内"]


async def test_week_RETAINS_submitted_and_done_items_unlike_todo(store):
    """Calendar = star-retention view: a submitted-but-starred assignment and a
    done custom item still appear on their day (unlike todo(), which excludes
    them). This is the C1 spec contract the first week() cut broke."""
    gw = FakeGateway(
        {
            "get_course_table": {"status": "ok", "data": {"course": []}},
            # The starred assignment is live AND submitted; todo() would drop it,
            # but the calendar must retain it.
            "list_assignments": {
                "status": "ok",
                "data": {"assignments": [
                    {"id": "done", "course": "c", "title": "已交作业", "deadline": "2026-06-17", "submitted": True},
                ]},
            },
            "get_announcements": {"status": "ok", "data": {"announcements": []}},
        }
    )
    comp = Composer(store, gw)
    await store.star(SOURCE_ASSIGNMENT, "done", title="已交作业", date="2026-06-17")
    cid = await store.add_item(title="做完了的待办", due="2026-06-19")
    await store.update_item(cid, done=True)

    view = await comp.week("2026-W25")  # 06-15..06-21
    titles = sorted(it["title"] for it in view["items"])
    assert "已交作业" in titles and "做完了的待办" in titles
    # …even though todo() excludes both:
    todo_titles = [it["title"] for it in await comp.todo()]
    assert "已交作业" not in todo_titles and "做完了的待办" not in todo_titles


async def test_week_malformed_iso_falls_back_to_current(store):
    comp = Composer(store, FakeGateway({"get_course_table": {"status": "ok", "data": {}}}))
    view = await comp.week("not-a-week")
    # Should not raise; label is a valid YYYY-Www.
    assert "-W" in view["week"]


async def test_week_needs_otp_propagates_status(store):
    gw = FakeGateway({"get_course_table": {"status": "needs_otp", "mobile_mask": "135****1234", "hint": "..."}})
    comp = Composer(store, gw)
    view = await comp.week("2026-W25")
    assert view["course_table"]["status"] == "needs_otp"
    assert view["items"] == []  # no items stored


# ---- new notices ----------------------------------------------------------


async def test_new_notices_diffs_live_against_seen(store):
    gw = FakeGateway(
        {
            "list_assignments": {
                "status": "ok",
                "data": {"assignments": [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}]},
            },
            "get_announcements": {
                "status": "ok",
                "data": {"announcements": [{"id": "n1"}, {"id": "n2"}]},
            },
        }
    )
    comp = Composer(store, gw)
    await store.mark_seen(SOURCE_ASSIGNMENT, ["a1"])  # a1 already seen

    notices = await comp.new_notices()
    assert [a["id"] for a in notices["assignment"]] == ["a2", "a3"]
    assert [n["id"] for n in notices["announcement"]] == ["n1", "n2"]


async def test_mark_seen_merges_current_live_ids(store):
    gw = FakeGateway(
        {
            "list_assignments": {"status": "ok", "data": {"assignments": [{"id": "a1"}, {"id": "a2"}]}},
            "get_announcements": {"status": "ok", "data": {"announcements": [{"id": "n1"}]}},
        }
    )
    comp = Composer(store, gw)
    await comp.mark_seen()
    assert await store.seen_ids(SOURCE_ASSIGNMENT) == {"a1", "a2"}
    assert await store.seen_ids(SOURCE_ANNOUNCEMENT) == {"n1"}


async def test_new_notices_empty_when_not_logged_in(store):
    """A needs_otp/error envelope degrades to empty lists, never raises."""
    gw = FakeGateway(
        {
            "list_assignments": {"status": "needs_otp", "mobile_mask": None, "hint": "..."},
            "get_announcements": {"status": "error", "message": "boom"},
        }
    )
    comp = Composer(store, gw)
    notices = await comp.new_notices()
    assert notices == {"assignment": [], "announcement": []}


# ---- structural invariant (no LLM) ----------------------------------------


def test_composer_and_dashboard_route_cannot_reach_the_llm() -> None:
    """Architecture decision #3, enforced structurally: the deterministic
    composer and dashboard routes must not import the LLM library. AST-based so
    a docstring that merely *mentions* `pydantic_ai` (e.g. 'this module imports
    no pydantic_ai') does not trip a naive substring check."""
    import ast

    import app.composer as composer
    import app.routes.dashboard as dashboard

    def _imports_pydantic_ai(mod) -> bool:
        tree = ast.parse(inspect.getsource(mod))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "pydantic_ai" or alias.name.startswith("pydantic_ai."):
                        return True
            elif isinstance(node, ast.ImportFrom):
                if node.module and (node.module == "pydantic_ai" or node.module.startswith("pydantic_ai.")):
                    return True
        return False

    for mod in (composer, dashboard):
        assert not _imports_pydantic_ai(mod), f"{mod.__name__} imports pydantic_ai (LLM)"
