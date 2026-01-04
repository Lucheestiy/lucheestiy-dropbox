# Dropbox Clone Improvement Plan (dropbox.lucheestiy.com)

**Last Updated:** 2026-01-03
**Codebase Version:** 51+ commits

## Status Legend
- [ ] Pending
- [~] In Progress
- [x] Done

---

## Executive Summary

This is a mature, production-ready file-sharing application with:
- **~25K lines of code** (Python + JavaScript)
- **24 API endpoints** across 5 Docker containers
- **Strong security foundations** (rate limiting, CSP, 2FA, JWT)
- **Key gaps:** Testing (0% coverage), code modularity, observability

### Priority Matrix

| Priority | Category | Impact | Effort | Status |
|----------|----------|--------|--------|--------|
| P0 | Critical Testing | High | Medium | Pending |
| P1 | Code Modularity | High | High | Pending |
| P1 | Observability | High | Medium | Pending |
| P2 | Video Processing | Medium | High | Partial |
| P2 | Mobile/A11y | Medium | Medium | Pending |
| P3 | New Features | Low | High | Pending |

---

## 1. Security Enhancements

### 1.1 Rate Limiting and DoS Protection [x]
**Status:** Complete
**Files:** `media-server/app/legacy.py:650-900`

Implemented:
- Flask-Limiter middleware with per-IP limits
- File uploads: 50 requests/hour
- Download requests: 1000 requests/hour
- Share creation: 20 requests/hour
- Authentication attempts: 5 failed/15 minutes
- CAPTCHA (Cloudflare Turnstile) after 3 failed password attempts

### 1.2 Content Security Policy [x]
**Status:** Complete
**Files:** `nginx/nginx.conf`

Implemented:
- CSP headers with strict directives
- Script-src, style-src, font-src, img-src, media-src, connect-src policies
- External JS files (moved from inline scripts)

### 1.3 Input Validation and Sanitization [x]
**Status:** Complete
**Files:** `media-server/app/legacy.py:196-450`

Implemented:
- File type whitelist validation via `DROPPR_UPLOAD_ALLOWED_EXTENSIONS`
- MIME type sniffing and validation server-side
- Path sanitization and directory traversal prevention
- `UploadValidationError` custom exception class
- Client-side file size pre-check

### 1.4 Authentication Improvements [x]
**Status:** Complete
**Files:** `media-server/app/legacy.py:450-650`

Implemented:
- JWT token refresh mechanism with configurable TTL
- Proper logout endpoint with token revocation
- TOTP 2FA for admin accounts (`DROPPR_ADMIN_TOTP_*` config)
- Authentication attempt logging to analytics DB
- Session timeout handling

### 1.5 Password Security [x]
**Status:** Complete
**Files:** `media-server/app/legacy.py`

Implemented:
- Werkzeug password hashing (bcrypt-based)
- Password complexity requirements (configurable)
- Password breach checking via HaveIBeenPwned API
- Password strength validation

### 1.6 Additional Security Hardening [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] Secrets management via AWS Secrets Manager / Vault / file-backed JSON loader
- [x] Vulnerability scanning in CI/CD (Trivy filesystem + image scans)
- [x] Network policy overlay (`docker-compose.security.yml` with internal/private networks)
- [x] Content-Type-Options `nosniff` header enforced in nginx
- [x] Internal request signing for FileBrowser API calls (HMAC headers)
- [x] Admin IP allowlisting support (CIDR-aware)

---

## 2. Code Quality and Architecture

### 2.1 Backend Modularization [x]
**Priority:** P1 (Critical)
**Current State:** Monolithic 4,707-line `media-server/app/legacy.py`

