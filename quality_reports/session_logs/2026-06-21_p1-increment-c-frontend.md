# Session Log — 2026-06-21 — P1 Increment C (frontend)

**Plan:** `quality_reports/plans/replicated-waddling-garden.md` (approved)
**Branch:** MyAL1S `feat/p1-dashboard-frontend`

## Goal
Build the P1 dashboard UI + chat upgrades on top of Increment B's backend:
weekly calendar + 待办 + 新到通知 + star + custom items + materials/videos +
deferred-source placeholders + chat (model picker / trace / history), keeping
the lean stack (no router, no calendar lib).

## What shipped
- **C0 (backend gap fix):** 3 thin deterministic routes (`/api/announcements`,
  `/api/materials`, `/api/videos`) mirroring `/api/assignments`. The dashboard
  panels need no-LLM access to the new tools — the invariant forbids chat.
- **`widgets.tsx`** — shared `useEnvelope` / `Panel` / `EnvelopeBody` / date +
  weekday helpers (extracted from Dashboard to avoid circular imports).
- **`stars.tsx`** — `StarProvider` owns one star set; `StarToggle` is consistent
  across every panel (todo / new-notices / assignments / announcements /
  calendar reveal).
- **`Calendar.tsx`** — weekly 7-day grid of the recurring 课表 (period-based),
  ISO-week nav (prev/next/today), default classes-only, click a day to reveal
  that day's starred + custom items from `/api/calendar`. Pure ISO-week helpers.
- **`TodoModule.tsx`** — `/api/todo` unified undone list (stars + custom) sorted
  by date; create form on top; star→unstar, custom→done/edit/delete.
- **`NewNoticesPanel.tsx`** — `/api/new-notices` (seen-id diff) + 标记已读.
- **`CustomItemEditor.tsx`** — `CustomItemForm` (create) + `CustomTodoRow`
  (done / inline edit / delete) over a `/api/todo` custom item.
- **`DeferredPanel.tsx`** — generic typed "待接入 (P3)" placeholder; 4 instances
  (教务通知 / 树洞 / 文档库 / 记忆), no fetch, no backend route.
- **`Dashboard.tsx`** — composition root; refactored listing panels
  (assignments/announcements/materials/videos/grades) with star toggles; the
  old standalone CourseTablePanel is subsumed by the Calendar.
- **`ChatBox.tsx`** — model picker (`/api/models`), collapsible tool-call trace
  per turn, 新对话, 历史会话 sidebar (list + reopen via conversation_id).
- **`App.tsx`** — `StarProvider` shell, auto-refresh toggle (60s; pku3b caches
  1h so cheap), login→bump refresh.
- **`api.ts`** — all P1 types + fetchers + the 4 deferred-source type-only
  contracts (DeanUpdate / TreeholePost / DocResult / MemoryEntry).
- **`styles.css`** — calendar grid, star toggle, todo/custom forms, deferred,
  chat picker/trace/history; `.list li` made flex (rows have variable child
  counts now).

## Verification
- `npm run build` (`tsc --noEmit && vite build`) → **clean**, 39 modules, 218 kB JS.
- backend `pytest` → **30 passed** (the 3 new deterministic routes registered;
  no regressions).

## Docs synced
- README: P1 features + 待接入 note.
- architecture.md: deferred-sources table (dean/treehole future MCP tools;
  doc/memory future backend endpoints).
- mcp-protocol.md: future dean/treehole tool contracts (planned, not implemented).

## Commits (local, NOT pushed)
On `feat/p1-dashboard-frontend` (one commit planned after this log).

## Next
Increment C complete. P1 (A+B+C) is functionally whole. Next: optional `/review`
of C, then user pushes the three feature branches (pku3b + MyAL1S).
