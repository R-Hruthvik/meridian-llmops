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
    echo "  HOST             Backend host (default: 0.0.0.0)"
    echo "  VITE_PORT        Frontend dev port (default: 5173)"
    echo ""
}

# Bring up supporting Docker services (Qdrant, Neo4j, litellm, Langfuse) if Docker is available.
# `up -d` is idempotent: no-op if already running. Left running on exit (persistent data layer).
start_docker_stack() {
    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${YELLOW}Docker not found — skipping containers (in-memory fallback may be used).${NC}"
        return 0
    fi
    if ! docker compose ps >/dev/null 2>&1; then
        echo -e "${YELLOW}Docker daemon not running — skipping containers.${NC}"
        return 0
    fi
    echo -e "${BLUE}Starting Docker services (Qdrant, Neo4j, litellm, Langfuse)...${NC}"
    docker compose up -d || echo -e "${YELLOW}Some Docker services failed to start; continuing.${NC}"
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

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
VITE_PORT="${VITE_PORT:-5173}"
# Secrets: no shared test defaults. Production requires explicit secrets
# (app boot also fails closed via validate_production); local dev gets an
# ephemeral generated value per run unless already exported (dev-only).
if [ "${APP_ENV:-development}" = "production" ]; then
    if [ -z "${API_KEY_SECRET:-}" ] || [ -z "${LITELLM_MASTER_KEY:-}" ]; then
        echo -e "${RED}Error: API_KEY_SECRET and LITELLM_MASTER_KEY must be set in production.${NC}"
        exit 1
    fi
else
    export API_KEY_SECRET="${API_KEY_SECRET:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')}"
    export LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-sk-dev-$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')}"
fi
export VITE_MERIDIAN_API_KEY="${VITE_MERIDIAN_API_KEY:-$API_KEY_SECRET}"

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

print_banner

# Start the data-layer containers before launching the app services.
start_docker_stack

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
    GATEWAY_PORT="${PORT:-8001}"
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
