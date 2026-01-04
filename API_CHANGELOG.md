# API Changelog - Droppr

All notable changes to the Droppr API will be documented in this file.

## [1.7.0] - 2026-01-04
### Added
- Integration tests for Comments API and Droppr Aliases API.
- Unit tests for Comments service.
- Improved backend test coverage (now at 74%).
- Comprehensive health check tests covering failure scenarios and Redis.
- Enhanced media processing tests covering R2 and helper functions.

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
