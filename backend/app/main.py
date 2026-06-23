"""FastAPI application: wires the MCP gateway, Store, and Composer lifespans + routes.

Three consumers of one MCP tool catalog:
- deterministic routes (`/api/course-table`, `/api/assignments`, `/api/grades`)
  call tools directly — never through the LLM;
- `/api/chat` drives the PydanticAI agent over the same tools;
- dashboard routes (`/api/todo`, `/api/calendar`, `/api/new-notices`, …) call the
  Composer, which joins live tools with persisted state — also never through the
  LLM.

P2 adds the write side: a `PermissionGate` (Seam 7) + `Uploads` helper, exposed
by the uploads / approvals / submit / permissions routes — all LLM-free (only
`/api/chat` touches the agent).
"""

from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .composer import Composer
from .mcp_gateway import McpGateway
from .permissions import PermissionGate
from .routes import approvals, chat, dashboard, deterministic, permissions, session, submit, uploads
from .settings import get_settings
from .store import Store
from .uploads import Uploads


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # One gateway (one pku3b mcp subprocess) for the app's lifetime.
    gateway = McpGateway(settings)
    # One Store (one SQLite connection) for the app's lifetime.
    store = Store(settings.sqlite_path)
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(gateway)
        await stack.enter_async_context(store)
        # The Composer glues store+gateway for reads; holds no resources.
        composer = Composer(store, gateway)
        # P2 write side: the gate dispatches matrix-gated writes through the
        # gateway; uploads stores attached files. Neither holds async resources.
        uploads = Uploads(settings.uploads_dir)
        gate = PermissionGate(store, gateway, uploads)
        # P2: give the agent its file_id-based write tool + hide the path-based
        # MCP primitive from it. Done after the gate exists (the tool closes over
        # it) and after the gateway is entered (the server is live).
        gateway.attach_write_toolset(gate)
        app.state.gateway = gateway
        app.state.store = store
        app.state.composer = composer
        app.state.uploads = uploads
        app.state.gate = gate
        yield


app = FastAPI(title="MyAL1S backend", version="0.1.0", lifespan=lifespan)

# Allow the Vite dev server to call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(deterministic.router)
app.include_router(dashboard.router)
app.include_router(chat.router)
app.include_router(session.router)
app.include_router(uploads.router)
app.include_router(approvals.router)
app.include_router(submit.router)
app.include_router(permissions.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}

