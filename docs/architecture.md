# Architecture (P0)

MyAL1S is an LLM-agent + web campus assistant built on the `pku3b` teaching-network
crawler. This document is the maintainer's map: the seams, the two data paths, and
the one invariant that must never break.

```
┌───────────────────────────────────────────────────────────┐
│ Browser — Vite + React (frontend/)                         │
│   Dashboard (deterministic)        ChatBox (agent)         │
└───────┬───────────────────────────────────┬───────────────┘
        │ GET /api/course-table…             │ POST /api/chat
        │ GET /api/todo|calendar|stars…      │ (model picker, history)
        │ (no LLM)                           │
┌───────▼───────────────────────────────────▼───────────────┐
│ FastAPI backend (backend/)                                 │
│   routes/deterministic.py          routes/chat.py          │
│   routes/dashboard.py ──┐             │ gateway.agent.run  │
│        │                │             │ (message_history)  │
│        │ gateway.call_tool             └────────┬──────────┤
│        │                │                      │          │
│        │          Composer (Seam 6)            │          │
│        │           join + diff + week-math      │          │
│        │                │                      │          │
│        └──────────────┬─┴──────────────────────┤          │
│                  McpGateway (Seam 4)          │          │
│         one MCPServerStdio, shared by all paths│          │
│                        │                      │          │
│                   Store (Seam 5) ◀────────────┘          │
│         SQLite: stars / custom items / seen-ids /         │
│         conversations + messages                          │
└──────────────────────┬─────────────────────────────────────┘
                       │ newline JSON-RPC 2.0 over stdio
┌──────────────────────▼─────────────────────────────────────┐
│ pku3b mcp  (pku3b/src/mcp/, Rust + compio)                 │
│   transport (Seam 3) → ToolRegistry (Seam 1) → auth (Seam 2)│
│   tools: course_table · assignments · grades ·             │
│          announcements · materials · videos · login        │
└─────────────────────────────────────────────────────────────┘
```

> P1 added the **Store** (Seam 5) and the **Composer** (Seam 6) plus the
> `routes/dashboard.py` deterministic path. The Composer joins live MCP-tool
> data with persisted state (stars / custom items / seen-ids) into the 待办 /
> weekly-calendar / 新到通知 shapes — still never through the LLM. The Store
> also persists chat conversations + the pydantic-ai message slices so threads
> can be reopened exactly (that path *does* touch the agent, in `routes/chat.py`
> only).

## The invariant

**Deterministic data never passes through the LLM.** Course table, assignments,
and grades shown on the dashboard are fetched by calling MCP tools *directly*
(`McpGateway.call_tool`). The agent (`/api/chat`) is the *only* LLM path. This is
enforced structurally: `routes/deterministic.py` imports neither the agent nor
`pydantic_ai` (a test asserts this — see `backend/tests/test_mcp_gateway.py`).

## The seams (deep modules behind small interfaces)

| # | Seam | Where | Interface | Hides |
|---|------|-------|-----------|-------|
| 1 | **Tool registry** | `pku3b/src/mcp/tools.rs` | `list_mcp()`, `call(name, args)` | all pku3b `api::*` orchestration, serialization, the assignment crawl |
| 2 | **Prompt-free auth** | `pku3b/src/mcp/auth.rs` + `tools.rs::login` | `login_*() -> LoginOutcome::{Ready, NeedsOtp}`; `login(otp)` | cookie reuse, IAAA OAuth, OTP detection (returns `NeedsOtp` as **data**, never blocks), and the **one-OTP** orchestration (see below) |
| 3 | **Transport** | `pku3b/src/mcp/transport.rs` | `serve(registry)` | newline JSON-RPC framing + method routing; a thin adapter with no domain logic |
| 4 | **McpGateway** | `backend/app/mcp_gateway.py` | `call_tool(name, args)`, `agent` | the `pku3b mcp` subprocess lifecycle, MCP handshake, result unwrapping |
| 5 | **Store** (P1) | `backend/app/store.py` | grouped methods: stars / custom-items / seen-ids / conversations | the entire SQLite lifecycle (aiosqlite connection, schema init, all SQL + row mapping, pydantic-ai message serialization) |
| 6 | **Composer** (P1) | `backend/app/composer.py` | `todo()`, `week(iso_week)`, `new_notices()`, `mark_seen()` | the multi-source join: merging live MCP-tool data with Store state into the dashboard shapes; seen-id diffing; ISO-week date-range filtering |
| 7 | **PermissionGate** (P2) | `backend/app/permissions.py` | `level_for(group)`, `set_level(...)`, `create_approval(...)`, `decide(id, decision)`, `execute_now(...)` | the write-side dual of the Composer: gates writes through the matrix and dispatches them. Two channels (agent two-phase + UI implicit-confirm) share ONE `_dispatch` site; matrix levels; approval lifecycle; file_id→path resolution. Hides all write policy + the out-of-band execution |

