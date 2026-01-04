#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Droppr Backup Verification Script
# - Checks the latest backup for integrity and completeness
# Usage: ./verify-backup.sh [backup_dir]
# ==============================================================================

BACKUP_ROOT="${DROPPR_BACKUP_DIR:-"$(pwd)/backups"}"
LATEST_BACKUP="${1:-$(ls -dt "$BACKUP_ROOT"/*/ | head -n1)}"

log() {
  printf "[VERIFY] %s\n" "$*"
}

if [[ ! -d "$LATEST_BACKUP" ]]; then
  log "Error: Backup directory not found: $LATEST_BACKUP"
  exit 1
fi

log "Verifying backup: $LATEST_BACKUP"

# 1. Check for databases
if [[ -d "$LATEST_BACKUP/databases" ]]; then
  for db in "$LATEST_BACKUP/databases"/*.sqlite3; do
    if [[ -f "$db" ]]; then
      log "Checking SQLite integrity: $(basename "$db")"
      if ! sqlite3 "$db" "PRAGMA integrity_check;" | grep -q "ok"; then
        log "FAILED: Integrity check failed for $db"
        exit 2
      fi
    fi
  done
  log "Database integrity OK."
else
  log "WARNING: No databases found in backup."
fi

# 2. Check for Redis dump
if [[ -f "$LATEST_BACKUP/redis/dump.rdb" ]]; then
  log "Redis dump found."
else
  log "WARNING: Redis dump missing."
fi

# 3. Check for data tarball
if [[ -f "$LATEST_BACKUP/data.tar.gz" ]]; then
  log "Verifying data tarball integrity..."
  if ! tar -tzf "$LATEST_BACKUP/data.tar.gz" >/dev/null; then
    log "FAILED: data.tar.gz is corrupted."
    exit 3
  fi
  log "Data tarball OK."
else
  log "WARNING: data.tar.gz missing."
fi

log "Verification SUCCESSFUL."
