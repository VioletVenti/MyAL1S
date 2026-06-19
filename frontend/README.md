# MyAL1S frontend

Minimal Vite + React + TS UI: a **deterministic dashboard** (course table,
assignments by DDL, grades — fetched straight from the backend's no-LLM
endpoints) and a **chat box** that talks to the PydanticAI agent.

```
src/
  api.ts        # typed client; every endpoint returns a {status} envelope
  Dashboard.tsx # 3 panels over /api/course-table | /api/assignments | /api/grades
  ChatBox.tsx   # POST /api/chat
  App.tsx       # layout
```

## Dev

The backend must be running on `:8000` (see `../backend/README.md`).

```bash
npm install
npm run dev          # http://localhost:5173  (proxies /api -> :8000)
```

## Build

```bash
npm run build        # type-check + bundle to dist/
npm run preview      # serve the built bundle
```

For production, `dist/` can be served by any static host, or mounted by the
FastAPI backend via `StaticFiles`.

## Notes

- All data on the dashboard comes through the **deterministic** endpoints — it
  never passes through the LLM. The chat box is the only LLM path.
- Panels surface the envelope status: `ok` renders data; `needs_otp` shows a
  hint to run `pku3b ct` once; `error` shows the message.
