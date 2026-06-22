# Session Log — 2026-06-21 — P1 Increment B (backend Store + Composer + routes)

**Plan:** `quality_reports/plans/replicated-waddling-garden.md` (approved)
**Branch:** MyAL1S `feat/p1-dashboard-backend`

## Goal
Add P1 persistence + deterministic composition to the backend: a Store (SQLite)
for stars / custom items / seen-ids / conversations, a Composer that joins live
MCP-tool data with the Store into the dashboard shapes, the dashboard routes, and
chat upgrades (model picker, persistent history, tool trace).

## What shipped
- **`backend/app/store.py`** (Seam 5, new): aiosqlite-backed Store. Four domains
  behind one connection: `stars` `(source,item_id)` with a snapshot (title/course/
  **date**); `custom_items` (rich: title/due/note/course/source/done);
  `seen_ids` (the 新到通知 watermark); `conversations`+`messages` (the message
  row carries the serialized pydantic-ai `ModelMessage` slice via
  `ModelMessagesTypeAdapter` for exact replay). Grouped typed methods; lifecycle
  via `connect()`/`__aenter__`; `CREATE TABLE IF NOT EXISTS` (no Alembic).
- **`backend/app/composer.py`** (Seam 6, new): `todo()` (stars+custom, snapshot-
  only, no crawl), `week(iso_week)` (course table + items in the ISO week),
  `new_notices()`/`mark_seen()` (live-id diff vs seen-ids). Degrades to empty on
  `needs_otp`/`error`; never raises. Protocol-typed gateway dep (fake-able).
- **`backend/app/routes/dashboard.py`** (new, deterministic): stars CRUD,
  custom-items CRUD, `/api/todo`, `/api/calendar?week=`, `/api/new-notices`,
  `/api/new-notices/mark-seen`.
- **`backend/app/routes/chat.py`** (extended): `model` picker via new
  `llm.build_model_for`; `conversation_id` → load `message_history`, persist new
  turn split into user-request + response slices; `trace` from
  `result.all_messages()`; `GET /api/conversations[/{id}]`, `DELETE`, `GET /api/models`.
- **`backend/app/llm.py`**: refactored to share one `_build` provider-router
  between `build_model` (default) and `build_model_for` (picker).
- **`backend/app/main.py`**: lifespan now owns Store + Composer (AsyncExitStack).
- **Settings**: `sqlite_path`, `chat_models` registry (+ `chat_model_entries`
  parser). pyproject: `aiosqlite>=0.20`. `.env.example` documented.

## Verification
- `pytest` → **27 passed** (was 8). New: `test_store.py` (8), `test_composer.py`
  (9, incl. AST-based no-LLM structural assertion), `test_app.py`
  (`test_dashboard_persistence_and_composition_endpoints` spawns the real
  subprocess + exercises the Store-backed endpoints; `test_models_picker_registry_parses_in_order`).
- Store smoke: all four domains incl. `ModelMessage` round-trip.
- De-risked: `Agent.run(model=...)` accepts `Model | KnownModelName | str | None`
  (picker works for the default string provider, not only relays).

## Design refinements vs. plan draft
- stars column `deadline` → **`date`** (neutral anchor: an announcement's is its
  publish time).
- no-LLM assertion is **AST-based** (a docstring mentioning `pydantic_ai`
  doesn't false-positive).

## Docs synced
- `docs/architecture.md`: diagram + seam table add Seam 5 (Store) & 6 (Composer);
  dashboard request-lifecycle; P0-omits note updated.
- `docs/development.md`: "Store / Composer (P1)" section; dashboard-exposure step
  points to the Composer.

## Next
Pause for user review. Then Increment C (frontend) on `feat/p1-dashboard-frontend`.
