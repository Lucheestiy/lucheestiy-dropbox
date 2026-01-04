# Architecture Documentation - Droppr

This document describes the high-level architecture of the Droppr application using the C4 model concepts.

## 1. System Context

Droppr is a file-sharing and media-viewing layer built on top of FileBrowser. It provides a modern gallery interface, optimized video streaming, and administrative tools for managing shares and analytics.

- **Users**: Browse public galleries, download files, and upload via file requests.
- **Admins**: Create upload accounts, manage share expiration, and view analytics.
- **External Systems**:
  - **FileBrowser**: The source of truth for file storage, user management, and base sharing functionality.
  - **Cloudflare R2**: Used for offloading media cache (thumbnails, proxies).
  - **Sentry**: Error monitoring and reporting.

## 2. Container Diagram

The system consists of the following Docker containers:

1. **Nginx (Static & Proxy)**:
   - Serves the frontend TypeScript/React-like application.
   - Proxies API requests to either `media-server` or `app` (FileBrowser).
   - Handles SSL/TLS (often via Cloudflare Tunnel).
   - Serves static media cache directly for performance.

2. **App (FileBrowser)**:
   - Go-based backend for file management.
   - Provides the raw file API and initial share link generation.

3. **Media Server (Flask)**:
   - Python backend that implements the "Droppr" business logic.
   - Manages share aliases, file requests, and analytics.
   - Orchestrates video processing.

4. **Media Worker (Celery)**:
   - Background worker for long-running tasks:
     - Video transcoding (H.264, HLS).
     - Thumbnail generation.
     - R2 offloading.

5. **Redis**:
   - Message broker for Celery.
   - Result backend for Celery.
   - Fast cache for share metadata.

6. **Database (SQLite)**:
   - `analytics.db`: Stores download events and auth logs.
   - `video_meta.db`: Stores ffprobe results and processing status.
   - `refresh_tokens.db`: Stores JWT refresh token state.

## 3. Component Diagram (Media Server)

Inside the `media-server` container:

- **Routes**: Blueprint-based API endpoints (Auth, Analytics, Media, etc.).
- **Services**:
  - `FileBrowser Service`: Client for the internal FileBrowser API.
  - `Media Processing Service`: Wrapper around FFmpeg and Celery task enqueuing.
  - `Analytics Service`: Logic for recording and retrieving event data.
  - `Secret Service`: Handles loading secrets from environment or files.
- **Middleware**:
  - `Rate Limiter`: Protects endpoints from abuse.
  - `Request ID`: Injects unique IDs into logs and headers.

## 4. Data Flow: Video Streaming

1. User requests a video in Stream Gallery.
2. Frontend calls `/api/share/{hash}/video-sources/{path}`.
3. Media Server checks if an HLS or MP4 proxy already exists (Local or R2).
4. If not, it returns a 200 with "ready: false" and optionally starts a background task via `Media Worker`.
5. Frontend polls or waits, then redirects to the optimized source when ready.
6. Nginx serves the `.m3u8` or `.mp4` file directly from the persistent volume `./database/hls-cache` or `./database/proxy-cache`.