Planned structure:
```
media-server/
├── app/
│   ├── __init__.py              # Flask app factory
│   ├── config.py                # Configuration management
│   ├── models/
│   │   ├── __init__.py
│   │   ├── analytics.py         # Analytics DB models
│   │   └── video_meta.py        # Video metadata models
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── share.py             # /api/share/* endpoints
│   │   ├── droppr.py            # /api/droppr/* endpoints
│   │   ├── analytics.py         # /api/analytics/* endpoints
│   │   └── health.py            # /health endpoint
│   ├── services/
│   │   ├── __init__.py
│   │   ├── filebrowser.py       # FileBrowser API client
│   │   ├── video_processor.py   # FFmpeg operations
│   │   ├── cache.py             # Redis/memory cache
│   │   └── auth.py              # JWT/TOTP authentication
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── validation.py        # Input validation
│   │   ├── security.py          # Security utilities
│   │   └── decorators.py        # Custom decorators
│   └── middleware/
│       ├── __init__.py
│       ├── rate_limit.py        # Rate limiting
│       └── error_handler.py     # Global error handling
├── tests/                       # Test suite
├── requirements.txt
├── requirements-dev.txt
└── Dockerfile
```

Tasks:
- [x] Create Flask app factory pattern (app package with `create_app()`)
- [x] Extract routes into blueprints (share, droppr, analytics, health)
- [x] Create service layer for business logic
- [x] Separate utility functions into modules
- [x] Add proper dependency injection
- [x] Implement database models with proper ORM (SQLAlchemy)

Progress:
- [x] Created `media-server/app/` package with `__init__.py`, `config.py`, and `logging_config.py`
- [x] Moved monolith to `media-server/app/legacy.py` and updated Dockerfile copy step
- [x] Extracted upload/path validation utilities into `media-server/app/utils/validation.py`
- [x] Extracted internal signing + FileBrowser client into `media-server/app/utils/security.py` and `media-server/app/services/filebrowser.py`
- [x] Extracted Redis share cache helpers into `media-server/app/services/cache.py`
- [x] Extracted share file list builders into `media-server/app/services/share.py`
- [x] Extracted filesystem helpers into `media-server/app/utils/filesystem.py`
- [x] Extracted JWT helpers into `media-server/app/utils/jwt.py`
- [x] Moved `/health` route into `media-server/app/routes/health.py` blueprint
- [x] Extracted request IP helpers + limiter bootstrap into `media-server/app/utils/request.py` and `media-server/app/middleware/rate_limit.py`
- [x] Extracted metrics config into `media-server/app/services/metrics.py` and moved `/metrics` into `media-server/app/routes/metrics.py`
- [x] Extracted TOTP helpers into `media-server/app/utils/totp.py`
- [x] Extracted share alias storage into `media-server/app/services/aliases.py` and share hash validation into `media-server/app/utils/validation.py`
- [x] Extracted analytics storage, caching, and helpers into `media-server/app/services/analytics.py`
- [x] Moved analytics routes into `media-server/app/routes/analytics.py` blueprint
- [x] Moved droppr share alias route into `media-server/app/routes/droppr_aliases.py` blueprint
- [x] Moved droppr share expiration route into `media-server/app/routes/droppr_shares.py` blueprint
- [x] Moved droppr media routes into `media-server/app/routes/droppr_media.py` blueprint
- [x] Extracted share cache invalidation into `media-server/app/services/share_cache.py`
- [x] Extracted user account rules into `media-server/app/services/users.py`
- [x] Moved droppr auth + user routes into `media-server/app/routes/droppr_auth.py` and `media-server/app/routes/droppr_users.py`
- [x] Moved share list/file/download routes into `media-server/app/routes/share.py`
- [x] Moved droppr request routes into `media-server/app/routes/droppr_requests.py`
- [x] Extracted request storage + CAPTCHA logic into `media-server/app/services/file_requests.py`
- [x] Extracted video metadata + ffprobe helpers into `media-server/app/services/video_meta.py`
- [x] Moved share media routes (preview/proxy/HLS/video meta) into `media-server/app/routes/share_media.py`
- [x] Extracted preview/proxy/HLS/R2 helpers into `media-server/app/services/media_processing.py`
- [x] Extracted secrets loading into `media-server/app/services/secrets.py`

### 2.2 Frontend Modularization [~]
**Priority:** P1 (Critical)
**Current State:** Monolithic 4,944-line `droppr-panel.js`

