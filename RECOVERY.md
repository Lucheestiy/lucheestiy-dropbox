# Disaster Recovery Runbook (RECOVERY.md)

This document provides instructions for restoring the Dropbox Clone (Droppr) application from backups in case of data loss or system failure.

## 1. Prerequisites

- Access to the server with Docker and Docker Compose installed.
- Access to the backup storage (local `/backups` directory or remote storage via `rclone`).
- Basic knowledge of bash and Docker.

## 2. Recovery Procedures

### 2.1. Full System Restore

If the entire application data is lost but the code is intact:

1.  **Stop the application:**
    ```bash
    docker compose down
    ```

2.  **Locate the latest backup:**
    ```bash
    LATEST_BACKUP=$(ls -dt backups/*/ | head -n1)
    echo "Restoring from: $LATEST_BACKUP"
    ```

3.  **Restore Databases:**
    ```bash
    cp -f "$LATEST_BACKUP/databases/"*.sqlite3 database/
    ```

4.  **Restore User Data:**
    ```bash
    rm -rf data/*
    tar -xzf "$LATEST_BACKUP/data.tar.gz" -C .
    ```

5.  **Restore Redis Data:**
    ```bash
    mkdir -p database/redis
    cp -f "$LATEST_BACKUP/redis/dump.rdb" database/redis/
    ```

6.  **Restart the application:**
    ```bash
    ./safe_rebuild_droppr.sh
    ```

### 2.2. Partial Restore (Databases Only)

If only the analytics or metadata databases are corrupted:

1.  Stop the `media-server` and `media-worker`:
    ```bash
    docker compose stop media-server media-worker
    ```

2.  Restore the specific database file:
    ```bash
    cp backups/YYYYMMDD_HHMMSS/databases/analytics.sqlite3 database/
    ```

3.  Start the services:
    ```bash
    docker compose start media-server media-worker
    ```

## 3. Remote Restore (rclone)

If local backups are also lost, download from remote storage:

1.  List remote backups:
    ```bash
    rclone lsd remote:droppr-backups
    ```

2.  Download the desired backup:
    ```bash
    rclone copy remote:droppr-backups/YYYYMMDD_HHMMSS ./backups/YYYYMMDD_HHMMSS
    ```

3.  Follow the **Full System Restore** steps above.

## 4. Verification

After any restore operation, run the smoke tests to ensure the application is functional:

```bash
./scripts/smoke_media.sh
./scripts/smoke_gallery.sh
```

Also, check the health endpoint:
```bash
curl http://localhost:8099/health
```

## 5. Troubleshooting

- **Permissions Issues:** Ensure the `data` and `database` directories are owned by the user defined in `docker-compose.yml` (usually UID 1000).
  ```bash
  sudo chown -R 1000:1000 data database
  ```
- **Redis Sync:** If Redis fails to load the restored `dump.rdb`, check the logs:
  ```bash
  docker compose logs redis
  ```
