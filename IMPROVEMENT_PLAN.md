# Dropbox Clone Improvement Plan (dropbox.lucheestiy.com)

**Last Updated:** 2026-01-04
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
- **Key gaps:** Testing (Coverage improving), Code Standards (Linting)

### Priority Matrix

| Priority | Category | Impact | Effort | Status |
|----------|----------|--------|--------|--------|
| P0 | Critical Testing | High | Medium | In Progress |
| P1 | Code Modularity | High | High | Complete |
| P1 | Observability | High | Medium | Complete |
| P2 | Video Processing | Medium | High | Complete |
| P2 | Mobile/A11y | Medium | Medium | Complete |
| P3 | New Features | Low | High | Pending |

---

## 1. Security Enhancements

### 1.1 Rate Limiting and DoS Protection [x]
**Status:** Complete
**Files:** `media-server/app/middleware/rate_limit.py`, `media-server/app/utils/request.py`

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
**Files:** `media-server/app/utils/validation.py`

Implemented:
- File type whitelist validation via `DROPPR_UPLOAD_ALLOWED_EXTENSIONS`
- MIME type sniffing and validation server-side
- Path sanitization and directory traversal prevention
- `UploadValidationError` custom exception class
- Client-side file size pre-check

### 1.4 Authentication Improvements [x]
**Status:** Complete
**Files:** `media-server/app/utils/jwt.py`, `media-server/app/utils/totp.py`, `media-server/app/routes/droppr_auth.py`

Implemented:
- JWT token refresh mechanism with configurable TTL
- Proper logout endpoint with token revocation
- TOTP 2FA for admin accounts (`DROPPR_ADMIN_TOTP_*` config)
- Authentication attempt logging to analytics DB
- Session timeout handling

### 1.5 Password Security [x]
**Status:** Complete
**Files:** `media-server/app/services/users.py`, `media-server/app/utils/security.py`

Implemented:
- Password complexity requirements (configurable)
- Password breach checking via HaveIBeenPwned API
- Password strength validation
- Werkzeug password hashing (bcrypt-based) for internal use

### 1.6 Additional Security Hardening [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] Secrets management via AWS Secrets Manager / Vault / file-backed JSON loader (`media-server/app/services/secrets.py`)
- [x] Vulnerability scanning in CI/CD (Trivy filesystem + image scans)
- [x] Network policy overlay (`docker-compose.security.yml` with internal/private networks)
- [x] Content-Type-Options `nosniff` header enforced in nginx
- [x] Internal request signing for FileBrowser API calls (HMAC headers)
- [x] Admin IP allowlisting support (CIDR-aware)

---

## 2. Code Quality and Architecture

### 2.1 Backend Modularization [x]
**Priority:** P1 (Critical)
**Status:** Complete

Modular structure implemented. `legacy.py` now serves as the composition root, wiring together modular services and blueprints.

Structure:
```
media-server/
├── app/
│   ├── legacy.py                # Composition root / App Factory
│   ├── config.py                # Configuration management
│   ├── models/                  # (Placeholder for future ORM models)
│   ├── routes/
│   │   ├── analytics.py         # /api/analytics/*
│   │   ├── droppr_aliases.py    # Share alias management
│   │   ├── droppr_auth.py       # Auth endpoints
│   │   ├── droppr_media.py      # Media management
│   │   ├── droppr_requests.py   # File requests
│   │   ├── droppr_shares.py     # Share management
│   │   ├── droppr_users.py      # User management
│   │   ├── health.py            # /health
│   │   ├── metrics.py           # /metrics
│   │   ├── share_media.py       # Public share media (preview/stream)
│   │   └── share.py             # Public share listing
│   ├── services/
│   │   ├── analytics.py         # Analytics logic
│   │   ├── cache.py             # Redis/memory cache
│   │   ├── filebrowser.py       # FileBrowser API client
│   │   ├── media_processing.py  # FFmpeg/R2/Video logic
│   │   ├── metrics.py           # Prometheus metrics config
│   │   ├── secrets.py           # Secrets management
│   │   ├── share_cache.py       # Share caching specific logic
│   │   ├── share.py             # Share business logic
│   │   └── users.py             # User validation rules
│   ├── utils/
│   │   ├── filesystem.py
│   │   ├── jwt.py
│   │   ├── request.py
│   │   ├── security.py
│   │   ├── totp.py
│   │   └── validation.py
│   └── middleware/
│       └── rate_limit.py
├── tests/                       # Test suite
└── Dockerfile
```

### 2.2 Frontend Modularization [x]
**Priority:** P1 (Critical)
**Status:** Complete

