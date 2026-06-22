#!/usr/bin/env bash
# ============================================================================
#  run.sh — one-command deploy for the MyAL1S stack.
#
#  Creates a tmux session "myal1s" with 3 windows, each running one piece:
#    0  pku3b     — warm the teaching-network session (pku3b ct)
#    1  backend   — uvicorn (FastAPI + PydanticAI + pku3b mcp subprocess)
#    2  frontend  — vite dev server (http://localhost:5173)
#
#  Usage:
#    ./run.sh            start the stack (build/installs if anything is missing)
#    ./run.sh stop       stop & tear down the session + free the ports
#    ./run.sh restart    stop + start
#    ./run.sh attach     attach to the running session (≡ tmux attach -t myal1s)
#
#  Inside tmux:  Ctrl+b 0/1/2  switch windows ·  Ctrl+b d  detach ·  exit each
#  window's process to stop just that piece.
# ============================================================================

set -euo pipefail

SESSION="myal1s"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKU3B="$ROOT/pku3b"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PKU3B_BIN="$PKU3B/target/release/pku3b"

# Color helpers (only when stdout is a tty).
if [ -t 1 ]; then
  BLUE='\033[1;34m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; RED='\033[1;31m'; CYAN='\033[1;36m'; R='\033[0m'
else
  BLUE=''; GREEN=''; YELLOW=''; RED=''; CYAN=''; R=''
fi
info()  { printf "${BLUE}[run]${R} %s\n" "$*"; }
ok()    { printf "${GREEN}[ok]${R}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${R}  %s\n" "$*" >&2; }
die()   { printf "${RED}[x]${R}   %s\n" "$*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || die "${2:-missing required command: $1}"; }

# ----------------------------------------------------------------------------
stop_stack() {
  info "stopping session '$SESSION' (if any)…"
  tmux kill-session -t "$SESSION" 2>/dev/null && ok "tmux session killed" || ok "no tmux session to kill"
  # Free the ports in case stale processes linger outside tmux.
  for port in 8000 5173; do
    local pid
    pid="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      warn "freeing port $port (pid $pid)"
      kill "$pid" 2>/dev/null || true
    fi
  done
  ok "stopped."
}

# ----------------------------------------------------------------------------
preflight() {
  require tmux
  require cargo "cargo not found (install Rust to build pku3b)"
  require python3
  require npm

  # --- pku3b binary: build if missing or if any src is newer than the binary.
  if [ ! -x "$PKU3B_BIN" ] || find "$PKU3B/src" -type f -newer "$PKU3B_BIN" | grep -q .; then
    info "building pku3b (release, --features mcp) — first time can take a few minutes…"
    ( cd "$PKU3B" && cargo build --release --features mcp ) || die "pku3b build failed"
  fi
  ok "pku3b binary ready"

  # --- pku3b credentials.
  if [ ! -f "$HOME/.config/pku3b/cfg.toml" ]; then
    warn "no pku3b cfg.toml found — run  $PKU3B_BIN init  once to set student id/password."
  fi

  # --- backend venv.
  if [ ! -x "$BACKEND/.venv/bin/python" ]; then
    info "creating backend venv + installing deps…"
    ( cd "$BACKEND" && python3 -m venv .venv && .venv/bin/python -m pip install -e ".[dev]" ) \
      || die "backend install failed"
  fi
  ok "backend venv ready"

  # --- backend .env (copy from example if missing).
  if [ ! -f "$BACKEND/.env" ]; then
    warn "no backend/.env — copying from .env.example (EDIT to set ANTHROPIC_API_KEY/relay)"
    cp "$BACKEND/.env.example" "$BACKEND/.env"
  fi

  # --- frontend deps.
  if [ ! -d "$FRONTEND/node_modules" ]; then
    info "installing frontend deps…"
    ( cd "$FRONTEND" && npm install ) || die "frontend npm install failed"
  fi
  ok "frontend deps ready"
}

# ----------------------------------------------------------------------------
start_stack() {
  preflight

  # Don't double-start.
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    warn "session '$SESSION' already exists. Run  ./run.sh stop  first, or  ./run.sh attach."
    exit 0
  fi

  info "creating tmux session '$SESSION' with 3 windows…"

  # Window 0 — pku3b: warm the session once, then drop to a shell in pku3b/
  # (so the window stays useful for re-running pku3b commands). pku3b ct prints
  # the course table; its login also warms ua.json so the web OTP login is smooth.
  tmux new-session -d -s "$SESSION" -n pku3b -c "$PKU3B" \
    "./target/release/pku3b ct; echo; echo '[pku3b] session warmed. This shell is in pku3b/.'; exec \$SHELL"

  # Window 1 — backend: uvicorn with --reload (picks up backend edits).
  tmux new-window  -t "$SESSION" -n backend  -c "$BACKEND" \
    ".venv/bin/python -m uvicorn app.main:app --reload --port 8000"

  # Window 2 — frontend: vite dev server.
  tmux new-window  -t "$SESSION" -n frontend -c "$FRONTEND" \
    "npm run dev"

  echo
  ok "stack is up in tmux session '$SESSION'."
  printf "\n"
  printf "  ${CYAN}attach:${R}    ./run.sh attach   (or:  tmux attach -t %s)\n" "$SESSION"
  printf "  ${CYAN}switch:${R}    Ctrl+b then 0 / 1 / 2     (pku3b / backend / frontend)\n"
  printf "  ${CYAN}detach:${R}    Ctrl+b d                   (keeps everything running)\n"
  printf "  ${CYAN}stop:${R}      ./run.sh stop\n"
  printf "\n"
  printf "  ${GREEN}frontend:${R}  http://localhost:5173\n"
  printf "  ${GREEN}backend:${R}   http://localhost:8000/api/health\n"
  printf "\n"
  printf "  Tip: log into the teaching network once via the top login bar (one OTP)\n"
  printf "       after the pages load.\n"
  echo

  # Auto-attach if we're in an interactive terminal; otherwise just report.
  if [ -t 0 ] && [ -z "${TMUX:-}" ]; then
    info "attaching now… (Ctrl+b d to detach)"
    exec tmux attach -t "$SESSION"
  fi
}

# ----------------------------------------------------------------------------
case "${1:-start}" in
  start)  start_stack ;;
  stop)   stop_stack ;;
  attach) exec tmux attach -t "$SESSION" ;;
  restart) stop_stack; start_stack ;;
  -h|--help|help)
    sed -n '2,20p' "$0" ;;
  *) die "unknown command: $1 (try: start | stop | restart | attach)" ;;
esac
