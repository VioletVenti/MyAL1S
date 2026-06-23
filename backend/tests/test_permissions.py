"""Tests for the PermissionGate (Seam 7) with a fake gateway — no pku3b subprocess.

Covers: matrix levels + the confirm default, the agent two-phase path
(create_approval → pending → decide → dispatch), the UI implicit-confirm path
(execute_now), deny blocking both paths, needs_otp at execution → failed, the
single-dispatch-site guarantee (file_id in the DB, file_path at the gateway),
and double-decide idempotency.
"""

from __future__ import annotations

import pytest

from app.permissions import PermissionGate
from app.store import Store
from app.uploads import Uploads


class FakeGateway:
    """Records every call_tool so tests assert dispatch count + arg shape."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.next_envelope: dict = {"status": "ok", "data": {"assignment_id": "a1", "submitted": True}}

    async def call_tool(self, name: str, args: dict | None = None) -> dict:
        self.calls.append((name, dict(args or {})))
        return self.next_envelope


@pytest.fixture
async def gate(tmp_path):
    store = Store(str(tmp_path / "t.sqlite"))
    await store.connect()
    g = PermissionGate(store, FakeGateway(), Uploads(tmp_path / "uploads"))
    try:
        yield g
    finally:
        await store.close()


def _seed_file(g: PermissionGate, name: str = "hw.pdf") -> str:
    return g._uploads.save(b"file-bytes", name)


# ---- matrix -----------------------------------------------------------------


async def test_level_defaults_to_confirm_and_sets(gate):
    assert await gate.level_for("assignment_submission") == "confirm"
    await gate.set_level("assignment_submission", "deny")
    assert await gate.level_for("assignment_submission") == "deny"


async def test_set_level_rejects_auto_and_unknown_group(gate):
    with pytest.raises(ValueError):  # auto reserved for P3
        await gate.set_level("assignment_submission", "auto")
    with pytest.raises(ValueError):  # unknown group
        await gate.set_level("bogus_group", "confirm")


# ---- agent path: create_approval -------------------------------------------


async def test_agent_create_approval_is_pending_no_dispatch(gate):
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": "f1"}, summary="交作业: hw1",
    )
    assert env["status"] == "pending_approval"
    assert env["approval_id"]
    assert gate._gateway.calls == []  # nothing dispatched yet


async def test_agent_deny_blocks_at_create_and_audits(gate):
    await gate.set_level("assignment_submission", "deny")
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": "f1"}, summary="x",
    )
    assert env["status"] == "denied"
    assert gate._gateway.calls == []
    assert len(await gate._store.list_approvals("denied")) == 1


# ---- decide (confirm / deny) -----------------------------------------------


async def test_decide_confirm_dispatches_once_with_path_not_file_id(gate):
    file_id = _seed_file(gate)
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": file_id}, summary="x",
    )
    result = await gate.decide(env["approval_id"], "confirm")
    assert result["status"] == "ok"
    # Single dispatch; the gateway received a resolved file_path, NOT file_id.
    assert len(gate._gateway.calls) == 1
    name, args = gate._gateway.calls[0]
    assert name == "submit_assignment"
    assert args["assignment_id"] == "a1"
    assert "file_path" in args and "file_id" not in args
    # The stored audit row still holds file_id (never a path) and is executed.
    row = await gate._store.get_approval(env["approval_id"])
    assert row["status"] == "executed"
    assert row["args"]["file_id"] == file_id and "file_path" not in row["args"]


async def test_decide_deny_no_dispatch(gate):
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": "f1"}, summary="x",
    )
    assert (await gate.decide(env["approval_id"], "deny"))["status"] == "denied"
    assert gate._gateway.calls == []
    assert (await gate._store.get_approval(env["approval_id"]))["status"] == "denied"


async def test_decide_needs_otp_marks_failed(gate):
    file_id = _seed_file(gate)
    gate._gateway.next_envelope = {"status": "needs_otp", "mobile_mask": "135****1234", "hint": "…"}
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": file_id}, summary="x",
    )
    result = await gate.decide(env["approval_id"], "confirm")
    assert result["status"] == "needs_otp"
    row = await gate._store.get_approval(env["approval_id"])
    assert row["status"] == "failed" and row["result"]["status"] == "needs_otp"


async def test_double_decide_is_a_noop(gate):
    file_id = _seed_file(gate)
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": file_id}, summary="x",
    )
    first = await gate.decide(env["approval_id"], "confirm")
    second = await gate.decide(env["approval_id"], "confirm")
    assert first["status"] == "ok"
    assert second["status"] == "already_decided"
    assert len(gate._gateway.calls) == 1  # dispatched exactly once


async def test_decide_missing_file_fails_clean(gate):
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": "ghost"}, summary="x",
    )
    result = await gate.decide(env["approval_id"], "confirm")
    assert result["status"] == "error"
    assert (await gate._store.get_approval(env["approval_id"]))["status"] == "failed"


# ---- UI path: execute_now --------------------------------------------------


async def test_ui_execute_now_dispatches_and_writes_audit_row(gate):
    file_id = _seed_file(gate)
    result = await gate.execute_now(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": file_id}, summary="直接提交", filename="hw.pdf",
    )
    assert result["status"] == "ok"
    assert len(gate._gateway.calls) == 1
    assert len(await gate._store.list_approvals("executed")) == 1  # audit row


async def test_ui_execute_now_respects_deny(gate):
    await gate.set_level("assignment_submission", "deny")
    result = await gate.execute_now(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": "f1"}, summary="x",
    )
    assert result["status"] == "denied"
    assert gate._gateway.calls == []


async def test_unknown_tool_is_rejected(gate):
    env = await gate.create_approval(
        tool_name="bogus", group_name="assignment_submission",
        args={}, summary="x",
    )
    assert env["status"] == "error"


async def test_stray_auto_level_cannot_bypass_confirmation(gate):
    """Decision 5: a stale/foreign 'auto' row must NOT make a write auto-execute.
    set_level rejects 'auto'; this simulates a stray row written directly to the
    DB, then asserts the write still requires confirmation (does not dispatch)."""
    await gate._store.set_permission_level("assignment_submission", "auto")
    env = await gate.create_approval(
        tool_name="submit_assignment", group_name="assignment_submission",
        args={"assignment_id": "a1", "file_id": _seed_file(gate)}, summary="x",
    )
    # level_for collapses 'auto' to 'confirm' -> the write is gated (pending), NOT
    # dispatched. Nothing reaches the gateway this turn.
    assert env["status"] == "pending_approval"
    assert gate._gateway.calls == []