Planned structure:
```
nginx/
├── src/
│   ├── components/
│   │   ├── Gallery/
│   │   │   ├── GalleryGrid.ts
│   │   │   ├── MediaViewer.ts
│   │   │   └── Thumbnail.ts
│   │   ├── VideoPlayer/
│   │   │   ├── Player.ts
│   │   │   ├── Controls.ts
│   │   │   └── BufferBar.ts
│   │   ├── Upload/
│   │   │   ├── Dropzone.ts
│   │   │   ├── ProgressBar.ts
│   │   │   └── FileList.ts
│   │   └── Common/
│   │       ├── Modal.ts
│   │       ├── Toast.ts
│   │       └── Loading.ts
│   ├── services/
│   │   ├── api.ts               # API client
│   │   ├── auth.ts              # Authentication
│   │   └── cache.ts             # Local storage cache
│   ├── utils/
│   │   ├── dom.ts               # DOM utilities
│   │   ├── format.ts            # Formatting helpers
│   │   └── validation.ts        # Client-side validation
│   ├── styles/
│   │   ├── components/          # Component-specific CSS
│   │   ├── base.css             # Base styles
│   │   └── theme.css            # Theme variables
│   └── index.ts                 # Entry point
├── vite.config.ts               # Build configuration
└── tsconfig.json                # TypeScript config
```

Tasks:
- [x] Set up Vite build system
- [ ] Convert JavaScript to TypeScript
- [ ] Create component architecture
- [ ] Implement CSS modules or styled-components
- [ ] Add tree-shaking and code splitting
- [x] Generate source maps for debugging

### 2.3 Testing Suite [ ]
**Priority:** P0 (Critical - Currently 0% Coverage)

Backend testing (`media-server/tests/`):
```
tests/
├── conftest.py                  # Pytest fixtures
├── unit/
│   ├── test_validation.py       # Input validation tests
│   ├── test_auth.py             # Authentication tests
│   ├── test_cache.py            # Cache logic tests
│   └── test_video.py            # Video processing tests
├── integration/
│   ├── test_share_api.py        # Share API endpoints
│   ├── test_droppr_api.py       # Droppr API endpoints
│   ├── test_analytics_api.py    # Analytics endpoints
│   └── test_filebrowser.py      # FileBrowser integration
└── fixtures/
    ├── sample_video.mp4
    ├── sample_image.jpg
    └── test_db.sqlite3
```

Frontend testing:
```
tests/
├── unit/
│   ├── components/              # Component unit tests
│   └── utils/                   # Utility function tests
├── integration/
│   └── api.test.ts              # API client tests
└── e2e/
    ├── gallery.spec.ts          # Gallery E2E tests
    ├── upload.spec.ts           # Upload flow tests
    └── video-player.spec.ts     # Video player tests
```

Tasks:
- [ ] Set up pytest with pytest-cov for Python
- [ ] Set up Vitest for TypeScript frontend
- [ ] Set up Playwright for E2E testing
- [ ] Create test fixtures and factories
- [ ] Add GitHub Actions workflow for CI testing
- [ ] Target: 80% code coverage for backend, 70% for frontend
- [ ] Add visual regression tests (Percy or Chromatic)

### 2.4 Code Standards and Linting [ ]
**Priority:** P1

Python:
- [ ] Add `pyproject.toml` with Black, Ruff (replaces flake8/isort)
- [ ] Add mypy for type checking
- [ ] Configure pre-commit hooks

JavaScript/TypeScript:
- [ ] Add ESLint with TypeScript rules
- [ ] Add Prettier for formatting
- [ ] Configure Husky for pre-commit

Tasks:
- [ ] Create `.pre-commit-config.yaml`
- [ ] Add `make lint`, `make format`, `make typecheck` commands
- [ ] Add automated code review (CodeClimate or SonarQube)
- [ ] Create `CONTRIBUTING.md` with style guidelines

### 2.5 Documentation [ ]
**Priority:** P2

Tasks:
- [ ] Add OpenAPI/Swagger documentation for all 24 API endpoints
- [ ] Create architecture diagrams (C4 model or similar)
- [ ] Add inline JSDoc/docstrings for public functions
- [ ] Create developer setup guide (DEVELOPMENT.md)
- [ ] Document all environment variables in `.env.example`
- [ ] Add troubleshooting guide
- [ ] Create API changelog

---

## 3. Performance Optimizations

