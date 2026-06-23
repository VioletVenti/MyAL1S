"""Tests for the Store (Seam 5): CRUD round-trips across all four domains,
plus the pydantic-ai message round-trip that powers conversation replay.

Each test gets a fresh temp SQLite file; no shared state.
"""

from __future__ import annotations

import os

import pytest

from app.store import SOURCE_ANNOUNCEMENT, SOURCE_ASSIGNMENT, Store


@pytest.fixture
async def store(tmp_path):
    s = Store(str(tmp_path / "test.sqlite"))
    await s.connect()
    try:
        yield s
    finally:
        await s.close()


# ---- stars ----------------------------------------------------------------


async def test_star_is_idempotent_and_refreshes_snapshot(store):
    await store.star(SOURCE_ASSIGNMENT, "a1", title="作业一", course="数学", date="2026-06-25")
    assert await store.is_starred(SOURCE_ASSIGNMENT, "a1")
    # Re-star refreshes the snapshot: the dashboard always re-stars with the full
    # live snapshot, so the overwrite contract is "set to exactly what I pass".
    await store.star(SOURCE_ASSIGNMENT, "a1", title="作业一(改)", course="数学", date="2026-06-25")
    rows = await store.list_stars(SOURCE_ASSIGNMENT)
    assert len(rows) == 1  # UPSERT, no duplicate
    assert rows[0]["title"] == "作业一(改)"
    assert rows[0]["date"] == "2026-06-25"


async def test_list_stars_filters_by_source_and_unstars(store):
    await store.star(SOURCE_ASSIGNMENT, "a1", title="A")
    await store.star(SOURCE_ANNOUNCEMENT, "n1", title="N")
    assert len(await store.list_stars()) == 2
    assert len(await store.list_stars(SOURCE_ASSIGNMENT)) == 1
    await store.unstar(SOURCE_ANNOUNCEMENT, "n1")
    assert not await store.is_starred(SOURCE_ANNOUNCEMENT, "n1")
    assert len(await store.list_stars()) == 1


# ---- custom items ---------------------------------------------------------


async def test_custom_item_crud_and_done_toggle(store):
    cid = await store.add_item(title="交报告", due="2026-06-30", course="数学", source="微信群")
    assert cid > 0
    assert await store.update_item(cid, done=True)
    items = await store.list_items()
    assert items[0]["done"] is True
    assert items[0]["title"] == "交报告"
    assert await store.update_item(cid, title="交报告(改)")  # partial patch keeps done
    assert (await store.list_items())[0]["title"] == "交报告(改)"
    assert not await store.update_item(99999)  # no-op patch
    assert await store.delete_item(cid)
    assert not await store.delete_item(cid)  # already gone


# ---- seen ids -------------------------------------------------------------


async def test_seen_ids_diff_and_idempotent_mark(store):
    assert await store.seen_ids(SOURCE_ASSIGNMENT) == set()
    await store.mark_seen(SOURCE_ASSIGNMENT, ["a1", "a2", "a1"])  # dup ignored
    assert await store.seen_ids(SOURCE_ASSIGNMENT) == {"a1", "a2"}
    await store.mark_seen(SOURCE_ASSIGNMENT, [])  # empty is a no-op
    assert await store.seen_ids(SOURCE_ASSIGNMENT) == {"a1", "a2"}


# ---- conversations --------------------------------------------------------


async def test_conversation_create_list_delete(store):
    cid = await store.create_conversation(title="对话一")
    assert await store.conversation_exists(cid)
    assert not await store.conversation_exists("nope")
    convs = await store.list_conversations()
    assert convs[0]["id"] == cid and convs[0]["title"] == "对话一"
    assert await store.delete_conversation(cid)
    assert not await store.conversation_exists(cid)


async def test_message_roundtrip_replays_message_history(store):
    """The serialized slice must round-trip into a valid message_history."""
    from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart

    cid = await store.create_conversation()
    req = ModelRequest(parts=[UserPromptPart(content="你好")])
    resp = ModelResponse(parts=[TextPart(content="你好!")])
    await store.add_message(cid, "user", "你好", [req])
    await store.add_message(cid, "assistant", "你好!", [resp])

    history = await store.get_history(cid)
    assert len(history) == 2
    assert isinstance(history[0], ModelRequest)
    assert isinstance(history[1], ModelResponse)

    msgs = await store.get_messages(cid)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"] == "你好"


