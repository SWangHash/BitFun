#!/usr/bin/env bash
# BitFun Relay Server — one-click deploy script.
# Usage:  bash deploy.sh [--skip-build] [--skip-health-check]
#
# Prerequisites: Docker, Docker Compose

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKIP_BUILD=false
SKIP_HEALTH_CHECK=false

usage() {
  cat <<'EOF'
BitFun Relay Server deploy script

Usage:
  bash deploy.sh [options]

Options:
  --skip-build         Skip docker compose build, only restart services
  --skip-health-check  Skip post-deploy health check
  -h, --help           Show this help message
EOF
}

check_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not installed."
    exit 1
  fi
}

check_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    return 0
  fi
  echo "Error: Docker Compose (docker compose) is required."
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --skip-health-check) SKIP_HEALTH_CHECK=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      usage
      exit 1
      ;;
  esac
done

echo "=== BitFun Relay Server Deploy ==="
check_command docker
check_docker_compose

# Build and start containers
cd "$SCRIPT_DIR"
if [ "$SKIP_BUILD" = true ]; then
  echo "[1/2] Skipping Docker build (--skip-build)"
else
  echo "[1/2] Building Docker images..."
  docker compose build
fi

echo "[2/2] Starting services..."
docker compose up -d

if [ "$SKIP_HEALTH_CHECK" = false ]; then
  echo "Waiting for services to start..."
  sleep 5
  echo "Checking relay health endpoint..."
  if command -v curl >/dev/null 2>&1; then
    MAX_RETRIES=6
    RETRY=0
    while [ $RETRY -lt $MAX_RETRIES ]; do
      if curl -fsS --max-time 5 "http://127.0.0.1:9700/health" >/dev/null 2>&1; then
        echo "Health check passed: http://127.0.0.1:9700/health"
        break
      fi
      RETRY=$((RETRY + 1))
      if [ $RETRY -lt $MAX_RETRIES ]; then
        echo "  Retry $RETRY/$MAX_RETRIES in 3s..."
        sleep 3
      else
        echo "Warning: health check failed after $MAX_RETRIES attempts. Check logs:"
        docker compose logs --tail=30 relay-server
      fi
    done
  else
    echo "Warning: 'curl' not found, skipped health check."
  fi
fi

echo ""
echo "=== Deploy complete ==="
echo "Relay server running on port 9700"
echo "Caddy proxy on ports 80/443"
echo ""
echo "Custom Server URL examples for BitFun Desktop:"
echo "  - Direct relay:        http://<YOUR_SERVER_IP>:9700"
echo "  - Reverse proxy root:  https://<YOUR_DOMAIN>"
echo "  - Reverse proxy /relay:https://<YOUR_DOMAIN>/relay  (if you configured path prefix)"
echo ""
echo "Check status:  docker compose ps"
echo "View logs:     docker compose logs -f relay-server"
echo "Stop:          docker compose down"
