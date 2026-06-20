# Development

## Prerequisites

- Rust (edition 2024) + cargo
- Python ≥ 3.11
- Node ≥ 20

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/VioletVenti/MyAL1S.git
# or, after a plain clone:
git submodule update --init --recursive
```

## Run the whole stack (3 terminals)

```bash
# 1) Build the MCP server (the backend spawns it)
cd pku3b && cargo build --release --features mcp
./target/release/pku3b init      # student id / password (once)
# Log in via the frontend login bar (one OTP — see below); or warm ua.json from
# the CLI with: ./target/release/pku3b ct

# 2) Backend
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env              # set ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000

# 3) Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Then open http://localhost:5173 — the dashboard renders deterministically; the
chat box drives the agent.

**Logging in:** enter your phone OTP **once** in the top login bar. It is spent
on the portal and marks the device trusted (`remTrustChk`), so Blackboard
connects with no second OTP; the session persists in `ua.json` for later runs.

## Tests

```bash
# Rust (registry, envelopes, JSON-RPC framing). The pre-existing test_sb_login
# needs PKU3B_TEST_* env vars + network; skip it:
cd pku3b && cargo test --features mcp -- --skip test_sb_login

# Python (spawns the real pku3b mcp; skips if the binary isn't built)
cd backend && pytest

# Frontend type-check + build
cd frontend && npm run build
```

Quick stdio smoke of the MCP server (no credentials needed):

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | pku3b/target/release/pku3b mcp
```

## How to add a new MCP tool  ← the most common change

Adding a capability is the high-frequency task. It is **one file** in the common
case (`pku3b/src/mcp/tools.rs`), and both consumers (dashboard + agent) pick it up
automatically.

1. **Register it** in `tool_specs()` — name, title, description, input JSON
   Schema, `read_only`. Keep `read_only: true` unless it has side effects (P0 is
   read-only; side-effecting tools are gated by the P2 permission matrix).

2. **Implement it** as a private `async fn` on `ToolRegistry`, returning the
   `ok(...)` / `needs_otp(...)` envelope. Reuse `self.cfg()` + `auth::login_*`
   for anything that needs a session, then call the relevant `crate::api::*`
   method. Mirror `get_grades` / `list_assignments`.

3. **Dispatch it** in `ToolRegistry::call` — add a `match` arm mapping the tool
   name to your method (parse args from the `serde_json::Value`).

4. **Test** the catalog entry (pure, no network) in the `tests` module, and the
   live behaviour via the stdio smoke above.

5. **Expose it to the dashboard** *(only if deterministic)* — add a fetcher in
   `frontend/src/api.ts`, a panel in `Dashboard.tsx`, and a route in
   `backend/app/routes/deterministic.py`. The agent needs **no** change — it
   discovers new tools via `tools/list`.

That's the whole loop. The registry is the single source of tool metadata; the
transport and the agent are generic over it.

## Git / submodule workflow

`pku3b` is a **submodule** (its own repo, `VioletVenti/pku3b`). Changes to the
MCP server live there:

```bash
cd pku3b
git checkout -b feat/whatever
# … edit, cargo test --features mcp …
git commit && git push        # to VioletVenti/pku3b (open a PR there)
```

Then record the new submodule commit in MyAL1S:

```bash
cd ..            # MyAL1S root
git add pku3b    # stages the gitlink bump
git commit -m "chore: bump pku3b submodule"
```

Only bump the pointer **after** the pku3b commit is pushed, so fresh clones can
resolve it. Backend/frontend changes are ordinary commits in MyAL1S.

## Security (the repo is public)

Never commit `cfg.toml`, `ua.json`, `.env`, or `*.sqlite` — all are gitignored.
Re-scan staged files before each commit.
