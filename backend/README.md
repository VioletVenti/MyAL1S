# MyAL1S backend

FastAPI backend hosting (a) a **PydanticAI agent** whose tools are the pku3b MCP
tools, and (b) **deterministic REST endpoints** that call those same tools
directly, never through the LLM.

```
app/
  settings.py        # env / .env config (LLM model, pku3b binary path)
  mcp_gateway.py     # McpGateway: owns the `pku3b mcp` subprocess + agent
  routes/
    deterministic.py # GET /api/course-table | /api/assignments | /api/grades  (no LLM)
    chat.py          # POST /api/chat  (PydanticAI agent)
  main.py            # app + lifespan + CORS
```

## Prerequisites

1. **Build the pku3b MCP server** (the backend spawns it):
   ```bash
   (cd ../pku3b && cargo build --release --features mcp)
   ```
2. **Configure pku3b credentials and warm the session** (so the agent isn't
   asked for an OTP it can't answer in P0):
   ```bash
   ../pku3b/target/release/pku3b init     # set student id / password
   ../pku3b/target/release/pku3b ct        # one login to populate ua.json
   ```

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env        # then edit: ANTHROPIC_API_KEY=...
```

`.env` (gitignored) holds your `ANTHROPIC_API_KEY` and, optionally, overrides for
`MYAL1S_LLM_MODEL` and `MYAL1S_PKU3B_BIN`. See `.env.example`.

### Custom LLM endpoint (proxy / relay / gateway)

To route the LLM through a custom endpoint (e.g. a Claude relay), set
`MYAL1S_LLM_BASE_URL` and `MYAL1S_LLM_API_KEY`. The provider is chosen by the
`MYAL1S_LLM_MODEL` prefix:

- **Anthropic-compatible** relay (`/v1/messages`):
  `MYAL1S_LLM_MODEL=anthropic:claude-opus-4-8`
- **OpenAI-compatible** relay (`/v1/chat/completions`):
  `MYAL1S_LLM_MODEL=openai:claude-3-5-sonnet`

Leave both unset to use the provider's official endpoint and the standard
`ANTHROPIC_API_KEY`. Implemented in `app/llm.py`.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- Dashboard data (no LLM): `curl localhost:8000/api/course-table`
- Chat: `curl -XPOST localhost:8000/api/chat -H 'content-type: application/json' \
    -d '{"message":"这周有哪些作业，按 DDL 排序"}'`

Each deterministic endpoint returns the tool envelope:
```jsonc
{ "status": "ok", "data": { ... } }
{ "status": "needs_otp", "mobile_mask": "...", "hint": "..." }   // run `pku3b ct` once
```

## Test

```bash
pytest            # gateway integration test skips itself if pku3b binary is missing
```

The integration test spawns the real `pku3b mcp` and asserts `list_tools` +
`call_tool` work. Tools that need a live login return a `needs_otp` / config
envelope rather than failing, so the test passes without PKU credentials.
