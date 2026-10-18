#!/usr/bin/env bash
# Start the terminal and every runnable model service for local development.
#
#   scripts/dev-all.sh              # terminal + IBAL + MMKT + COLL + agent worker
#   scripts/dev-all.sh --no-agent   # skip the agent worker
#   scripts/dev-all.sh --no-coll    # skip the collateral optimizer
#
# First run builds the virtualenvs, the pinned InventoryBallast engine export and the collateral
# wheel under .data/ (gitignored). Later runs reuse them. Ctrl-C stops everything started here.
#
# Needs: python3.12, node/npm, and a local InventoryBallast git checkout (INVENTORY_BALLAST_REPO,
# default ../../models/InventoryBallast). Tokens come from .env.local (see docs/services.md).
# SXU (8015) and liquidity (8016) have no runnable service yet, so they are not started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_AGENT=1
WITH_COLL=1
for arg in "$@"; do
  case "$arg" in
    --no-agent) WITH_AGENT=0 ;;
    --no-coll) WITH_COLL=0 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

DATA="$ROOT/.data"
LOGS="$DATA/logs"
mkdir -p "$LOGS"
IB_REPO="${INVENTORY_BALLAST_REPO:-$ROOT/../../models/InventoryBallast}"

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -f .env.local ] || die ".env.local not found; see docs/services.md for the tokens it needs"
set -a; . ./.env.local; set +a
: "${INVENTORY_OPTIMIZER_API_TOKEN:?missing in .env.local}"
: "${MONEY_MARKET_API_TOKEN:?missing in .env.local}"
if [ "$WITH_COLL" = 1 ]; then : "${COLLATERAL_OPTIMIZER_API_TOKEN:?missing in .env.local}"; fi
if [ "$WITH_AGENT" = 1 ]; then
  : "${AGENT_QUEUE_DB_URL:?missing in .env.local}"
  : "${AGENT_WORKER_TOKEN:?missing in .env.local}"
fi

PY="$(command -v python3.12 || true)"
[ -n "$PY" ] || die "python3.12 not found on PATH"
command -v npm >/dev/null || die "npm not found on PATH"

json() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2"; }
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
venv() { # venv <dir> <pip args...>: create once, then install
  local dir="$1"; shift
  [ -x "$dir/bin/python" ] || "$PY" -m venv "$dir"
  "$dir/bin/pip" install -q "$@" 2>&1 | grep -v '^\[notice\]' || true
}

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  say "stopping services"
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

start() { # start <name> <port|-> <cwd> <command...>
  local name="$1" port="$2" cwd="$3"; shift 3
  if [ "$port" != "-" ] && port_busy "$port"; then
    echo "  $name: port $port already in use, leaving it alone"; return
  fi
  (cd "$cwd" && exec "$@") >"$LOGS/$name.log" 2>&1 &
  PIDS+=("$!")
  echo "  $name: pid $! (log .data/logs/$name.log)"
}

wait_health() { # wait_health <name> <url> [body-pattern]
  for _ in $(seq 1 40); do
    if curl -fs -m 2 "$2" 2>/dev/null | grep -q "${3:-.}"; then echo "  $1: healthy"; return; fi
    sleep 0.5
  done
  echo "  $1: NOT healthy after 20s, see .data/logs/$1.log" >&2
}

# ── IBAL (8013): needs the pinned engine commit ─────────────────────────────
say "IBAL inventory optimizer (8013)"
IBAL_DIR="$ROOT/services/inventory_optimizer_api"
venv "$IBAL_DIR/.venv" -e "$IBAL_DIR[dev]"
IB_COMMIT="$(json "$IBAL_DIR/capability-manifest.json" engine_commit)"
ENGINE_DIR="$DATA/ibal-engine-$IB_COMMIT"
if [ ! -d "$ENGINE_DIR" ]; then
  [ -d "$IB_REPO/.git" ] || die "InventoryBallast checkout not found at $IB_REPO (set INVENTORY_BALLAST_REPO)"
  mkdir -p "$ENGINE_DIR"
  git -C "$IB_REPO" archive "$IB_COMMIT" | tar -x -C "$ENGINE_DIR" \
    || { rm -rf "$ENGINE_DIR"; die "commit $IB_COMMIT not in $IB_REPO"; }
