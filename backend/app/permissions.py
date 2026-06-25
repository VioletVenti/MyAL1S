"""The permission gate (**Seam 7**) — the write-side dual of the Composer.

Both hold ``(store, gateway)``; the Composer joins live reads with persisted
state, the gate gates + dispatches writes. Two channels reach it:

- **Agent (计划1 / two-phase REST).** The agent's local write tool calls
  [`create_approval`], which (at the default ``confirm`` level) inserts a
  ``pending`` row and returns a ``pending_approval`` envelope; **agent.run
  ends** (no native deferred-run resume — robust and restart-safe). The user
  confirms in the 待审批 panel → [`decide`] → [`_dispatch`] runs the write
  out-of-band.
- **UI direct (implicit confirm).** The user clicked + picked a file, so
  [`execute_now`] dispatches immediately — but it still checks the matrix (deny
  blocks) and writes an ``executed``/``failed`` approval row for a unified audit.

[`decide`] (after approve) and [`execute_now`] BOTH funnel through one private
[`_dispatch`]: the single site a write is sent to the teaching network. That is
the whole point of "two channels share one gate" — the UI and agent paths
cannot diverge on what reaches Blackboard.

Levels: ``deny`` (block, no dispatch), ``confirm`` (default; agent defers to a
pending approval, UI satisfies it inline). ``auto`` is reserved for P3 file-less
writes — explicitly rejected here, never a silent alias of ``confirm``.

The gate is unit-testable through a ``_GatewayLike`` Protocol (a fake gateway)
— it never requires the real pku3b subprocess. A per-instance ``asyncio.Lock``
serializes [`decide`] so a double-click cannot dispatch the write twice.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Protocol

from .store import (
    APPROVAL_DENIED,
    APPROVAL_EXECUTED,
    APPROVAL_FAILED,
    APPROVAL_PENDING,
    PERMISSION_CONFIRM,
    PERMISSION_DENY,
    Store,
)
from .uploads import Uploads

log = logging.getLogger("myal1s.permissions")

# The semantic groups a write tool may belong to. Drives the settings page; P2
# has one, P3 adds more (treehole_post, course_election, …) here.
# P3: treehole write groups added.
KNOWN_GROUPS = ("assignment_submission", "treehole_post", "treehole_comment")

# Write tools the gate knows how to dispatch (each maps to a branch in _dispatch).
_WRITE_TOOLS = {"submit_assignment", "treehole_post", "treehole_comment"}

# Valid stored matrix levels. P3 promotes `auto` to a real level (file-less
# writes like treehole posting can run without confirmation if the user opts in).
PERMISSION_AUTO = "auto"
_VALID_LEVELS = (PERMISSION_DENY, PERMISSION_CONFIRM, PERMISSION_AUTO)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _GatewayLike(Protocol):
    """The slice of McpGateway the gate needs. Protocol so tests pass a fake."""

    async def call_tool(self, name: str, args: dict[str, Any] | None = None) -> dict: ...


class PermissionGate:
    def __init__(self, store: Store, gateway: _GatewayLike, uploads: Uploads) -> None:
        self._store = store
        self._gateway = gateway
        self._uploads = uploads
        self._decide_lock = asyncio.Lock()

    # ---- matrix -----------------------------------------------------------

    async def level_for(self, group_name: str) -> str:
        """The effective level for a group: the stored level, or ``confirm`` (the
        safe default) when unset. Only ``deny``/``confirm`` are valid stored levels
        in P2 (``set_level`` rejects ``auto``); a stale/foreign row holding anything
        else collapses to ``confirm`` — which still GATES the write (requires
        approval), so decision 5's guarantee holds: an ``auto``-tagged write never
        auto-executes / bypasses the matrix. P3 promotes ``auto`` to a real level."""
        stored = await self._store.permission_level(group_name)
        if stored in _VALID_LEVELS:
            return stored
        return PERMISSION_CONFIRM

    async def set_level(self, group_name: str, level: str) -> None:
        if group_name not in KNOWN_GROUPS:
            raise ValueError(f"未知的权限组: {group_name}")
        if level not in _VALID_LEVELS:
            raise ValueError(
                f"不支持的权限级别: {level}（P2 仅支持 deny/confirm；auto 留待 P3）"
            )
        await self._store.set_permission_level(group_name, level)

    @staticmethod
    def known_groups() -> list[str]:
        return list(KNOWN_GROUPS)

    def uploads_filename_for(self, file_id: str) -> str | None:
        """The original filename for a file_id (for approval summaries / the
        agent tool). None if the upload is gone. Exposed so callers don't reach
        into the uploads helper directly."""
        return self._uploads.filename_for(file_id)

    # ---- agent path: create a pending approval ----------------------------

    async def create_approval(
        self,
        *,
        tool_name: str,
        group_name: str,
        args: dict[str, Any],
        summary: str,
        filename: str | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """The agent write-tool entry point. Checks the matrix:

        - ``deny``  → log a ``denied`` row, return a ``denied`` envelope (no dispatch);
        - ``confirm`` (default) → insert a ``pending`` row, return ``pending_approval``
          so the agent can tell the user to confirm in the chat banner. agent.run ends.
        - ``auto`` (P3) → dispatch IMMEDIATELY (no pending), write an executed/failed
          audit row, return the result envelope. agent.run continues with the real result.

        Returns the envelope the agent tool forwards to the LLM.
        """
        if tool_name not in _WRITE_TOOLS:
            return {"status": "error", "message": f"未知的写工具: {tool_name}"}
        level = await self.level_for(group_name)
        if level == PERMISSION_DENY:
            await self._store.create_approval(
                tool_name=tool_name, group_name=group_name, args=args, summary=summary,
                filename=filename, conversation_id=conversation_id,
                status=APPROVAL_DENIED, decided_at=_now(),
            )
            return {"status": "denied", "message": "该操作已被权限矩阵禁止。"}
        if level == PERMISSION_AUTO:
            # auto: dispatch immediately, write audit row, return real result.
            envelope = await self._dispatch(tool_name, args)
            to_status = APPROVAL_EXECUTED if envelope.get("status") == "ok" else APPROVAL_FAILED
            await self._store.create_approval(
                tool_name=tool_name, group_name=group_name, args=args, summary=summary,
                filename=filename, conversation_id=conversation_id,
                status=to_status, result=envelope, decided_at=_now(),
            )
            return envelope
        # confirm (default): insert pending, agent.run ends.
        aid = await self._store.create_approval(
            tool_name=tool_name, group_name=group_name, args=args, summary=summary,
            filename=filename, conversation_id=conversation_id, status=APPROVAL_PENDING,
        )
        return {
            "status": "pending_approval",
            "approval_id": aid,
            "summary": summary,
            "hint": "请在对话框上方的审批横条确认后执行。",
        }

    # ---- user decision on a pending approval (agent path) -----------------

    async def decide(self, approval_id: str, decision: str) -> dict[str, Any]:
        """Confirm or deny a pending approval. ``confirm`` → dispatch the write
        out-of-band and record ``executed``/``failed``. ``deny`` → record
        ``denied``. The decide lock + the Store's status-guarded transition make
        a repeated / concurrent decide a no-op (no double dispatch)."""
        if decision not in ("confirm", "deny"):
            return {"status": "error", "message": "decision 必须是 confirm 或 deny。"}
        async with self._decide_lock:
            approval = await self._store.get_approval(approval_id)
            if approval is None:
                return {"status": "error", "message": "审批记录不存在。"}
            if approval["status"] != APPROVAL_PENDING:
                return {"status": "already_decided", "approval": approval}
            if decision == "deny":
                await self._store.transition_approval(
                    approval_id, from_status=APPROVAL_PENDING, to_status=APPROVAL_DENIED,
                )
                return {"status": "denied"}
            envelope = await self._dispatch(approval["tool_name"], approval["args"])
            to_status = APPROVAL_EXECUTED if envelope.get("status") == "ok" else APPROVAL_FAILED
            await self._store.transition_approval(
                approval_id, from_status=APPROVAL_PENDING, to_status=to_status, result=envelope,
            )
            return envelope

    # ---- UI path: implicit confirm, execute immediately -------------------

    async def execute_now(
        self,
        *,
        tool_name: str,
        group_name: str,
        args: dict[str, Any],
        summary: str,
        filename: str | None = None,
    ) -> dict[str, Any]:
        """The UI direct path: the user's click + file pick IS the confirmation,
        so dispatch immediately — but still respect the matrix (deny blocks) and
        write an ``executed``/``failed`` row for the audit trail (decision #7)."""
        if tool_name not in _WRITE_TOOLS:
            return {"status": "error", "message": f"未知的写工具: {tool_name}"}
        level = await self.level_for(group_name)
        if level == PERMISSION_DENY:
            await self._store.create_approval(
                tool_name=tool_name, group_name=group_name, args=args, summary=summary,
                filename=filename, status=APPROVAL_DENIED, decided_at=_now(),
            )
            return {"status": "denied", "message": "该操作已被权限矩阵禁止。"}
        envelope = await self._dispatch(tool_name, args)
        to_status = APPROVAL_EXECUTED if envelope.get("status") == "ok" else APPROVAL_FAILED
        await self._store.create_approval(
            tool_name=tool_name, group_name=group_name, args=args, summary=summary,
            filename=filename, status=to_status, result=envelope, decided_at=_now(),
        )
        return envelope

    # ---- the single dispatch site ----------------------------------------

    async def _dispatch(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Resolve args to a concrete MCP call and dispatch it. This is the ONLY
        place a write reaches the teaching network — both ``decide`` and
        ``execute_now`` come through here. ``submit_assignment`` stores a
        ``file_id`` (never a path) in the approval; we resolve file_id → absolute
        path just-in-time, so paths never persist in the DB and never reach the
        LLM."""
        if tool_name == "submit_assignment":
            assignment_id = args.get("assignment_id")
            file_id = args.get("file_id")
            if not assignment_id or not file_id:
                return {"status": "error", "message": "缺少 assignment_id 或 file_id。"}
            try:
                path = self._uploads.path_for(file_id)
            except FileNotFoundError:
                return {"status": "error", "message": f"附件 {file_id} 不存在或已过期。"}
            log.info("dispatching submit_assignment %s (%s)", assignment_id, path.name)
            return await self._gateway.call_tool(
                "submit_assignment",
                {"assignment_id": assignment_id, "file_path": str(path)},
            )
        if tool_name in ("treehole_post", "treehole_comment"):
            # treehole writes are file-less — forward args directly (no file_id resolution).
            log.info("dispatching %s args=%s", tool_name, args)
            return await self._gateway.call_tool(tool_name, args)
        return {"status": "error", "message": f"未知的写工具: {tool_name}"}
