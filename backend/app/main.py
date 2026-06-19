"""FastAPI application: wires the MCP gateway lifespan + routes.

Two consumers of one MCP tool catalog:
- deterministic routes (`/api/course-table`, `/api/assignments`, `/api/grades`)
  call tools directly — never through the LLM;
- `/api/chat` drives the PydanticAI agent over the same tools.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .mcp_gateway import McpGateway
from .routes import chat, deterministic, session
from .settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One gateway (one pku3b mcp subprocess) for the app's lifetime.
    gateway = McpGateway(get_settings())
    async with gateway:
        app.state.gateway = gateway
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
app.include_router(chat.router)
app.include_router(session.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
