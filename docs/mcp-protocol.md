# `pku3b mcp` protocol contract

What the `pku3b mcp` server implements, so backend/agent code (and any other MCP
client) can rely on it. Implemented in `pku3b/src/mcp/`.

## Transport

- **Newline-delimited JSON-RPC 2.0 over stdio** (MCP stdio transport,
  spec 2025-06-18). One message per line; messages contain **no embedded
  newlines** (responses are serialized compactly).
- `stdout` carries **only** MCP messages. Logs go to `stderr` (`RUST_LOG`).
- The client launches `pku3b mcp` as a subprocess and closes stdin to stop it.

## Methods

| Method | Request → Response |
|--------|--------------------|
| `initialize` | → `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version } }`. The server **echoes** the client's `protocolVersion` when given. |
| `notifications/initialized` | notification, no response |
| `ping` | → `{}` |
| `tools/list` | → `{ tools: [ { name, description, inputSchema, annotations: { title, readOnlyHint } } ] }` |
| `tools/call` | params `{ name, arguments }` → `{ content: [{type:"text", text}], structuredContent, isError }` |

Errors: unknown method → JSON-RPC `-32601`; unknown tool → `-32602`; parse error
→ `-32700`. A tool that *runs but fails* returns a normal result with
`isError: true` (clients like pydantic-ai surface this as an exception).

## Tools (read-only data tools; P0 + P1) + the write primitive (P2)

| name | arguments | `data` payload |
|------|-----------|----------------|
| `get_course_table` | `{}` | portal course-table JSON |
| `list_assignments` | `{ include_finished?: bool = false }` | `{ include_finished, assignments: [{id, course, title, deadline, deadline_raw, submitted, last_attempt}] }`, sorted by deadline |
| `get_grades` | `{}` | `{ grades: [{course, item, score, possible}] }` |
| `get_announcements` | `{}` | `{ announcements: [{id, course, title, time, descriptions[], attachments[]}] }`, sorted newest-first by `time` (items without a time go last); `attachments` is an array of attachment **names** |
| `list_course_materials` | `{}` | `{ materials: [{course, ccid, title, kind, attachment_count}] }` — content-tree items **excluding** assignment/announcement kinds (those have their own tools); `ccid` is `course_id:content_id`, `kind` is a **Chinese label** (文档/文件/文件夹/音频/测试/其它 — mapped from `CourseContentKind`, never a Rust Debug name), `attachment_count` is an integer |
| `list_videos` | `{}` | `{ videos: [{id, course, title, time}] }`, sorted newest-first |
| `submit_assignment` | `{ assignment_id, file_path, otp? }` | `{ assignment_id, submitted: true }` on success |

`id` (on assignments, announcements, videos) is a **stable** per-item identity —
callers use it to star / dedupe / detect "new since last visit".

### `submit_assignment` — the side-effecting execution primitive (P2)

`submit_assignment` is `read_only: false` and wraps `CourseAssignment::submit_file`.
It takes a **server-local** `file_path` (a path the `pku3b mcp` process can read)
and a stable `assignment_id` (from `list_assignments`). Because the id is a
non-decodable hash, the tool re-walks the content tree and matches by id (the
same walk `list_assignments` uses), then submits the file.