async def test_conversation_cascade_deletes_messages(store):
    cid = await store.create_conversation()
    from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart

    await store.add_message(cid, "user", "hi", [ModelRequest(parts=[UserPromptPart(content="hi")])])
    assert (await store.counts())["messages"] == 1
    assert await store.delete_conversation(cid)
    assert await store.get_history(cid) == []


# ---- snapshots (cached envelopes) ---------------------------------------


async def test_snapshot_put_get_upsert_and_keys(store):
    assert await store.get_snapshot("assignments") is None
    await store.put_snapshot("assignments", {"status": "ok", "data": {"x": 1}})
    got = await store.get_snapshot("assignments")
    assert got is not None and got["payload"]["data"]["x"] == 1 and got["fetched_at"]
    # Upsert overwrites.
    await store.put_snapshot("assignments", {"status": "ok", "data": {"x": 2}})
    assert (await store.get_snapshot("assignments"))["payload"]["data"]["x"] == 2
    await store.put_snapshot("grades", {"status": "ok", "data": []})
    keys = await store.snapshot_keys()
    assert "assignments" in keys and "grades" in keys
    assert (await store.counts())["snapshots"] == 2


# ---- schema idempotency ---------------------------------------------------


async def test_connect_is_idempotent(store, tmp_path):
    """Re-opening an existing DB file must not error (CREATE TABLE IF NOT EXISTS)."""
    path = str(tmp_path / "test.sqlite")  # same file `store` already opened
    s2 = Store(path)
    await s2.connect()
    await s2.close()


# ---- approvals + permission matrix (P2 write-ops) --------------------------


async def test_approval_lifecycle_and_args_json(store):
    aid = await store.create_approval(
        tool_name="submit_assignment",
        group_name="assignment_submission",
        args={"assignment_id": "abc", "file_id": "f1"},
        filename="hw1.pdf",
        summary="交作业: 高数 hw1",
    )
    got = await store.get_approval(aid)
    assert got is not None
    assert got["status"] == "pending"
    assert got["args"] == {"assignment_id": "abc", "file_id": "f1"}  # JSON round-trip
    assert got["filename"] == "hw1.pdf"
    assert got["result"] is None and got["decided_at"] is None


async def test_list_approvals_filters_by_status(store):
    p1 = await store.create_approval(tool_name="t", group_name="g", args={})
    p2 = await store.create_approval(tool_name="t", group_name="g", args={})
    await store.transition_approval(p2, from_status="pending", to_status="executed",
                                    result={"status": "ok"})
    pending = await store.list_approvals("pending")
    executed = await store.list_approvals("executed")
    all_rows = await store.list_approvals()
    assert {a["id"] for a in pending} == {p1}
    assert {a["id"] for a in executed} == {p2}
    assert len(all_rows) == 2
    # The executed row carries its result envelope.
    assert executed[0]["result"] == {"status": "ok"}
    assert executed[0]["decided_at"] is not None


async def test_transition_is_status_guarded(store):
    """A second decide on an already-moved approval is a no-op (no double exec)."""
    aid = await store.create_approval(tool_name="t", group_name="g", args={})
    first = await store.transition_approval(aid, from_status="pending", to_status="executed")
    second = await store.transition_approval(aid, from_status="pending", to_status="executed")
    assert first is True
    assert second is False  # status is no longer pending


async def test_permission_matrix_defaults_and_overwrites(store):
    # Absent group → None (the gate applies its 'confirm' default).
    assert await store.permission_level("assignment_submission") is None
    await store.set_permission_level("assignment_submission", "deny")
    assert await store.permission_level("assignment_submission") == "deny"
    # Upsert overwrites.
    await store.set_permission_level("assignment_submission", "confirm")
    assert await store.permission_level("assignment_submission") == "confirm"


async def test_counts_includes_p2_tables(store):
    await store.create_approval(tool_name="t", group_name="g", args={})
    await store.set_permission_level("g", "confirm")
    counts = await store.counts()
    assert counts["approvals"] == 1
    assert counts["permission_matrix"] == 1

