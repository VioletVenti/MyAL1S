# Session Log — 2026-06-21 — P1 Increment B review fixes

**Plan:** `quality_reports/plans/replicated-waddling-garden.md` (approved)
**Branch:** MyAL1S `feat/p1-dashboard-backend`
**Prior session log:** `2026-06-21_p1-increment-b-backend.md` (the B build itself)

## Goal
Apply the fixes from the two-axis `/review` of Increment B (Standards + Spec),
before moving to Increment C (frontend).

## What the review found (the actionable subset)
- **Spec (major):** `todo()` rendered from Store snapshots only — the spec (B3)
  required live enrichment via `gateway.call_tool` with snapshot fallback. The
  pure-snapshot approach left submitted assignments stuck in 待办 (broke the
  "undone" semantics). User chose **option B = live enrichment**.
- **Spec (text drift):** stars column `deadline`→`date`, messages column
  `pydantic_messages`→`pydantic_json`, `build_model_for(model_id, …)`→`model_str`.
  Renames not yet reflected in the spec text.
- **Spec (scope creep):** `/api/models` endpoint (kept — C3 will use it; written
  into the spec).
- **Standards (dead code):** `Store.conversation_titles`, `Store._pydantic_roundtrip`
  — zero callers.

## What shipped (commit c7c9b8e)
- **`composer.todo()` rewritten for live enrichment:** fetches
  `list_assignments include_finished=True` + `get_announcements`, enriches each
  starred item with live title/course/date + `submitted`, falls back to the star
  snapshot when an item is no longer live. A live-and-submitted starred assignment
  and a `done` custom item are **excluded** from 待办 (star retained for
  /stars + calendar). New helpers `_live_index`, `_enrich_star`. Offline
  (needs_otp/error) → snapshot fallback, 待办 still renders.
- **Store:** dropped the two unused helpers.
- **chat.py:** hoisted `import json` to module top.
- **Tests:** AST-based no-LLM structural assertion now used by BOTH the
  composer/dashboard test and the pre-existing deterministic-route test
  (consistency). Rewrote todo() tests for live enrichment + exclusions +
  fallback; relaxed the week() call-count assertion.
- **Plan spec text synced** to the renames + `/api/models` + the submitted-exclusion
  semantics; B status note updated (30 tests).

## Verification
- `pytest` → **30 passed** (was 27; net +3 from the rewritten todo tests).

## Commits (local, NOT pushed)
- `c7c9b8e fix(p1-b): todo() live enrichment per spec; drop dead Store helpers`
- (on top of `99bbbc8 feat(p1-b): …`)

## Next
Increment B is clean (working tree empty, 30 tests green). Next is
**Increment C** (frontend) on `feat/p1-dashboard-frontend`: weekly calendar +
待办 module + 新到通知 panel + star toggles + custom-item editor + materials/videos
views + deferred-source 待接入 placeholders + chat upgrades (model picker,
思考可见, 新对话, 历史会话). Awaiting user go-ahead.