Modular structure implemented using TypeScript and Vite in `nginx/src/`. All logic extracted from legacy `droppr-panel.js` into typed services and components.

### 2.3 Testing Suite [~]
**Priority:** P0 (Critical - Currently ~74% Backend Coverage)

Backend testing (`media-server/tests/`):
- [x] Set up pytest with pytest-cov
- [x] Unit tests for Utils, Auth, Cache, DB, Health, RequestID
- [x] Unit tests for Media Processing (`test_media_processing.py`, `test_media_processing_extended.py`)
- [x] Integration tests for Share API (`test_share_api.py`)
- [x] Integration tests for Droppr API, Analytics, FileBrowser (`test_droppr_api.py`, `test_analytics_api.py`, `test_droppr_requests_api.py`, `test_droppr_media_api.py`)
- [x] Integration tests for Share Media and Droppr Shares (`test_share_media_api.py`, `test_droppr_shares_api.py`)
- [x] Unit tests for Secrets, Video Meta, and Legacy helpers
- [x] Integration tests for Auth logic and Request Uploads (Extended)
- [x] Increased utility test coverage (TOTP, Security, Filesystem, Validation)
- [x] Unit and Integration tests for Comments system
- [x] Improved coverage for Health, Aliases, and Media Processing

Frontend testing (`nginx/tests/`):
- [x] Set up Vitest
- [x] Service Worker registration tests (`sw-register.test.js`)
- [x] Component unit tests (Modals: Accounts, Request, AutoShare; Hydrator, ThemeToggle)
- [x] Service layer tests
- [ ] End-to-end tests (Playwright)

### 2.4 Code Standards and Linting [x]
**Priority:** P1
**Status:** Complete

Python:
- [x] `pyproject.toml` with Black, Ruff
- [x] Mypy type checking configured

JavaScript/TypeScript:
- [x] ESLint with TypeScript rules (`nginx/eslint.config.js`)
- [x] Prettier for formatting (`nginx/.prettierrc`)
- [x] All high-priority linting errors fixed

### 2.5 Documentation [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] Create developer setup guide (`DEVELOPMENT.md`)
- [x] Document all environment variables in `.env.example`
- [x] Initial OpenAPI/Swagger documentation (`openapi.yaml`)
- [x] Complete OpenAPI documentation for all 24 API endpoints
- [x] Create architecture diagrams (documented in ARCHITECTURE.md)
- [x] Add inline JSDoc/docstrings for public functions (Core services/utils complete)
- [x] Add troubleshooting guide
- [x] Create API changelog
- [x] Create Disaster Recovery Runbook (`RECOVERY.md`)

---

## 3. Performance Optimizations

### 3.1 Frontend Performance [x]
**Status:** Complete
(Code splitting, Minification, SW caching, HTTP headers, Gzip)

### 3.2 Database Optimization [x]
**Status:** Complete
(Indexes, Connection pooling, Query caching, Archival)

### 3.3 Caching Strategy [x]
**Status:** Complete
(Redis, In-memory TTL, Cache warming, ETag/Cache-Control, Lua scripts)

### 3.4 Video Processing Improvements [x]
**Priority:** P2
**Status:** Complete
(HEVC->H264, Metadata extraction, Thumbnails, Proxy generation, Adaptive HLS, Celery queue, Chunked uploads)

### 3.5 Asset Delivery and CDN [x]
**Priority:** P3
**Status:** Complete
(Cloudflare R2 integration, Image optimization, Responsive images, WebP/AVIF, Lazy loading)

---

## 4. UI/UX Enhancements

### 4.1 Mobile Responsiveness [x]
**Priority:** P2
**Status:** Complete
(Touch gestures, Mobile drag-drop, Animations, Pull-to-refresh, Responsive grid)

### 4.2 Accessibility (WCAG 2.1 AA) [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] ARIA labeling for all interactive elements in main layouts
- [x] Keyboard navigation (arrow keys, Enter, Esc, Tab)
- [x] Focus indicators with high contrast ratio (`:focus-visible`)
- [x] Skip-to-content links added to all main pages
- [x] Screen reader announcements for dynamic content (`aria-live`)
- [x] Reduced motion preference support (`prefers-reduced-motion`)
- [x] Color contrast compliance (Improved light theme contrast)
- [x] Video player accessible controls

### 4.3 Loading States and Feedback [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] Skeleton screens for gallery loading (`gallery.html`)
- [x] Upload progress with speed/ETA (`request.ts`)
- [x] Toast notifications for actions (`gallery.ts`)
- [x] Network connectivity detection and banner (`gallery.ts`)
- [x] Progressive image loading (blur-up/LQIP)
- [x] Optimistic UI updates (Implemented for Share Expiration)
- [x] Retry mechanisms with exponential backoff for uploads
- [x] Offline mode enhancements (Service Worker navigation caching)

