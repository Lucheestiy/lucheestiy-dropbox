# API Changelog - Droppr

All notable changes to the Droppr API will be documented in this file.

## [1.11.0] - 2026-01-04
### Added
- EXIF metadata extraction and search system:
  - EXIF service (`media-server/app/services/exif.py`)
    - Extract comprehensive metadata using exiftool
    - Support for 10+ image formats (JPEG, PNG, HEIC, CR2, NEF, ARW, DNG, etc.)
    - GPS coordinate parsing (DMS to decimal degrees)
    - Date/time extraction from EXIF data
    - Camera make/model, lens, exposure settings extraction
  - EXIF search API (`media-server/app/routes/exif_search.py`)
    - `POST /api/share/<hash>/exif-search` - Multi-criteria search endpoint
    - `GET /api/share/<hash>/exif-cameras` - List unique cameras in share
    - `GET /api/file/<path>/exif` - Get EXIF data for specific file
  - Search by camera make/model, ISO range, date range, GPS presence, keywords
  - Comprehensive test suite (`test_exif_service.py`) with 20+ test cases
- Kubernetes deployment infrastructure:
  - Complete Kubernetes manifests (`k8s/`)
    - Namespace, ConfigMap, Secrets configuration
    - Persistent Volume Claims for media, cache, and database
    - Deployments for all services (media-server, nginx, redis, celery-worker, filebrowser)
    - Service definitions with ClusterIP and LoadBalancer support
    - Horizontal Pod Autoscalers with CPU/memory-based scaling
  - Production-ready Helm chart (`helm/droppr/`)
    - Flexible values configuration for dev/staging/production
    - Templates for all Kubernetes resources
    - Helper functions for labels and naming
    - Security contexts and pod policies
    - Ingress support with TLS configuration
    - Prometheus ServiceMonitor integration
    - Post-installation notes and usage instructions
  - Comprehensive deployment documentation (`K8S.md`)
    - Quick start guide with Helm
    - Manual deployment with raw manifests
    - Storage class requirements and setup
    - Scaling strategies and HPA configuration
    - Monitoring and logging setup
    - Troubleshooting procedures
    - Backup and disaster recovery
    - Production deployment checklist
  - Helm chart README (`helm/droppr/README.md`)
    - Installation instructions
    - Configuration parameter reference
    - Values file examples for different scenarios
    - Security best practices
    - Upgrade and rollback procedures

### Changed
- Image search capabilities extended with EXIF metadata filtering
- Deployment strategy enhanced with container orchestration support

## [1.10.0] - 2026-01-04
### Added
- Parallel chunk upload system:
  - Frontend parallel upload utility (`nginx/src/utils/parallel-upload.ts`)
    - Concurrent chunk uploads with configurable parallelism (default: 4-6 chunks)
    - Auto-detection of optimal connections based on Network Information API
    - Real-time progress tracking across all chunks
    - Exponential backoff retry logic
    - Session persistence in localStorage for resumption
  - Backend parallel chunk support (`media-server/app/services/parallel_chunks.py`)
    - `ChunkTracker` class for tracking received byte ranges
    - Automatic range merging for adjacent/overlapping chunks
    - Out-of-order chunk reception support
    - Chunk assembly when all ranges received
    - Automatic cleanup of expired sessions (>24 hours)
  - Comprehensive test suite (`test_parallel_chunks.py`)
    - 20+ test cases for tracker and assembly logic
  - Documentation guide (`PARALLEL_UPLOADS.md`)
    - Usage examples and configuration
    - Performance benchmarks
    - Troubleshooting guide

### Changed
- Upload performance improved 1.4-3.6x with parallel chunks on high-bandwidth connections

## [1.9.0] - 2026-01-04
### Added
- SEO and Social Sharing enhancements:
  - Open Graph meta tags utility (`nginx/src/utils/seo.ts`)
  - Twitter Card support for better social sharing
  - Structured data (Schema.org JSON-LD) for WebApplication
  - Dynamic meta tag updates for gallery, video, and request pages
  - Canonical URL management
  - XML sitemap generation endpoint (`/sitemap.xml`)
  - Enhanced robots.txt with bot-specific rules and crawl delays
- Web Vitals performance tracking (`nginx/src/utils/webvitals.ts`):
  - Core Web Vitals metrics (LCP, FID, CLS, FCP, TTFB)
  - Automatic performance reporting to analytics API
  - Rating system (good/needs-improvement/poor) based on web.dev thresholds
  - sendBeacon API usage for reliable metric reporting

### Changed
- Updated robots.txt to block aggressive scrapers with increased crawl delays
- Added sitemap reference to robots.txt

## [1.8.0] - 2026-01-04
### Added
- Comprehensive CI/CD pipeline with deployment workflows:
  - Production deployment workflow with health checks and automatic rollback
  - Staging deployment workflow (manual trigger)
  - Docker build and push workflow for multi-architecture images (amd64, arm64)
- Enhanced testing suite achieving 85%+ backend coverage:
  - Integration tests for Droppr Users API (`test_droppr_users_api.py`)
  - Integration tests for Metrics endpoint (`test_metrics_api.py`)
  - Unit tests for Rate Limiter middleware (`test_rate_limiter.py`)
  - Unit tests for OpenTelemetry tracing (`test_tracing.py`)
  - Unit tests for Aliases service (`test_aliases_service.py`)
  - Unit tests for Service Container (`test_container.py`)
- Error monitoring Grafana dashboard (`grafana_error_monitoring_dashboard.json`)
  - Error rate tracking by status code
  - Request latency percentiles (p50, p95, p99)
  - Top 10 slowest endpoints
  - Media processing error tracking
  - Rate limit violation monitoring
  - Database and cache error tracking
- CI/CD documentation (`CICD.md`) with setup instructions and best practices

## [1.7.0] - 2026-01-04
### Added
- Integration tests for Comments API and Droppr Aliases API
- Unit tests for Comments service
- Improved backend test coverage (now at 74%)
- Comprehensive health check tests covering failure scenarios and Redis
- Enhanced media processing tests covering R2 and helper functions
- End-to-end testing framework with Playwright and initial smoke tests
- OpenTelemetry instrumentation for Flask, Requests, and Celery

## [1.6.0] - 2026-01-04
### Added
- Global error reporting utility in frontend using Sentry.
- Recovery suggestions for common API errors (401, 404, 410, 500) displayed in the UI.
- Custom 404 and 50x error pages in Nginx.
- JSDoc documentation for core frontend services (Auth, API).

### Fixed
- Fixed `NameError` in `media-worker` caused by missing imports in `legacy.py` after modularization.

## [1.5.0] - 2026-01-03
### Added
- Backend modularization: split monolithic `legacy.py` into services and routes.
- Frontend modularization: migrated to TypeScript and Vite.
- Unit testing suite for frontend using Vitest.
- Enhanced backend testing coverage (~56%).

## [1.4.0] - 2026-01-02
### Added
- Rate limiting and DoS protection.
- Content Security Policy (CSP) headers.
- Input validation and sanitization for file uploads.
- JWT token refresh mechanism.
- TOTP 2FA for admin accounts.

## [1.3.0] - 2026-01-01
### Added
- Video processing improvements: Adaptive HLS and HEVC->H264 transcoding.
- Structured logging (JSON) for backend.
- Prometheus metrics export.
