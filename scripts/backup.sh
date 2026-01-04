#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${DROPPR_BACKUP_DIR:-"$ROOT_DIR/backups"}"
REMOTE_TARGET="${DROPPR_BACKUP_REMOTE:-}""
RETENTION_DAYS="${DROPPR_BACKUP_RETENTION_DAYS:-30}"
DATE_TAG="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$DATE_TAG"

mkdir -p "$BACKUP_DIR"

log() {
  printf '%s\n' "$*"
}

if command -v sqlite3 >/dev/null; then
  for db in "$ROOT_DIR"/database/*.sqlite3; do
    [ -f "$db" ] || continue
    sqlite3 "$db" "PRAGMA wal_checkpoint(TRUNCATE);" || true
  done
else
  log "sqlite3 not found; skipping WAL checkpoint"
fi

if command -v docker >/dev/null; then
  if docker ps --format '{{.Names}}' | grep -q '^dropbox-redis$'; then
    docker exec dropbox-redis redis-cli BGSAVE >/dev/null 2>&1 || true
  fi
fi

mkdir -p "$BACKUP_DIR/databases"
if compgen -G "$ROOT_DIR/database/*.sqlite3" > /dev/null; then
  cp -f "$ROOT_DIR"/database/*.sqlite3 "$BACKUP_DIR/databases/"
  
  if command -v sqlite3 >/dev/null; then
    log "Verifying database integrity..."
    for bdb in "$BACKUP_DIR/databases"/*.sqlite3; do
      [ -f "$bdb" ] || continue
      if ! sqlite3 "$bdb" "PRAGMA integrity_check;" | grep -q "ok"; then
        log "WARNING: Integrity check failed for $bdb"
      else
        log "Integrity check passed for $(basename "$bdb")"
      fi
    done
  fi
fi

if [ -f "$ROOT_DIR/database/redis/dump.rdb" ]; then
  mkdir -p "$BACKUP_DIR/redis"
  cp -f "$ROOT_DIR/database/redis/dump.rdb" "$BACKUP_DIR/redis/"
fi

if [ -d "$ROOT_DIR/data" ]; then
  tar -czf "$BACKUP_DIR/data.tar.gz" -C "$ROOT_DIR" data
fi

if [ -n "$REMOTE_TARGET" ]; then
  if command -v rclone >/dev/null; then
    rclone sync "$BACKUP_DIR" "$REMOTE_TARGET/$DATE_TAG"
  else
    log "rclone not found; skipping remote sync"
  fi
fi

if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -print0 | xargs -0 rm -rf
fi

log "Backup complete: $BACKUP_DIR"