Why these are *real* seams (not speculative): each has two adapters across it.
Seam 1 is driven by the stdio transport **and** by in-process unit tests (and
later by the Python deterministic path). Seam 2 serves the MCP server (wants
`NeedsOtp` data) **and** leaves the CLI's interactive `inquire` flow untouched.

## Request lifecycles

**Deterministic (dashboard):**
`GET /api/assignments` → `gateway.call_tool("list_assignments", …)` →
`direct_call_tool` over MCP → registry crawls Blackboard → `{status:"ok", data}`
envelope back to the browser. No tokens spent.

**Agent (chat):**
`POST /api/chat` → `agent.run(message)` → the LLM decides which MCP tool(s) to
call (same catalog) → synthesizes a Chinese answer → `{reply}`. P1: `model`
overrides the agent's default (picker); `conversation_id` loads stored history
(`message_history=`) and the new turn is persisted; the reply carries a
`trace` of tool calls/results ("思考可见").

**Dashboard (deterministic, P1):**
`GET /api/todo` → `composer.todo()` returns the **undone-only** list: starred
assignments/announcements enriched with live data (a live-and-submitted starred
assignment is excluded) + custom items not marked done. `GET /api/calendar?week=`
→ `composer.week()` is the **star-retention** view: it shows **every** starred +
custom item whose anchor date falls in that ISO week, **regardless of
submitted/done status** (a completed item still appears on its day — the calendar
is distinct from 待办). `GET /api/new-notices` → `composer.new_notices()` diffs
live assignment/announcement ids against the Store's seen-id watermark; `POST
/api/new-notices/mark-seen` merges the current ids in. **All three dashboard
routes wrap the composer output in the `{status:"ok", data}` envelope** — the
composer returns bare domain shapes; the routes envelope them so the frontend
consumes one consistent shape via `EnvelopeBody` (the composer's per-source
degradation means the route status is always `ok`; calendar's
`data.course_table` itself carries the inner login status). None of these touch
the LLM — `routes/dashboard.py` and `composer.py` import neither the agent nor
`pydantic_ai` (a structural test asserts it).

The frontend wraps `<App/>` in an `ErrorBoundary` (`main.tsx`) so a thrown render
error in any panel shows a visible diagnostic instead of unmounting the whole
tree to a blank page (React has no default boundary).

## Data cleaning + the format layer (P1 / Increment D)

Teaching-network data is **raw** (portal blobs, Rust Debug enum names, RFC3339
timestamps). Two layers clean it before it reaches the DOM:

- **Backend (pku3b)** normalizes **structured** fields at the source —
  `list_course_materials` emits a Chinese `kind` label (文档/文件/文件夹/…), not
  the Rust `CourseContentKind` Debug name. This benefits every consumer
  (dashboard + agent).
- **Frontend `format.ts`** is the **display** layer — pure functions that turn
  raw shapes into short Chinese strings: `parseCourseSlot` (the courseName blob
  → `{name, room, teacher}`, mirroring pku3b's CLI `format_course_info`),
  `fmtDeadline`/`fmtDate` (RFC3339 + Chinese dates → `6/27 周六 11:59`, keeping
  the source's wall-clock, no tz conversion), `fmtAnnouncementTime` (strips the
  `发布时间：` prefix), `truncate`/`fmtDescription` (long text → one short line),
  `kindLabel` (safety-net for stale English values). Every function is total —
  on an unexpected shape it returns a safe fallback, never throws (so it can't
  re-trigger the blank-page render-crash class).

## Views (main / directory)

The app has no router; `App.tsx` holds a `view: "main" | "directory"` state
toggled by a segmented control in the header. **Main** = the glanceable subset
(Calendar + 待办 + 新到通知); **Directory** = a **left sidebar nav + a single
selected module** on the right (作业/课程通知/材料/回放/成绩 + the four 待接入
placeholders). Clicking a nav item swaps which module is mounted — only one is
rendered at a time (not a grid). List modules paginate (上一页/下一页). The chat
sidebar is a sibling of `<Dashboard>`, independent of the view.

## Snapshot cache (Increment E) — survives restarts + prefetch on login

The deterministic routes maintain a snapshot cache in the **Store** (`snapshots`
table, Seam 5): on every successful live fetch they write the envelope; on a
`needs_otp` / `error` (not logged in, or the network is down) they serve the
last good snapshot back **marked `stale`** (with `fetched_at`), so the dashboard
still shows yesterday's data after a backend restart or when not logged in. The
frontend mirrors the last envelope to `localStorage` for an instant first paint
on browser refresh, and renders a "离线缓存（上次更新 …）" badge on stale data.

On a fully-connected login, `/api/login` kicks off a **background prefetch**
that warms all six sources into the snapshot cache (detached task — never blocks
the login response), so the directory modules are populated immediately
regardless of which view the client has mounted. `warm_snapshots`
(`routes/session.py`) reuses the same `_cached` helper as the deterministic
routes, so prefetch and per-route fallback stay in sync.

## Connection gate (P2 UX iteration) — one check, no spinner storm

Before P2's UX iteration, an unauthenticated dashboard mounted every panel,
each of which cold-crawled pku3b to discover `needs_otp` and spun 加载中 for the
duration (the localStorage cache only seeds on `status:"ok"`, which never
happens before a first login). Now `GET /api/session` is a SINGLE cheap gate:
it calls the `login` tool with no otp (the reuse branch; pku3b's 1h HTTP cache
keeps the second+ check fast) and returns `{connected: bool}`. The frontend
checks it on mount and after a successful login; until `connected`, the
dashboard renders ONE 未连接 notice (and the always-visible LoginBar) instead of
mounting the panels — so a cold, not-logged-in load shows a clear prompt, not
six spinners. Once connected, the panels mount warm.

## Approval flow lives in the chat (P2 UX iteration)

The agent two-phase approval no longer has a dedicated 待审批 directory panel.
Pending approvals are polled (`GET /api/approvals?status=pending`) and rendered
as **inline banners above the chat composer** — the confirm/reject happens right
where the request originated. (The `/api/approvals` route and the audit row in
the Store are unchanged; only the surfacing moved.) The UI-direct submit path
(作业行「交作业」) is unchanged — it's an implicit confirm and never creates a
pending.

## Write path (P2) — the PermissionGate, two channels, one dispatch

P2 adds the write side. The deep module is the **PermissionGate** (Seam 7) — the
write-side dual of the Composer (both hold `store, gateway`; the Composer joins
reads, the gate gates + dispatches writes). Two channels reach it, and **both
funnel through one private `_dispatch`** — the only place a write is sent to the
teaching network, so the UI and agent paths can never diverge on what reaches
Blackboard.

```
UI direct (implicit confirm)            Agent (计划1 two-phase REST)
  作业行「交作业」→ file                  聊天 📎 附件 → file_id
  POST /api/submit (multipart)           "把这个交到作业X" + attachment_file_id
        │                                       │ chat.py injects file_id into the msg
        │                                       ▼
        │                              agent.run → submit_assignment(assignment_id, file_id)
        │                              (a LOCAL FunctionToolset tool, file_id-based; the
        │                               path-based MCP primitive is FilteredToolset-hidden)
        │                                       │ gate.create_approval → pending row
        │                                       ▼ agent.run ENDS (no deferred-run resume)
        │                              POST /api/approvals/{id}/decide  ← 待审批 panel
        ▼                                       ▼
   ┌────────────────────────────────────────────────────────┐
   │  PermissionGate.create_approval / decide / execute_now │
   │   matrix: deny → block; confirm → pending/execute;     │
   │            auto → reserved (P3)                         │
   │   ── single private _dispatch(tool_name, args) ──┐     │
   └──────────────────────────────────────────────────┼─────┘
                                  file_id → absolute path (Uploads helper)
                                  ▼ gateway.call_tool("submit_assignment",
                                                       {assignment_id, file_path})
                  pku3b MCP `submit_assignment` (path primitive; hidden from agent)
                                  ▼ submit_file → Blackboard