It is the **execution primitive the backend's permission gate dispatches to
directly** via `tools/call` — it is **NOT exposed to the LLM agent**. The backend
filters it out of the agent's toolset and offers a local `submit_assignment(
assignment_id, file_id)` proxy instead, so the model never sees or invents a
server-local path. The gate resolves the opaque `file_id` → absolute `file_path`
just-in-time at dispatch. See `docs/architecture.md` (Seam 7) and
`docs/development.md` ("How to add a write tool").

## Future tools (P3)

### 北大树洞 — IMPLEMENTED (P3 Increment S+A, read-only)

Auth: IAAA OTP (appid `PKU Helper`) → `/cas_iaaa_login` (root) →
`/web/iaaa_success?token=<JWT>` (Bearer). API base `/chapi/api/v3/`. Headers:
`Authorization: Bearer <JWT>` + `uuid` + `userAgent: pku_web`. First-use gate
(code=40002) is a 令牌验证 (not IAAA OTP) → `status: needs_treehole_token`.
See `docs/architecture.md` + memory `myal1s-p3-treehole-protocol` for the full
protocol.

| name | arguments | `data` payload |
|------|-----------|----------------|
| `treehole_list` | `{ page?, limit?, otp? }` | `{ holes: [{pid, text, time, timestamp, reply, likenum, tag}] }` |
| `treehole_get` | `{ pid: int, otp? }` | `{ pid, text, time, timestamp, reply, likenum, tag }` (single hole) |
| `treehole_list_comments` | `{ pid: int, page?, otp? }` | `{ holes: [...] }` (floors) |
| `treehole_my_list` | `{ page?, otp? }` | `{ holes: [...] }` |
| `treehole_history` | `{ page?, otp? }` | `{ holes: [...] }` |
| `treehole_attention` | `{ page?, otp? }` | `{ holes: [...] }` (关注的帖子) |
| `treehole_search` | `{ keyword: string, page?, otp? }` | `{ holes: [...] }` (关键词搜索) |
| `treehole_messages` | `{ message_type?, page?, otp? }` | `{ messages: [{description, pid, time}] }` |
| `treehole_unread` | `{ message_type?, otp? }` | `{ count: int }` |
| `treehole_post` | `{ text: string, tag?, otp? }` | `{ pid: int, posted: true }` — **写** (read_only:false, 经 PermissionGate) |
| `treehole_comment` | `{ pid: int, text: string, otp? }` | `{ cid: int, posted: true }` — **写** (read_only:false, 经 PermissionGate) |

The 9 read tools are `read_only: true`. `treehole_post`/`treehole_comment` are
`read_only: false` — side-effecting execution primitives, gated by the backend
PermissionGate (confirm = pending approval; auto = direct dispatch). `pid` is a
stable per-post integer identity. `needs_treehole_token` (code=40002) is a
distinct gate — the令牌验证, not IAAA OTP login.

### 教务通知 — NOT yet implemented

| name (planned) | arguments | `data` payload |
|------|-----------|----------------|
| `get_dean_updates` | `{}` | `{ updates: [{id, title, time, category, url, summary}] }` — dean's-office notices |

## Result envelope

`tools/call` results carry both a text content block and `structuredContent`,
both holding the same envelope:

```jsonc
{ "status": "ok",        "data": { /* per-tool payload above */ } }
{ "status": "needs_otp", "mobile_mask": "135****1234", "hint": "log in once with an OTP…" }
```

`needs_otp` is **not** an error (`isError: false`) — it is a normal result the
client should surface as "log in first". Clients add a `{status:"error"}` form
when a call raises.

> The **MCP tools** themselves only ever emit `ok` / `needs_otp` / `error`. The
> P2 **write-path statuses** (`pending_approval`, `denied`, `already_decided`)
> are produced by the backend's PermissionGate (not by `tools/call`); see
> `docs/architecture.md` → "Write path (P2)".

## Auth model

The server reuses pku3b's `cfg.toml` (credentials) and `ua.json` (cookies).
Login is **prompt-free**: it never blocks on a terminal. If an OTP is required
and unavailable, tools return `needs_otp` rather than hanging. Config is read
lazily, so `initialize` and `tools/list` work before the user has configured
anything.

### `login` tool — one OTP for both services

`login` (the only non-read-only tool) takes `{ otp: string }` and returns
`{ status:"ok", data:{ portal: bool, blackboard: bool } }` (or `needs_otp` when
called with no OTP and not already connected). A **single** OTP connects both
services: it is spent on the portal login, which also sends IAAA's
`remTrustChk=true` to mark the device trusted; Blackboard then logs in with an
empty OTP (no second prompt) and is verified by listing courses. The trusted
device + warm `ua.json` mean later runs usually need no OTP at all. The
deterministic data tools above reuse this session, so they normally omit `otp`.