### 3.1 Frontend Performance [x]
**Status:** Complete

Implemented:
- Code splitting (separate CSS/JS files)
- Minified assets (`gallery.min.js`, `gallery.min.css`)
- Service worker for offline caching (`sw.js`)
- HTTP caching headers for immutable assets
- Gzip compression in nginx

### 3.2 Database Optimization [x]
**Status:** Complete

Implemented:
- Indexes on `share_hash`, `timestamp`, `event_type`
- Connection pooling via context managers (`_analytics_conn()`)
- Query caching for analytics
- 180-day data archival policy

### 3.3 Caching Strategy [x]
**Status:** Complete

Implemented:
- Redis distributed caching (Redis 7)
- In-memory cache with configurable TTL (`DROPPR_SHARE_CACHE_TTL_SECONDS`)
- Cache warming for popular shares
- HTTP caching headers (ETag, Cache-Control)
- Lua-based Redis caching scripts

### 3.4 Video Processing Improvements [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] HEVC to H.264 transcoding for browser compatibility
- [x] Video metadata extraction (duration, dimensions)
- [x] Thumbnail generation and caching (single + multi-timestamp)
- [x] Proxy video generation with quality selection (Fast/HD/Auto)
- [x] Adaptive HLS streaming with multi-rendition outputs (360p/720p/1080p)
- [x] Background queue for transcoding (Celery + Redis)
- [x] Progressive upload for large files (chunked uploads)
- [x] Buffer progress indicator in video player
- [x] Web-optimized presets via env (CRF/preset/bitrate controls)

### 3.5 Asset Delivery and CDN [x]
**Priority:** P3
**Status:** Complete

Completed:
- [x] Cloudflare R2 integration for cached assets (thumbs/proxy/HLS) with optional redirects
- [x] Image optimization pipeline with ffmpeg sizing (`w=`) and width allowlist controls
- [x] Responsive images via `srcset`/`sizes` in gallery, stream list, and admin panel
- [x] Auto WebP/AVIF negotiation with JPEG fallback
- [x] Lazy loading for below-fold thumbnails (gallery/stream/admin)
- [x] Resource hints (preconnect/dns-prefetch, stream prefetch)

---

## 4. UI/UX Enhancements

### 4.1 Mobile Responsiveness [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] Touch gestures (swipe navigation + pinch-to-zoom for images)
- [x] Optimized drag-and-drop for mobile uploads
- [x] 60fps-friendly animations on mobile (GPU-friendly transforms)
- [x] Pull-to-refresh on gallery pages
- [x] Mobile-first grid (1-2-3 column responsive)
- [x] Bottom sheet-style modal footer on small screens
- [x] Touch-friendly button sizes (48x48px minimum) in gallery + stream UI

### 4.2 Accessibility (WCAG 2.1 AA) [ ]
**Priority:** P2

Current: Basic ARIA labels in `gallery.html`

Tasks:
- [ ] Complete ARIA labeling for all interactive elements
- [ ] Keyboard navigation (arrow keys, Enter, Esc, Tab)
- [ ] Focus indicators with 3:1 contrast ratio
- [ ] Skip-to-content links
- [ ] Screen reader announcements for dynamic content
- [ ] Reduced motion preference support (`prefers-reduced-motion`)
- [ ] Color contrast compliance (4.5:1 for text)
- [ ] Form validation error announcements
- [ ] Video player accessible controls

### 4.3 Loading States and Feedback [ ]
**Priority:** P2

Tasks:
- [ ] Skeleton screens for gallery loading
- [ ] Progressive image loading (blur-up/LQIP)
- [ ] Upload progress with speed/ETA
- [ ] Toast notifications (success/error/info)
- [ ] Optimistic UI updates
- [ ] Retry mechanisms with exponential backoff
- [ ] Network connectivity detection
- [ ] Offline mode enhancements

### 4.4 Error Handling UX [ ]
**Priority:** P2

Tasks:
- [ ] Replace generic errors with actionable messages
- [ ] Error boundary components
- [ ] User-friendly error pages (404, 500, 403)
- [ ] Recovery suggestions in error states
- [ ] Error reporting mechanism
- [ ] Graceful degradation for unsupported features

