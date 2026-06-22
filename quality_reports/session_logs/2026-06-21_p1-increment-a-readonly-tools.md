# Session Log — 2026-06-21 — P1 Increment A (read-only tools)

**Plan:** `quality_reports/plans/replicated-waddling-garden.md` (approved)
**Branches:** pku3b `feat/mcp-readonly-tools` · MyAL1S `feat/p1-readonly-tools`

## Goal
Deliver Increment A of the P1 data-dashboard: expose the rest of pku3b's read-only
teaching-network surface as MCP tools, and add a stable `id` so the frontend can
star / dedupe / detect-new.

## What shipped
- **pku3b `src/mcp/tools.rs`** (+214): three new read-only tools —
  `get_announcements` (reuses `Course::list_announcements_from_coursepage`),
  `list_course_materials` (content_stream minus Assignment/Announcement kinds),
  `list_videos` (reuses `Course::get_video_list`). All use `otp_optional_schema`,
  all `read_only`. Added stable `id` (`CourseAssignmentHandle::id`) to
  `list_assignments` output; announcements/videos already carry ids.
- **Tests:** extended `catalog_named_and_login_is_only_non_read_only`; added
  invariant test `all_data_tools_carry_optional_otp_schema`.
- **`docs/mcp-protocol.md`:** tool table now lists all 6 read-only tools + the id note.

## Verification
- `cargo test --features mcp -- --skip test_sb_login` → **18 passed, 0 failed**.
- stdio smoke (`printf … | pku3b mcp`): `tools/list` → **7 tools** = login + 6 read-only
  (get_course_table, list_assignments, get_grades, get_announcements,
  list_course_materials, list_videos), all new ones `readOnly=True`.
- `id` in payloads: compile + inspection only; live confirmation deferred to the
  manual stack smoke (needs OTP/credentials).

## Commits (local, NOT pushed — user pushes; pku3b first, then MyAL1S)
- pku3b `feat/mcp-readonly-tools` @ `20c04dc` — `feat(mcp): expose read-only announcements, materials, videos + stable ids`
- MyAL1S `feat/p1-readonly-tools` @ `ac8164d` — `feat(p1-a): bump pku3b (read-only announcements/materials/videos) + protocol doc`

## Decisions / notes
- Verb-style tool names; **no** P0 rename (per grilling).
- `list_course_materials` excludes Assignment + Announcement kinds to avoid duplication.
- Listings only — file/video download intentionally out of P1.
- pku3b's `get_video_list` (listing) is **not** feature-gated; only `video-download` is.

## Next
Pause for user review of Increment A. Then Increment B (backend Store + composer + routes)
on `feat/p1-dashboard-backend`, then C (frontend) on `feat/p1-dashboard-frontend`.
