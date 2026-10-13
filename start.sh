#!/usr/bin/env bash
set -e

# Meridian LLMOps - Unified Startup Script

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "============================================================"
    echo "         🚀 Meridian LLMOps Platform Launcher              "
    echo "============================================================"
    echo -e "${NC}"
}

print_help() {
    echo "Usage: ./start.sh [OPTION]"
    echo ""
    echo "Options:"
    echo "  --dev, -d        Start both backend (FastAPI :8000) and frontend (Vite :5173) in dev mode with hot reload (default)"
    echo "  --prod, -p       Build frontend (web/dist) and serve unified from FastAPI (:8000)"
    echo "  --build, -b      Build frontend and start server in production mode"
    echo "  --backend-only   Start only the FastAPI RAG engine backend (:8000)"
    echo "  --gateway-only   Start only the AI Gateway proxy (:8001)"
    echo "  --help, -h       Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  PORT             Backend port (default: 8000)"
    echo "  GATEWAY_PORT     Gateway port (default: 8001; PORT is used when explicitly set)"
    echo "  HOST             Backend host (default: 0.0.0.0)"
    echo "  VITE_PORT        Frontend dev port (default: 5173)"
    echo ""
}

# Bring up Qdrant if Docker is available.
# `up -d` is idempotent: no-op if already running. Left running on exit (persistent data layer).
start_docker_stack() {
    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${YELLOW}Docker not found — skipping Qdrant startup; the app preflight requires a reachable Qdrant instance.${NC}"
        return 0
    fi
    if ! docker compose ps >/dev/null 2>&1; then
        echo -e "${YELLOW}Docker daemon not running — skipping containers.${NC}"
        return 0
    fi
    echo -e "${BLUE}Starting Qdrant...${NC}"
    docker compose up -d qdrant || echo -e "${YELLOW}Qdrant could not be started; startup preflight will report how to fix it.${NC}"
}

preflight_app_dependencies() {
    echo -e "${BLUE}Checking Qdrant and embedding model availability...${NC}"
    $PYTHON_CMD - <<'PY'
import sys
import time
import urllib.error
import urllib.request

from packages.core.settings import get_settings

settings = get_settings()
url = f"http://{settings.qdrant_host}:{settings.qdrant_port}/healthz"
last_error = None
for attempt in range(15):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            if response.status == 200:
                break
    except (OSError, urllib.error.URLError) as error:
        last_error = error
    if attempt < 14:
        time.sleep(2)
else:
    print(
        f"Qdrant is not reachable at {url} ({last_error}). Start it with `docker compose up -d qdrant`, "
        "or set QDRANT_HOST/QDRANT_PORT to a reachable instance.",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from services.ingestion.embedder import FastEmbedEmbedder

    FastEmbedEmbedder(
        settings.embedding_model,
        cache_path=settings.fastembed_cache_path,
        expected_dim=settings.qdrant_vector_dim,
    )
except Exception as error:
    print(
        f"Embedding model {settings.embedding_model!r} is unavailable or invalid in "
        f"{settings.fastembed_cache_path!r}: {error}. Check network access and model/cache settings, "
        "then rerun `./start.sh`.",
        file=sys.stderr,
    )
    sys.exit(1)
PY
}

# Parse Python executable
if [ -f "$ROOT_DIR/.venv/bin/python" ]; then
    PYTHON_CMD="$ROOT_DIR/.venv/bin/python"
elif command -v uv >/dev/null 2>&1; then
    PYTHON_CMD="uv run python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
else
    echo -e "${RED}Error: Python 3 not found.${NC}"
    exit 1
fi

HOST="${HOST:-0.0.0.0}"
VITE_PORT="${VITE_PORT:-5173}"
MODE="dev"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev|-d)
            MODE="dev"
            shift
            ;;
        --prod|-p|--build|-b)
            MODE="prod"
            shift
            ;;
        --backend-only)
            MODE="backend"
            shift
            ;;
        --gateway-only)
            MODE="gateway"
            shift
            ;;
        --help|-h)
            print_banner
            print_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_help
            exit 1
            ;;
    esac
done

if [ "$MODE" = "gateway" ]; then
    GATEWAY_PORT="${GATEWAY_PORT:-${PORT:-8001}}"
fi
PORT="${PORT:-8000}"

# Production is explicit and must never fall back to generated local keys.
if [ "$MODE" = "prod" ] || [ "${APP_ENV:-development}" = "production" ]; then
    if [ "$MODE" = "dev" ] && [ "${APP_ENV:-}" = "production" ]; then
        echo -e "${RED}Error: APP_ENV=production cannot be used with --dev.${NC}"
        exit 1
    fi
    export APP_ENV=production
    if [ -z "${API_KEYS:-}" ] || [ -z "${LITELLM_MASTER_KEY:-}" ]; then
        echo -e "${RED}Error: API_KEYS and LITELLM_MASTER_KEY must be set for --prod.${NC}"
        exit 1
    fi
    if ! $PYTHON_CMD -c 'import json,os,sys; entries=json.loads(os.environ["API_KEYS"]); sys.exit(not (isinstance(entries,dict) and any(isinstance(item,dict) and item.get("role")=="admin" and isinstance(item.get("tenant"),str) and item["tenant"] for item in entries.values())))'; then
        echo -e "${RED}Error: API_KEYS must include an admin key with a tenant.${NC}"
        exit 1
    fi