---

## 5. New Features

### 5.1 Sharing Enhancements [ ]
**Priority:** P2

Current: Password + expiration

Tasks:
- [ ] Download limits per share (max N downloads)
- [ ] View-only shares (disable download button)
- [ ] Image watermarking option
- [ ] Email notifications on share access
- [ ] Custom branding for share pages
- [ ] QR code generation for shares
- [ ] Share link analytics dashboard
- [ ] Bulk share creation

### 5.2 Search and Discovery [ ]
**Priority:** P3

Tasks:
- [ ] Full-text search using SQLite FTS5
- [ ] EXIF metadata search for images
- [ ] Tag system for files
- [ ] Smart collections (recent, starred, shared)
- [ ] Saved search queries
- [ ] Search result highlighting
- [ ] Search suggestions/autocomplete

### 5.3 Collaboration Features [ ]
**Priority:** P3

Tasks:
- [ ] File comments/annotations
- [ ] Real-time presence indicators
- [ ] File versioning UI
- [ ] Activity timeline per file
- [ ] @mention notifications

### 5.4 Admin Dashboard Improvements [ ]
**Priority:** P2
**Files:** `nginx/analytics.html`

Tasks:
- [ ] Real-time statistics (active users, storage)
- [ ] Storage quota management per user
- [ ] User activity monitoring
- [ ] Audit logs with filtering
- [ ] System health dashboard
- [ ] Scheduled reports (daily/weekly email)
- [ ] Bulk user management
- [ ] Share moderation tools

### 5.5 Upload Improvements [ ]
**Priority:** P2

Tasks:
- [ ] Resumable uploads (tus protocol)
- [ ] Parallel chunk uploads
- [ ] Folder upload with structure
- [ ] Duplicate detection (hash-based)
- [ ] Auto-organization by date/type
- [ ] Upload queue management
- [ ] Background upload continuation

---

## 6. Infrastructure and DevOps

### 6.1 Observability Stack [ ]
**Priority:** P1 (Critical)

Current: Basic logging, no metrics/tracing

Tasks:
- [ ] Add structured logging (JSON format)
- [ ] Implement Prometheus metrics export
  - Request latency histograms
  - Error rates by endpoint
  - Active connections
  - Cache hit/miss ratios
  - Video processing queue depth
- [ ] Set up Grafana dashboards
- [ ] Add OpenTelemetry tracing
- [ ] Implement log aggregation (Loki or Elasticsearch)
- [ ] Create alert rules (high latency, error spikes)
- [ ] Add request ID tracking across services
- [ ] Track Core Web Vitals (LCP, FID, CLS)

Example Prometheus metrics:
```python
# media-server/app/metrics.py
from prometheus_client import Counter, Histogram

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint', 'status']
)

DOWNLOAD_COUNTER = Counter(
    'file_downloads_total',
    'Total file downloads',
    ['share_hash', 'file_type']
)

VIDEO_PROCESSING_TIME = Histogram(
    'video_processing_seconds',
    'Video transcoding duration',
    ['operation', 'quality']
)
```

### 6.2 CI/CD Pipeline [ ]
**Priority:** P1

Tasks:
- [ ] Create GitHub Actions workflows:
  ```yaml
  # .github/workflows/ci.yml
  - Lint and format check
  - Type checking (mypy, tsc)
  - Unit tests with coverage
  - Integration tests
  - Security scanning (Snyk)
  - Container image build
  - Push to container registry
  ```
- [ ] Create deployment workflow:
  ```yaml
  # .github/workflows/deploy.yml
  - Pull latest images
  - Run database migrations
  - Blue-green deployment
  - Health check verification
  - Rollback on failure
  ```
- [ ] Set up staging environment
- [ ] Implement feature flags (LaunchDarkly or Unleash)
- [ ] Add deployment notifications (Slack)

### 6.3 Backup and Disaster Recovery [ ]
**Priority:** P1

Current: Data in `./data` and `./database` (no automated backups)

Tasks:
- [ ] Implement automated daily backups
  - SQLite databases (WAL checkpoint + copy)
  - Redis RDB snapshots
  - File data (rsync or rclone)
