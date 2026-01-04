# Troubleshooting Guide - Dropbox Clone

This guide helps resolve common issues encountered during development and operation.

## 1. Backend Issues

### Container failing to start
- **Check logs**: `docker compose logs media-server`
- **Missing environment variables**: Ensure `.env` is correctly populated. See `.env.example`.
- **Database locks**: If you see `database is locked` (SQLite), it might be due to a long-running process. Check for zombie containers or hung migrations.

### API returns 502 Bad Gateway
- The `media-server` might be down. Check `docker compose ps`.
- Check Gunicorn logs for crashes.

### Video processing is slow or failing
- Check `media-worker` logs: `docker compose logs media-worker`.
- Ensure `ffmpeg` is installed in the container (it is by default in the Dockerfile).
- Check available disk space in `./database`.

## 2. Frontend Issues

### Changes not reflecting in the browser
- **Cache**: Clear browser cache or use Incognito mode.
- **Build**: Ensure you ran `npm run build` if you're not using the dev server.
- **Service Worker**: The service worker might be serving cached assets. Try `Shift + Refresh` or unregister the SW in DevTools.

### Layout is broken
- Check if `gallery.css` is correctly loaded.
- Ensure the Nginx container has the latest volume mounts.

## 3. Connectivity Issues

### Cannot connect to FileBrowser
- Ensure the `app` container is running.
- Check `DROPPR_FILEBROWSER_BASE_URL` in `.env`. It should be `http://app:80` inside the Docker network.

### Redis errors
- Ensure the `redis` container is running.
- Check `DROPPR_REDIS_URL`.

## 4. Administrative Access

### "Unauthorized" error
- Ensure you are logged into FileBrowser first.
- The media server exchanges your FileBrowser session for a custom JWT. If your FileBrowser session expires, you must log in again.

### 2FA (TOTP) failing
- Ensure your server time is synchronized (NTP).
- Double check `DROPPR_ADMIN_TOTP_SECRET`.

## 6. Common UI Error Codes

### 401 Unauthorized / 403 Forbidden
- **Cause**: Session expired or insufficient permissions.
- **Recovery**: Try clearing browser cookies for the domain and log in again. Ensure your account has the "Admin" flag if trying to access administrative features.

### 404 Not Found
- **Cause**: The share link or file has been deleted, or the URL is malformed.
- **Recovery**: Verify the share hash. If you are an admin, check if the share still exists in the FileBrowser UI.

### 410 Gone
- **Cause**: The share link has expired.
- **Recovery**: Ask the owner to create a new share link or extend the expiration date.

### Timeout / Network Error
- **Cause**: Unstable internet connection or server overload.
- **Recovery**: Refresh the page. If the issue persists, check the server status via `/health`.

### Video "Stuck" or "Stalled"
- **Cause**: Browser unable to buffer enough data or network interruption.
- **Recovery**: Click the "Reset Video" button (⟳) in the player controls or tap the video overlay to reload the stream. Shift+Click the refresh button for a "hard" reload.