```

**计划1 (two-phase, REST, no WebSocket).** The agent's write tool calls
`create_approval`, which inserts a `pending` row and returns a `pending_approval`
envelope; **`agent.run` then ends** (the native pydantic-ai deferred-run resume
is deliberately NOT used — it is fragile across persistence/restart). The user
confirms in the 待审批 panel → `decide(id, "confirm")` → `_dispatch` runs the write
out-of-band and records `executed`/`failed`. The decide lock + the Store's
status-guarded transition make a double-decide a no-op (no double dispatch).

**UI direct = implicit confirm.** The user clicked + picked a file, so
`execute_now` dispatches immediately — but it still checks the matrix (deny
blocks) and writes an `executed`/`failed` row for a unified audit trail.

**file_id, never a path.** A pending approval stores a `file_id` (from the
`Uploads` helper, `backend/app/uploads.py`) — NEVER a raw path. `_dispatch`
resolves `file_id` → absolute path just-in-time, so paths neither persist in the
DB nor reach the LLM. The path-based `submit_assignment` MCP primitive is the
execution target, reached via `gateway.call_tool`; it is hidden from the agent by
a `FilteredToolset` over the MCP server, and the agent instead gets a local
`submit_assignment(assignment_id, file_id)` proxy.

**Matrix.** Per semantic-group level: `deny` (block) / `confirm` (default) /
`auto` (reserved for P3 file-less writes; rejected for now). Granularity is the
semantic group, not the tool. The gate exposes `known_groups()` (P2: just
`assignment_submission`); the settings page lists them.

## Login: one OTP for both services

`login(otp)` (`tools.rs`) spends the single OTP on the **portal**; that login
also sends IAAA's `remTrustChk=true` (`iaaa_oauth_login`), marking the device
trusted in the shared cookie jar. **Blackboard** then logs in with an *empty*
OTP and is verified by listing courses (`blackboard_courses_ok` — a real
`get_courses`, not a `bb_homepage` GET, which 200s on an unauthenticated guest
page). The trusted-device cookie persists in `ua.json`, so later runs reuse the
session — often with no OTP at all.

## The result envelope

Every tool returns one of:

```jsonc
{ "status": "ok",        "data": { /* payload */ } }
{ "status": "needs_otp", "mobile_mask": "135****1234", "hint": "log in once with an OTP…" }
```

The gateway adds a third for the deterministic path when a tool reports `isError`
(e.g. pku3b not configured): `{ "status": "error", "message": "…" }`. The
frontend branches on `status`.

## Process & runtime boundary

`pku3b` uses the `compio` async runtime; the backend uses asyncio. They never
share a runtime — they communicate over stdio across a process boundary. This is
why pku3b is a *separate MCP server subprocess*, not a linked library.

## What P0 deliberately omits

Write tools / permission matrix / OTP UI round-trip (P2), SQLite persistence
(P1), external forums (P3), credential encryption (P4), streaming chat — the
post-P0 roadmap. (P1 added the Store + Composer + dashboard routes; P2 added the
PermissionGate + the 交作业 write slice — see "Write path (P2)" above. External
forums, credential encryption, and streaming chat remain.)

## Deferred sources (P3) — interfaces designed, not yet built

The P1 dashboard renders placeholder "待接入 (P3)" panels for four data sources
pku3b / the backend cannot feed yet. Their **GUI + typed data contracts are in
place** (types in `frontend/src/api.ts`; the contract documented below) so P3
implements a scraper/endpoint against a fixed shape — no frontend rework. There
is deliberately **no dead backend route and no stub MCP tool** for these today.

| Source | P3 will be | Contract | Defined in |
|--------|-----------|----------|-----------|
| 教务通知 (dean's office) | a **future MCP tool** on `pku3b` | `get_dean_updates` → `DeanUpdate` | `docs/mcp-protocol.md` |
| 北大树洞 (treehole) | **future MCP tools** on `pku3b` (IAAA reuse) | `list_treehole_posts` / `get_treehole_post` → `TreeholePost` | `docs/mcp-protocol.md` |
| 文档库 (personal docs) | a **future backend feature** (not pku3b/MCP) | `GET /api/docs/search` → `DocResult` | here |
| 记忆 (long-term agent memory) | a **future backend feature** | `GET /api/memory` → `MemoryEntry` | here |

The doc-library and memory endpoints will be **new backend routes**, added
alongside `routes/dashboard.py` when P3 builds them (they are not teaching-network
data, so they do not belong on the `pku3b` MCP server).