- [ ] Backup to off-site storage (S3, B2, or R2)
- [ ] Implement backup verification scripts
- [ ] Point-in-time recovery capability
- [ ] Create disaster recovery runbook
- [ ] Quarterly recovery drills
- [ ] Retention policy (30 days daily, 12 months monthly)

Example backup script:
```bash
#!/bin/bash
# scripts/backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/$DATE"

# Checkpoint SQLite WAL files
sqlite3 database/droppr-analytics.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 database/droppr-video-meta.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"

# Create backup
mkdir -p "$BACKUP_DIR"
cp database/*.sqlite3 "$BACKUP_DIR/"
redis-cli BGSAVE && cp database/redis/dump.rdb "$BACKUP_DIR/"
tar -czf "$BACKUP_DIR/data.tar.gz" data/

# Upload to remote
rclone sync "$BACKUP_DIR" remote:backups/dropbox/
```

### 6.4 Error Monitoring [ ]
**Priority:** P1

Tasks:
- [ ] Integrate Sentry for error tracking
  - Python SDK in media-server
  - JavaScript SDK in frontend
  - Source map uploads for stack traces
- [ ] Configure error grouping rules
- [ ] Set up alert thresholds
- [ ] Add user context to errors
- [ ] Create error dashboards
- [ ] Implement error budgets (SLOs)

### 6.5 Scalability Preparation [ ]
**Priority:** P3

Current: Single-server Docker Compose

Tasks:
- [ ] Document Kubernetes migration path
- [ ] Create Helm charts for deployment
- [ ] Implement database connection pooling (PgBouncer pattern for SQLite alternative)
- [ ] Evaluate PostgreSQL migration for multi-instance
- [ ] Design stateless service architecture
- [ ] Implement object storage for files (S3-compatible)
- [ ] Add horizontal pod autoscaling rules
- [ ] Design for multi-region deployment

### 6.6 Environment Management [ ]
**Priority:** P2

Tasks:
- [ ] Create `docker-compose.prod.yml` (production overrides)
- [ ] Create `docker-compose.dev.yml` (development with hot reload)
- [ ] Add environment variable validation on startup
- [ ] Implement graceful shutdown handling (SIGTERM)
- [ ] Add health check endpoints for all services
- [ ] Create `Makefile` for common operations

Example Makefile:
```makefile
.PHONY: dev prod test lint

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

test:
	docker compose exec media-server pytest --cov=app tests/

lint:
	docker compose exec media-server ruff check app/
	docker compose exec dropbox npm run lint

migrate:
	docker compose exec media-server python -m app.migrations
```

---

## 7. SEO and Social

### 7.1 Share Page Optimization [ ]
**Priority:** P3

Tasks:
- [ ] Add Open Graph meta tags
  ```html
  <meta property="og:title" content="Shared Files">
  <meta property="og:description" content="View shared files">
  <meta property="og:image" content="/api/share/{hash}/preview">
  ```
- [ ] Implement Twitter Card metadata
- [ ] Add Schema.org structured data
- [ ] Generate dynamic thumbnails for shares
- [ ] Custom share titles/descriptions
- [ ] Canonical URLs

### 7.2 Performance Metrics [ ]
**Priority:** P2

Targets:
- [ ] Largest Contentful Paint (LCP) < 2.5s
- [ ] First Input Delay (FID) < 100ms
- [ ] Cumulative Layout Shift (CLS) < 0.1
- [ ] Time to First Byte (TTFB) < 600ms

Tasks:
- [ ] Implement performance monitoring (web-vitals)
- [ ] Optimize font loading (`font-display: swap`)
- [ ] Reduce main thread blocking
- [ ] Implement resource priorities

---

## 8. Quick Wins [ ]

Immediate improvements with high impact/low effort:

- [ ] Add `/version` endpoint for deployment tracking
- [ ] Implement request ID header (`X-Request-ID`) for debugging
- [ ] Add `robots.txt` for search engine control
- [ ] Create proper favicon and PWA icons
- [ ] Add `.env` validation on startup (fail fast on missing vars)
- [ ] Enable Brotli compression in nginx (better than gzip)
- [ ] Add CORS configuration for API access
- [ ] Implement graceful shutdown for Gunicorn workers
- [ ] Add retry-after header for rate limited responses
- [ ] Create `docker-compose.override.yml` for local development

