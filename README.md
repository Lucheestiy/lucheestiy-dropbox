# Dropbox (Share Links + File Requests)

Dropbox is a lightweight, Dropbox-style file sharing UI for videos/pictures using File Browser. You log in to upload/manage files, create share links, and generate file-request links for uploads.

## Sharing folders (avoid ZIP downloads)

File Browser’s “download” endpoint (`/api/public/dl/<hash>`) downloads folders as a `.zip`. This stack redirects **bare** folder-share links to the media gallery (`/gallery/<hash>`) so recipients see pictures/videos in the browser.

To download everything as a `.zip`, use the gallery’s **Download All** button (calls `/api/share/<hash>/download`).

Note: the gallery caches a share for performance. If you add new files after creating a share, reload the gallery and click **Refresh** to pull the latest folder contents.

## File Requests (upload-only links)

Admins can create file-request links directly from the Files page:

1. Go to `/files` and click **Request**.
2. Choose the target folder, expiration (0 = never), and optional password.
3. Copy the generated link (`/request/<hash>`).

Recipients can upload into that folder without seeing any existing files.

## Share Controls (password + expiration)

- Create a share with optional **Password** and **Expiration** in the share dialog.
- Admins can adjust an existing share’s expiration time from **Settings → Shares** using the “Change expiration” control.

## Analytics (downloads + IPs)

- Admin-only page: `/analytics` (requires File Browser login; uses your JWT token).
- Tracks gallery views + downloads (ZIP downloads + explicit file downloads) with timestamps and IPs.
- Stored in SQLite at `./database/droppr-analytics.sqlite3` (default retention: 180 days).
- Config via env vars on the `media-server` container:
  - `DROPPR_ANALYTICS_ENABLED=true|false`
  - `DROPPR_ANALYTICS_RETENTION_DAYS=180` (set `0` to disable retention cleanup)
  - `DROPPR_ANALYTICS_IP_MODE=full|anonymized|off`

## Video Quality (Fast + HD)

The public gallery opens videos in `/player` and can use cached proxy MP4s (served from `/api/proxy-cache/...`) for faster reloads and seeking:

- `Auto`: on desktop, switches to `Fast` while scrolling/seeking, then upgrades to `HD` once settled; on iOS, `Auto` starts in `HD` and avoids automatic source switching.
- `Fast`: prefers the low-res proxy for quick scrubbing.
- `HD`: prefers the HD proxy (falls back while it prepares).

Proxy files are generated on-demand by `media-server` and persisted under `./database/proxy-cache/`.

## Upload Conflicts (HTTP 409)

File Browser returns HTTP `409` when uploading a file that already exists (common when a phone retries the same upload). This stack proxies uploads with `override=true` so retrying the same filename overwrites the existing file instead of failing.

## Auto Share Link (Single File Upload)

When you upload **exactly one file**, the UI automatically creates a share for that file and shows the public share link immediately (it also attempts to copy it to your clipboard). Uploading multiple files keeps the normal behavior (no auto-share).

## Accounts (Independent Uploads)

- Admins can create upload-only accounts from the UI (`Accounts` button on `/files`).
- Each account is scoped to its own folder (default: `./data/users/<username>`), with no visibility into other uploads.
- Remove users via **Settings → Users** (admin only).
- To change the base folder, set `DROPPR_USER_ROOT` (scope inside File Browser, default `/users`) and `DROPPR_USER_DATA_DIR` (filesystem path, default `/srv`) on the `media-server` container. Password length can be adjusted with `DROPPR_USER_PASSWORD_MIN_LEN` (default `8`).
- If a user was created via File Browser's Settings → Users, their scope defaults to `/`. Use the Accounts button instead, or run `./scripts/fix-user-scope.sh <username>` to rescope and move `./data/<username>` into `./data/users/<username>`.

## Start

```bash
cd /home/mlweb/dropbox.lucheestiy.com
docker compose up -d
```

Host port is configured via `DROPBOX_HOST_PORT` in `.env` (default: `8100`).

Local check:

```bash
curl -sS http://localhost:8100/ >/dev/null || true
docker logs dropbox --tail 50
```

On first run, File Browser will print a randomly generated admin password in the logs.

## Media smoke test (previews + replay)

Some clients rely on `HEAD` and conditional GETs for media endpoints like `/api/public/dl/...`. Nginx normalizes these so previews and replays work reliably.

```bash
./scripts/smoke_media.sh 'https://dropbox.lucheestiy.com/api/public/dl/<share>/<file>?inline=true'
```

## Files Location

- Upload/manage files in `./data/` (host path: `/home/mlweb/dropbox.lucheestiy.com/data`).
- Persistent state is stored in `./database/` and `./config/`.

## Public URL (Proxy Droplet)

Production access is handled by the proxy droplet (nginx) that forwards
`dropbox.lucheestiy.com` to the local Dropbox container.

Example (on the droplet):

```nginx
server {
    server_name dropbox.lucheestiy.com;
    location / {
        proxy_pass http://100.93.127.52:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