### 4.4 Error Handling UX [x]
**Priority:** P2
**Status:** Complete

Completed:
- [x] Specific, actionable error messages for common API failures (401, 404, 410)
- [x] Immediate feedback for long-running actions (e.g., Download All)
- [x] Graceful degradation for unsupported features (e.g., non-video files in Stream Gallery)
- [x] User-friendly error pages (custom 404/500 templates)
- [x] Global error reporting mechanism (Sentry integration via reportError utility)
- [x] Recovery suggestions in all error states (Extended utility in `nginx/src/utils/error.ts`)

---

## 5. New Features

### 5.1 Sharing Enhancements [x]
**Status:** Complete
- [x] Download limits (Counted downloads per alias)
- [x] View-only shares (Option to disable downloads in gallery)
- [x] Share alias expiration (Separate from FileBrowser expiration)

### 5.2 Search and Discovery [x]
**Status:** Complete
- [x] Enhanced search (Filter by name and extension)
- [x] Sort by Date (Modification time tracking)
- [ ] EXIF search (Pending)

### 5.3 Collaboration Features [x]
**Status:** Complete
- [x] Comments (Add/view comments on shared files)
- [x] Persistent author names (localStorage)
- [x] Audit logging for comments

### 5.4 Admin Dashboard Improvements [x]
**Status:** Complete
- [x] Audit logs (Track admin actions: share creation, user management)
- [x] Real-time stats (Live mode polling)
- [x] Tabbed UI (Shares vs. Audit Log)
- [x] Fixed Grafana dashboard integration

### 5.5 Upload Improvements [x]
**Status:** Complete
- [x] Resumable uploads (Session ID persistence in localStorage)
- [x] Robust chunk recovery (Offset mismatch handling)
- [ ] Parallel chunks (Pending)

---

## 6. Infrastructure and DevOps

### 6.1 Observability Stack [x]
**Priority:** P1 (Critical)
**Status:** Complete

- [x] Structured logging (JSON)
- [x] Prometheus metrics export (`media-server/app/services/metrics.py`)
- [x] Detailed performance metrics for media processing (transcodes/thumbnails)
- [x] Grafana dashboard template (`media-server/grafana_dashboard.json`)
- [x] Alert rules (`media-server/prometheus_alerts.yml`)
- [ ] OpenTelemetry

### 6.2 CI/CD Pipeline [~]
**Priority:** P1
**Status:** In Progress
- [x] GitHub Actions for Tests & Security
- [ ] Deployment workflow
- [ ] Staging environment

### 6.3 Backup and Disaster Recovery [x]
**Priority:** P1
**Status:** Complete
- [x] Automated daily backups (Scripted)
- [x] Off-site storage sync
- [x] Backup verification script (`scripts/verify-backup.sh`)
- [x] Disaster recovery runbook (`RECOVERY.md`)

### 6.4 Error Monitoring [x]
**Priority:** P1
- [x] Sentry SDK (Backend + Frontend)
- [x] Alert thresholds (Prometheus alerts for error rates/latency)
- [ ] Dashboards (Grafana integration)

### 6.5 Scalability Preparation [ ]
(Kubernetes, Helm, DB scaling - Pending)

### 6.6 Environment Management [x]
- [x] Makefile
- [x] Docker Compose Dev/Prod overrides (`docker-compose.override.yml`)

---

## 7. SEO and Social
(Open Graph, Performance Metrics - Pending)

## 8. Quick Wins
- [x] /version endpoint
- [x] Request ID header
- [x] robots.txt
- [x] Favicon/PWA icons

---

## 9. Implementation Roadmap

### Phase 1: Foundation (P0/P1)
**Focus:** Testing, Observability, CI/CD
- **Current Status:** Testing coverage increasing. Observability foundational work done. CI basic.

### Phase 2: Code Quality (P1)
**Focus:** Modularity, Standards
- **Current Status:** Modularization Complete. Linting/Standards in progress.

### Phase 3: User Experience (P2)
**Focus:** Mobile, Accessibility, Polish
- **Current Status:** Mobile Done. Accessibility Partial.

### Phase 4: Features (P2/P3)
**Focus:** Video, Admin, Search
- **Current Status:** Video features Done. Others Pending.

### Phase 5: Scale (P3)
**Focus:** Infrastructure for growth
- **Current Status:** Pending.