else
    export APP_ENV="${APP_ENV:-development}"

    # Reuse the generated local key if one was saved by an earlier start.
    if [ -z "${API_KEYS:-}" ] && [ -f "$ROOT_DIR/.env.local" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            case "$line" in
                API_KEYS=*)
                    API_KEYS="${line#API_KEYS=}"
                    API_KEYS="${API_KEYS#\'}"
                    API_KEYS="${API_KEYS%\'}"
                    break
                    ;;
            esac
        done < "$ROOT_DIR/.env.local"
    fi

    if [ -z "${API_KEYS:-}" ]; then
        DEV_API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
        API_KEYS="$(python3 -c 'import json,sys; print(json.dumps({sys.argv[1]: {"tenant":"default","role":"admin"}}, separators=(",",":")))' "$DEV_API_KEY")"
        umask 077
        local_env_tmp="$(mktemp "$ROOT_DIR/.env.local.XXXXXX")"
        if [ -f "$ROOT_DIR/.env.local" ]; then
            awk '!/^API_KEYS=/' "$ROOT_DIR/.env.local" > "$local_env_tmp"
        fi
        printf 'API_KEYS=%s\n' "$API_KEYS" >> "$local_env_tmp"
        chmod 600 "$local_env_tmp"
        mv "$local_env_tmp" "$ROOT_DIR/.env.local"
        printf 'Generated local API key: %s\n' "$DEV_API_KEY"
        unset DEV_API_KEY
    fi
    export API_KEYS
    export LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-sk-dev-$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')}"
fi

print_banner

# Start the data-layer containers before launching the app services.
start_docker_stack

if [ "$MODE" != "gateway" ]; then
    preflight_app_dependencies
fi

# Trap function to clean up background processes on Ctrl+C / kill
cleanup() {
    echo -e "\n${YELLOW}Shutting down Meridian services...${NC}"
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    echo -e "${GREEN}All services stopped cleanly.${NC}"
}
trap cleanup EXIT INT TERM

if [ "$MODE" = "prod" ]; then
    echo -e "${YELLOW}Building web frontend into web/dist...${NC}"
    npm --prefix web run build

    echo -e "${GREEN}Frontend built successfully.${NC}"
    echo -e "${BLUE}Starting unified FastAPI server at http://${HOST}:${PORT}${NC}"
    echo -e "${BLUE}API Documentation: http://localhost:${PORT}/docs${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop the server.${NC}\n"

    $PYTHON_CMD -m uvicorn services.rag_engine.app:app --host "$HOST" --port "$PORT"

elif [ "$MODE" = "backend" ]; then
    echo -e "${BLUE}Starting RAG Engine Backend at http://${HOST}:${PORT}${NC}"
    echo -e "${BLUE}API Documentation: http://localhost:${PORT}/docs${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop.${NC}\n"

    $PYTHON_CMD -m uvicorn services.rag_engine.app:app --host "$HOST" --port "$PORT" --reload

elif [ "$MODE" = "gateway" ]; then
    echo -e "${BLUE}Starting AI Gateway at http://${HOST}:${GATEWAY_PORT}${NC}"
    echo -e "${BLUE}API Documentation: http://localhost:${GATEWAY_PORT}/docs${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop.${NC}\n"

    $PYTHON_CMD -m uvicorn services.gateway.app:app --host "$HOST" --port "$GATEWAY_PORT" --reload

elif [ "$MODE" = "dev" ]; then
    echo -e "${BLUE}Starting in Development Mode (Hot-Reload Enabled)${NC}\n"

    # Start backend
    echo -e "${GREEN}1. Launching FastAPI Backend on http://${HOST}:${PORT}...${NC}"
    $PYTHON_CMD -m uvicorn services.rag_engine.app:app --host "$HOST" --port "$PORT" --reload &
    BACKEND_PID=$!

    # Start frontend
    echo -e "${GREEN}2. Launching Vite Frontend on http://localhost:${VITE_PORT}...${NC}"
    npm --prefix web run dev -- --port "$VITE_PORT" --host &
    FRONTEND_PID=$!

    sleep 1
    echo -e "\n${GREEN}============================================================${NC}"
    echo -e "${GREEN}  ✓ Web Studio UI:  ${NC}http://localhost:${VITE_PORT}"
    echo -e "${GREEN}  ✓ FastAPI Backend:${NC}http://localhost:${PORT}"
    echo -e "${GREEN}  ✓ Swagger API Docs:${NC}http://localhost:${PORT}/docs"
    echo -e "${GREEN}============================================================${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop both services.${NC}\n"

    # Wait for either process to exit
    wait -n $BACKEND_PID $FRONTEND_PID 2>/dev/null || wait
fi