fi
INVENTORY_OPTIMIZER_ENGINE_PATH="$ENGINE_DIR" INVENTORY_OPTIMIZER_ENGINE_COMMIT="$IB_COMMIT" \
  start ibal 8013 "$IBAL_DIR" .venv/bin/uvicorn inventory_optimizer_api.app:app --host 127.0.0.1 --port 8013

# ── MMKT (8014) ─────────────────────────────────────────────────────────────
say "MMKT money market optimizer (8014)"
MMKT_DIR="$ROOT/services/money_market_api"
venv "$MMKT_DIR/.venv" "$ROOT/services/optimization_core" "$MMKT_DIR"
MONEY_MARKET_MODEL_BINDING="${MONEY_MARKET_MODEL_BINDING:-local-mmkt-lp-v1}" \
  start mmkt 8014 "$MMKT_DIR" .venv/bin/uvicorn money_market_api.app:app --app-dir src --host 127.0.0.1 --port 8014

# ── COLL (8017): wheel built from the reviewed InventoryBallast commit ──────
if [ "$WITH_COLL" = 1 ]; then
  say "COLL collateral optimizer (8017)"
  COLL_DIR="$ROOT/services/collateral_optimizer_api"
  COLL_COMMIT="$(json "$COLL_DIR/binding-manifest.json" commit)"
  COLL_BUILD="$DATA/coll-$COLL_COMMIT"
  if [ ! -f "$COLL_BUILD/wheel/binding-attestation.json" ]; then
    [ -d "$IB_REPO/.git" ] || die "InventoryBallast checkout not found at $IB_REPO (set INVENTORY_BALLAST_REPO)"
    rm -rf "$COLL_BUILD"; mkdir -p "$COLL_BUILD/src"
    git -C "$IB_REPO" archive "$COLL_COMMIT" | tar -x -C "$COLL_BUILD/src" \
      || { rm -rf "$COLL_BUILD"; die "commit $COLL_COMMIT not in $IB_REPO"; }
    python3 scripts/build-collateral-wheel.py "$COLL_BUILD/src/projects/collateral_optimizer" \
      --output "$COLL_BUILD/wheel" >/dev/null
    rm -rf "$COLL_BUILD/venv"
  fi
  if [ ! -x "$COLL_BUILD/venv/bin/uvicorn" ]; then
    venv "$COLL_BUILD/venv" -r "$COLL_DIR/requirements.lock"
    "$COLL_BUILD/venv/bin/pip" install -q --no-deps "$COLL_BUILD"/wheel/collateral_optimizer-*.whl 2>&1 \
      | grep -v '^\[notice\]' || true
  fi
  PYTHONPATH="$COLL_DIR/src" COLLATERAL_BINDING_ATTESTATION="$COLL_BUILD/wheel/binding-attestation.json" \
    start coll 8017 "$ROOT" "$COLL_BUILD/venv/bin/uvicorn" collateral_optimizer_api.app:app --host 127.0.0.1 --port 8017
fi

# ── Terminal (3000) ─────────────────────────────────────────────────────────
say "Terminal (3000)"
[ -d node_modules ] || npm ci
start terminal 3000 "$ROOT" npm run dev

# ── Agent worker: polls the queue the terminal creates ──────────────────────
if [ "$WITH_AGENT" = 1 ]; then
  say "Agent worker"
  AGENT_DIR="$ROOT/services/agent_worker"
  venv "$AGENT_DIR/.venv" -e "$AGENT_DIR[dev]"
  mkdir -p "$DATA"
  wait_health terminal "http://127.0.0.1:3000/api/agent/health"  # opens the queue and creates its tables
  QUANTMERIDIAN_API_URL="${QUANTMERIDIAN_API_URL:-http://127.0.0.1:3000}" \
    start agent-worker - "$ROOT" "$AGENT_DIR/.venv/bin/python" -m agent_worker.worker
fi

say "Health"
wait_health ibal "http://127.0.0.1:8013/health" '"ready":true'
wait_health mmkt "http://127.0.0.1:8014/health" '"ready":true'
[ "$WITH_COLL" = 1 ] && wait_health coll "http://127.0.0.1:8017/health" '"ready":true'
[ "$WITH_AGENT" = 1 ] || wait_health terminal "http://127.0.0.1:3000/"

say "Up. Terminal: http://localhost:3000  (Ctrl-C stops everything)"
wait