---

## 9. Implementation Roadmap

### Phase 1: Foundation (P0/P1)
**Focus:** Testing, Observability, CI/CD

1. Set up pytest with fixtures and 80% backend coverage target
2. Add Vitest for frontend unit testing
3. Implement structured logging and Prometheus metrics
4. Create GitHub Actions CI pipeline
5. Add Sentry error monitoring
6. Implement automated backups

### Phase 2: Code Quality (P1)
**Focus:** Modularity, Standards

1. Refactor `media-server/app/legacy.py` into modular structure
2. Set up Vite build for frontend
3. Convert to TypeScript
4. Add linting and pre-commit hooks
5. Create API documentation (OpenAPI)

### Phase 3: User Experience (P2)
**Focus:** Mobile, Accessibility, Polish

1. Mobile responsiveness improvements
2. WCAG 2.1 AA accessibility compliance
3. Loading states and feedback
4. Error handling UX
5. Sharing enhancements

### Phase 4: Features (P2/P3)
**Focus:** Video, Admin, Search

1. HLS adaptive bitrate streaming
2. Admin dashboard improvements
3. Search functionality
4. Upload improvements
5. Collaboration features

### Phase 5: Scale (P3)
**Focus:** Infrastructure for growth

1. CDN integration
2. Kubernetes preparation
3. Database scaling strategy
4. Multi-region planning

---

## 10. Metrics to Track

### Technical Metrics
| Metric | Current | Target |
|--------|---------|--------|
| Test Coverage (Backend) | 0% | 80% |
| Test Coverage (Frontend) | 0% | 70% |
| LCP | Unknown | < 2.5s |
| TTFB | Unknown | < 600ms |
| Error Rate | Unknown | < 0.1% |
| P99 Latency | Unknown | < 500ms |

### Operational Metrics
| Metric | Current | Target |
|--------|---------|--------|
| Uptime | Unknown | 99.9% |
| MTTR | Unknown | < 30 min |
| Deploy Frequency | Manual | Daily capable |
| Lead Time | Unknown | < 1 day |

### User Metrics
| Metric | Description |
|--------|-------------|
| DAU/MAU | Daily/Monthly active users |
| Upload Success Rate | % of uploads completing |
| Video Playback Starts | Video engagement |
| Share Creation Rate | Shares created per day |
| Storage Growth | GB added per month |

---

## Appendix A: File Reference

### Key Files by LOC
| File | Lines | Priority for Refactor |
|------|-------|----------------------|
| `media-server/app/legacy.py` | 4,707 | High |
| `nginx/droppr-panel.js` | 4,944 | High |
| `nginx/droppr-theme.css` | ~800 | Medium |
| `nginx/static/gallery.js` | ~1,000 | Medium |
| `faststart/process.py` | 914 | Low |

### Database Schema
```
droppr-analytics.sqlite3:
├── analytics_events (share_hash, timestamp, event_type, ip, user_agent)
└── archived_events (same schema, for >180 day data)

droppr-video-meta.sqlite3:
├── video_metadata (path, duration, width, height, codec, cached_at)
└── thumbnails (path, timestamp, data)

filebrowser.db:
├── users (FileBrowser managed)
├── shares (FileBrowser managed)
└── settings (FileBrowser managed)
```

### API Endpoints Summary
```
Share API (10 endpoints):
  GET  /api/share/<hash>/files
  GET  /api/share/<hash>/file/<path>
  GET  /api/share/<hash>/preview/<path>
  GET  /api/share/<hash>/proxy/<path>
  GET  /api/share/<hash>/video-sources/<path>
  GET  /api/share/<hash>/video-meta/<path>
  GET  /api/share/<hash>/download
  POST /api/droppr/requests
  GET  /api/droppr/requests/<hash>
  POST /api/droppr/requests/<hash>/upload

Auth API (3 endpoints):
  POST /api/droppr/auth/login
  POST /api/droppr/auth/refresh
  POST /api/droppr/auth/logout

Admin API (3 endpoints):
  GET  /api/droppr/users
  POST /api/droppr/users
  POST /api/droppr/shares/<hash>/expire

Analytics API (4 endpoints):
  GET  /api/analytics/config
  GET  /api/analytics/shares
  GET  /api/analytics/shares/<hash>
  GET  /api/analytics/shares/<hash>/export.csv

Health (1 endpoint):
  GET  /health
```

