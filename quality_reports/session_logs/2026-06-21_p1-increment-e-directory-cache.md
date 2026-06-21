# Session Log — 2026-06-21 — P1 Increment E (directory sidebar + cache + prefetch + pagination)

**Plan:** `quality_reports/plans/replicated-waddling-garden.md` (Increment E, approved)
**Branch:** MyAL1S `feat/p1-directory-cache`
**Commit:** `7d99343`

## Goal
Four UX asks: (1) 目录 = 左侧栏点选、一次一个模块（非九宫格）；(2) 固定大小 + 翻页；
(3) 登录后立即初始化全部数据；(4) 重启后保留上次内容。

## What shipped
- **Backend snapshot cache** (survives backend restart):
  - `store.py`: new `snapshots` table (key→envelope JSON+fetched_at), 6th Store
    domain; `put_snapshot`/`get_snapshot`/`snapshot_keys`.
  - `routes/deterministic.py`: `_cached` helper — live ok→write snapshot+return;
    needs_otp/error→serve cached snapshot marked `stale:true`+`fetched_at`.
  - `routes/session.py`: on fully-connected login, detached `warm_snapshots`
    task warms all 6 sources (reuses `_cached`); never blocks the login response.
- **Frontend directory sidebar nav** (`Dashboard.tsx`): left `.dir-nav` + right
  `.dir-content` showing only the selected module; deferred group (待接入) separated.
- **List pagination** (`widgets.tsx` `usePagination` + `<Pager>`): 5 list panels,
  15/page, ‹ 上一页 / 下一页 ›.
- **useEnvelope localStorage cache** (`widgets.tsx`): optional `cacheKey` →
  seeds initial state from localStorage (instant refresh paint), writes back on
  success; silent degrade if localStorage unavailable. `EnvelopeBody` shows a
  离线缓存 badge on stale envelopes.

## Verification (all gates green)
- backend `pytest` → **34 passed** (snapshots CRUD, live-or-snapshot fallback
  tested in isolation since the warm-session env can't force a live failure,
  login-prefetch wiring).
- frontend `npm run build` clean; `npm test` → **23 passed** (usePagination,
  useEnvelope localStorage seed/writeback/silent-degrade, directory nav
  one-module-at-a-time, stale badge).

## Decisions (grilling-confirmed)
- Persistence = backend Store snapshot (only layer surviving a backend restart);
  localStorage mirrors for instant browser-refresh paint.
- Prefetch = login → detached background task warming all sources.
- Directory = sidebar nav, one module at a time.
- Pagination = real prev/next, 15/page.

## Key test-design note
The live-failure fallback couldn't be exercised end-to-end (this env has a warm
session → live always succeeds). Tested it in isolation: own connected Store +
fake gateway returning needs_otp → helper serves the seeded snapshot marked
stale. The end-to-end "restart backend → stale content" is the manual smoke step.

## Next
Increment E complete. P1 (A-E) fully delivered, each reviewed. Stack not running.
Open: push the branches (pku3b first, then MyAL1S) when user is ready.
