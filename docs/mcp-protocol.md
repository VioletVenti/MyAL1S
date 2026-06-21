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

## Tools (read-only data tools; P0 + P1)

| name | arguments | `data` payload |
|------|-----------|----------------|
| `get_course_table` | `{}` | portal course-table JSON |
| `list_assignments` | `{ include_finished?: bool = false }` | `{ include_finished, assignments: [{id, course, title, deadline, deadline_raw, submitted, last_attempt}] }`, sorted by deadline |
| `get_grades` | `{}` | `{ grades: [{course, item, score, possible}] }` |
| `get_announcements` | `{}` | `{ announcements: [{id, course, title, time, descriptions[], attachments[]}] }`, sorted newest-first by `time` (items without a time go last) |
| `list_course_materials` | `{}` | `{ materials: [{course, ccid, title, kind, attachments}] }` — content-tree items **excluding** assignment/announcement kinds (those have their own tools); `ccid` is `course_id:content_id`, `kind` is the `CourseContentKind` Debug name (Document/File/Folder/Audio/Quiz/…), `attachments` is a count |
| `list_videos` | `{}` | `{ videos: [{id, course, title, time}] }`, sorted newest-first |

`id` (on assignments, announcements, videos) is a **stable** per-item identity — callers use it to star / dedupe / detect "new since last visit". `submit_file` (the only side-effecting pku3b API) is **not** exposed.

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