---

## Appendix B: Environment Variables

All configuration via `DROPPR_*` prefix:

```bash
# Core
DROPPR_FILEBROWSER_BASE_URL=http://app:80
DROPPR_REDIS_URL=redis://redis:6379/0

# Caching
DROPPR_SHARE_CACHE_TTL_SECONDS=3600
DROPPR_VIDEO_CACHE_DIR=/database/proxy-cache
DROPPR_THUMB_CACHE_DIR=/database/thumb-cache

# Rate Limiting
DROPPR_RATE_LIMIT_UPLOADS=50/hour
DROPPR_RATE_LIMIT_DOWNLOADS=1000/hour
DROPPR_RATE_LIMIT_SHARES=20/hour

# Authentication
DROPPR_AUTH_JWT_SECRET=<secret>
DROPPR_AUTH_TOKEN_TTL_SECONDS=3600
DROPPR_AUTH_REFRESH_TTL_SECONDS=86400

# Admin allowlist
DROPPR_ADMIN_IP_ALLOWLIST=203.0.113.10,198.51.100.0/24

# 2FA
DROPPR_ADMIN_TOTP_ENABLED=true
DROPPR_ADMIN_TOTP_SECRET=<base32-secret>

# User Management
DROPPR_USER_SCOPE_ENABLED=true
DROPPR_USER_PASSWORD_MIN_LENGTH=12

# Uploads
DROPPR_UPLOAD_MAX_SIZE_MB=500
DROPPR_UPLOAD_ALLOWED_EXTENSIONS=jpg,png,gif,mp4,mov,pdf

# Thumbnails
DROPPR_THUMB_ALLOW_AVIF=false
DROPPR_THUMB_AVIF_CRF=35
DROPPR_THUMB_ALLOWED_WIDTHS=240,320,480,640,800

# Asset CDN (R2)
DROPPR_R2_ENABLED=false
DROPPR_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
DROPPR_R2_BUCKET=<bucket-name>
DROPPR_R2_ACCESS_KEY_ID=<access-key>
DROPPR_R2_SECRET_ACCESS_KEY=<secret-key>
DROPPR_R2_PUBLIC_BASE_URL=https://<cdn-domain>
DROPPR_R2_PREFIX=droppr-cache
DROPPR_R2_CACHE_CONTROL=public, max-age=86400

# CAPTCHA
DROPPR_CAPTCHA_SITE_KEY=<cloudflare-turnstile-key>
DROPPR_CAPTCHA_SECRET_KEY=<cloudflare-turnstile-secret>

# Analytics
DROPPR_ANALYTICS_RETENTION_DAYS=180
DROPPR_ANALYTICS_IP_MODE=anonymized  # or 'full'

# Secrets management
DROPPR_SECRETS_FILE=/run/secrets/droppr.json
DROPPR_SECRETS_PREFIX=DROPPR_
DROPPR_SECRETS_OVERRIDE=false
DROPPR_SECRETS_REQUIRED=false
DROPPR_AWS_SECRETS_MANAGER_SECRET_ID=<aws-secret-id>
DROPPR_AWS_REGION=us-east-1
DROPPR_VAULT_ADDR=https://vault.service:8200
DROPPR_VAULT_TOKEN=<vault-token>
DROPPR_VAULT_SECRET_PATH=kv/data/droppr
DROPPR_VAULT_NAMESPACE=<vault-namespace>

# Internal request signing
DROPPR_INTERNAL_SIGNING_KEY=<shared-secret>
DROPPR_INTERNAL_SIGNING_HEADER=X-Droppr-Signature
DROPPR_INTERNAL_SIGNING_TIMESTAMP_HEADER=X-Droppr-Timestamp
DROPPR_INTERNAL_SIGNING_INCLUDE_QUERY=true
```
