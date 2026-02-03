#!/usr/bin/env bash
# ==============================================================================
trap "" HUP  # Ignore hangup signal to survive SSH disconnect
# Safe Rebuild Dropbox (SRDROPBOX)
# - Stops the Dropbox stack, rebuilds images, and restarts the stack
# - Optionally starts the Cloudflare tunnel profile if requested (or if currently running)
#
# Usage: srdroppr [--clean] [--tunnel|--no-tunnel] [--dry-run] [-h|--help]
#   --clean     : Build with --no-cache
#   --tunnel    : Start with Cloudflare tunnel profile enabled
#   --no-tunnel : Start without tunnel profile (default unless auto-detected running)
#   --dry-run   : Print actions without executing them
# ==============================================================================
set -euo pipefail

INVOKED_CMD="$(basename "${0:-sedrppr}")"
DISPLAY_CMD="$INVOKED_CMD"
if [[ "$DISPLAY_CMD" == "safe_rebuild_droppr.sh" ]]; then
  DISPLAY_CMD="sedrppr"
fi

usage() {
  cat <<EOF
Safe Rebuild Dropbox (${DISPLAY_CMD})

Usage:
  ${DISPLAY_CMD} [--clean] [--tunnel|--no-tunnel] [--dry-run] [-h|--help]

Notes:
  - \`sedrppr\` and \`srdroppr\` are equivalent wrappers for this script.

Options:
  --clean       Build with --no-cache.
  --tunnel      Start with Cloudflare tunnel profile enabled.
  --no-tunnel   Start without tunnel profile (overrides auto-detect).
  --dry-run     Print actions without executing.
  -h, --help    Show this help and exit.
EOF
}

CLEAN=false
TUNNEL_MODE="auto" # auto|on|off
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN=true
      shift
      ;;
    --tunnel)
      TUNNEL_MODE="on"
      shift
      ;;
    --no-tunnel)
      TUNNEL_MODE="off"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[SRDROPBOX] Error: Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Resolve script directory (follow symlinks) so /usr/local/bin/srdroppr works.
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.yml"
NGINX_CONTAINER="dropbox"
TUNNEL_CONTAINER="cloudflared-dropbox"
BUILD_FLAGS=()

if $CLEAN; then
  echo "[SRDROPBOX] Clean mode enabled: Disabling build cache."
  BUILD_FLAGS+=(--no-cache)
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[SRDROPBOX] Error: $COMPOSE_FILE not found in $SCRIPT_DIR" >&2
  exit 1
fi

AUTO_TUNNEL_RUNNING=false
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$TUNNEL_CONTAINER"; then
  AUTO_TUNNEL_RUNNING=true
fi

USE_TUNNEL=false
case "$TUNNEL_MODE" in
  on) USE_TUNNEL=true ;;
  off) USE_TUNNEL=false ;;
  auto) USE_TUNNEL=$AUTO_TUNNEL_RUNNING ;;
  *) echo "[SRDROPBOX] Error: Internal invalid TUNNEL_MODE=$TUNNEL_MODE" >&2; exit 3 ;;
esac

PROFILE_ARGS=()
if $USE_TUNNEL; then
  PROFILE_ARGS+=(--profile tunnel)
fi

if $DRY_RUN; then
  echo "[SRDROPBOX] DRY RUN: Would run the following steps in $SCRIPT_DIR:"
  echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]:-(no profile)} config"
  echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]:-(no profile)} build ${BUILD_FLAGS[*]:-(no extra flags)}"
  echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]:-(no profile)} pull $NGINX_CONTAINER"
  if $USE_TUNNEL; then
    echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]} pull $TUNNEL_CONTAINER"
    echo "  - docker pull cloudflare/cloudflared:latest"
  fi
  echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]:-(no profile)} down --remove-orphans"
  echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]:-(no profile)} up -d"
  echo "  - wait for container: $NGINX_CONTAINER"
  echo "  - docker compose -f $COMPOSE_FILE ${PROFILE_ARGS[*]:-(no profile)} ps"
  exit 0
fi

echo "[SRDROPBOX] Validating compose file..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" config >/dev/null

if [[ ${#BUILD_FLAGS[@]} -gt 0 ]]; then
  echo "[SRDROPBOX] Building Dropbox images (Flags: ${BUILD_FLAGS[*]})..."
else
  echo "[SRDROPBOX] Building Dropbox images (Flags: None)..."
fi
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" build "${BUILD_FLAGS[@]}"

echo "[SRDROPBOX] Pulling upstream images (best-effort)..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" pull "$NGINX_CONTAINER" || true
if $USE_TUNNEL; then
  docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" pull "$TUNNEL_CONTAINER" || true
  docker pull cloudflare/cloudflared:latest >/dev/null 2>&1 || true
fi

echo "[SRDROPBOX] Bringing down Dropbox stack (remove orphans)..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" down --remove-orphans || true

if $USE_TUNNEL; then
  echo "[SRDROPBOX] Starting Dropbox stack (tunnel profile enabled)..."
else
  echo "[SRDROPBOX] Starting Dropbox stack..."
fi
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d

echo "[SRDROPBOX] Waiting for Nginx container ($NGINX_CONTAINER) to be Up..."
for i in {1..60}; do
  if docker ps --format '{{.Names}} {{.Status}}' | grep -q "^$NGINX_CONTAINER .*Up"; then
    echo "[SRDROPBOX] Nginx container is Up."
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "[SRDROPBOX] Warning: Nginx container did not report Up within 60s" >&2
  fi
done

if command -v curl >/dev/null 2>&1; then
  HOST_PORT="$(docker port "$NGINX_CONTAINER" 80/tcp 2>/dev/null | awk -F: 'NR==1{print $NF}' | tr -d '\r' || true)"
  HOST_PORT="${HOST_PORT:-8098}"
  echo "[SRDROPBOX] Checking HTTP (http://localhost:${HOST_PORT}/)..."
  for i in {1..30}; do
    if curl -fsS "http://localhost:${HOST_PORT}/" >/dev/null; then
      echo "[SRDROPBOX] HTTP check OK."
      break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
      echo "[SRDROPBOX] Warning: HTTP check failed at http://localhost:${HOST_PORT}/" >&2
    fi
  done
fi

echo "[SRDROPBOX] Current Dropbox containers:"
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" ps

echo "[SRDROPBOX] Safe rebuild (dropbox) completed."
