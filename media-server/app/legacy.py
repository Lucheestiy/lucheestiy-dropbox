#!/usr/bin/env python3
"""
Dropbox media server

Provides:
- Gallery support:
  - GET /api/share/<hash>/files: list files in a share (public, cached)
  - GET /api/share/<hash>/file/<path>: counted downloads (redirects to FileBrowser)
  - GET /api/share/<hash>/download: counted "download all" (streams FileBrowser ZIP/file)
- File requests:
  - POST /api/droppr/requests: create upload-only request (auth required)
  - GET /api/droppr/requests/<hash>: request metadata (public)
  - POST /api/droppr/requests/<hash>/upload: upload file (public, optional password)
- Admin user management (requires FileBrowser auth token):
  - GET /api/droppr/users: account scope config
  - POST /api/droppr/users: create scoped upload user
- Admin analytics (requires FileBrowser auth token):
  - GET /api/analytics/config
  - GET /api/analytics/shares
  - GET /api/analytics/shares/<hash>
  - GET /api/analytics/shares/<hash>/export.csv
"""

from __future__ import annotations

import ipaddress
import os
import re
import secrets
import threading
import time
from collections import deque

import requests
import sentry_sdk
from celery import Celery
from flask import Flask, g, has_request_context, jsonify, request
from sentry_sdk.integrations.flask import FlaskIntegration
from werkzeug.security import generate_password_hash

from .config import load_flask_config, parse_bool
from .logging_config import REQUEST_ID_HEADER, REQUEST_ID_RE, configure_logging
from .metrics import (
    BACKGROUND_TASKS,
    METRICS_ENABLED,
    REQUEST_COUNT,
    REQUEST_ERRORS,
    REQUEST_IN_FLIGHT,
    REQUEST_LATENCY,
    SHARE_CACHE_HITS,
    SHARE_CACHE_MISSES,
    THUMBNAIL_COUNT,
    VIDEO_TRANSCODE_COUNT,
    VIDEO_TRANSCODE_LATENCY,
)
from .middleware.rate_limit import init_rate_limiter
from .routes.analytics import create_analytics_blueprint
from .routes.comments import create_comments_blueprint
from .routes.droppr_aliases import create_droppr_aliases_blueprint
from .routes.droppr_auth import create_droppr_auth_blueprint
from .routes.droppr_media import create_droppr_media_blueprint
from .routes.droppr_requests import create_droppr_requests_blueprint
from .routes.droppr_shares import create_droppr_shares_blueprint
from .routes.droppr_users import create_droppr_users_blueprint
from .routes.exif_search import create_exif_search_blueprint
from .routes.health import health_bp
from .routes.metrics import metrics_bp
from .routes.seo import seo_bp
from .routes.share import create_share_blueprint
from .routes.share_media import create_share_media_blueprint
from .services.aliases import (
    _get_share_alias_meta,
    _increment_share_alias_download_count,
    _resolve_share_hash,
)
from .services.analytics import (
    ANALYTICS_ENABLED,
    _analytics_conn,
    _log_auth_event,
    _log_event,
)
from .services.cache import (
    REDIS_ENABLED,
    _redis_share_cache_get,
    _redis_share_cache_set,
)
from .services.container import init_services
from .services.file_requests import (
    CAPTCHA_ENABLED,
    REQUEST_PASSWORD_CAPTCHA_THRESHOLD,
    REQUEST_PASSWORD_FAILURE_MAX,
    _captcha_payload,
    _captcha_required_for_request,
    _clear_request_password_failures,
    _create_file_request_record,
    _fetch_file_request,
    _normalize_request_password,
    _record_request_password_failure,
    _request_is_expired,
    _request_password_blocked,
    _resolve_request_dir,
    _verify_captcha_token,
)
from .services.filebrowser import (
    FILEBROWSER_BASE_URL,
    FILEBROWSER_PUBLIC_DL_API,
    _fetch_filebrowser_resource,
    _fetch_public_share_json,
)
from .services.media_processing import (
    HLS_CACHE_DIR,
    HLS_RENDITIONS,
    PROXY_CACHE_DIR,
    THUMB_FFMPEG_TIMEOUT_SECONDS,
    THUMB_MAX_WIDTH,
    THUMB_MULTI_DEFAULT,
    THUMB_MULTI_MAX,
    _enqueue_r2_upload_file,
    _ensure_fast_proxy_mp4,
    _ensure_hd_mp4,
    _ensure_hls_package,
    _ffmpeg_thumbnail_cmd,
    _get_cache_path,
    _hd_cache_key,
    _hls_cache_key,
    _maybe_redirect_r2,
    _normalize_preview_format,
    _normalize_thumb_width,
    _parse_preview_time,
    _preview_fallbacks,
    _preview_mimetype,
    _proxy_cache_key,
    _r2_available_url,
    _r2_hls_key,
    _r2_proxy_key,
    _r2_thumb_key,
    _r2_upload_file,
    _r2_upload_hls_package,
    _select_preview_format,
    _thumb_cache_basename,
    _thumb_sema,
    configure_enqueue_task,
)
from .services.secrets import _load_external_secrets
from .services.share import (
    _build_file_share_file_list,
    _build_folder_share_file_list,
)
from .services.share_cache import _share_cache_lock, _share_files_cache
from .services.video_meta import _ensure_video_meta_record, _ffprobe_video_meta
from .tracing import configure_tracing
from .utils.config_validation import validate_config
from .utils.filesystem import _ensure_unique_path
from .utils.jwt import (
    _decode_jwt,
    _encode_jwt,
    _peek_jwt_payload,
)
from .utils.request import _get_rate_limit_key, _get_request_ip
from .utils.security import _with_internal_signature
from .utils.totp import ADMIN_TOTP_ENABLED, _get_totp_code_from_request, _is_valid_totp
from .utils.validation import (
    IMAGE_EXTS,
    UPLOAD_ALLOW_ALL_EXTS,
    UPLOAD_ALLOWED_EXTS,
    UPLOAD_MAX_BYTES,
    UPLOAD_SESSION_DIRNAME,
    VIDEO_EXTS,
    UploadValidationError,
    _chunk_upload_paths,
    _copy_stream_with_limit,
    _load_chunk_upload_meta,
    _normalize_chunk_upload_id,
    _normalize_upload_rel_path,
    _parse_content_range,
    _safe_join,
    _safe_rel_path,
    _safe_root_path,
    _save_chunk_upload_meta,
    _validate_chunk_upload_type,
    _validate_upload_size,
    _validate_upload_type,
    is_valid_share_hash,
)

_load_external_secrets()
validate_config()

app = Flask(__name__)
for key, value in load_flask_config().items():
    app.config.setdefault(key, value)

configure_logging(app)
configure_tracing(app)
init_services(app)


def _generate_request_id(raw: str | None) -> str:
    candidate = (raw or "").strip()
    if candidate and REQUEST_ID_RE.fullmatch(candidate):
        return candidate
    return secrets.token_urlsafe(12)


SENTRY_DSN = (os.environ.get("DROPPR_SENTRY_DSN") or "").strip()
SENTRY_ENV = (
    os.environ.get("DROPPR_SENTRY_ENV") or os.environ.get("SENTRY_ENVIRONMENT") or "production"
).strip()
SENTRY_RELEASE = (os.environ.get("DROPPR_RELEASE") or "").strip() or None
try:
    SENTRY_TRACES_SAMPLE_RATE = float(os.environ.get("DROPPR_SENTRY_TRACES_SAMPLE_RATE", "0"))
except (TypeError, ValueError):
    SENTRY_TRACES_SAMPLE_RATE = 0.0
try:
    SENTRY_PROFILES_SAMPLE_RATE = float(os.environ.get("DROPPR_SENTRY_PROFILES_SAMPLE_RATE", "0"))
except (TypeError, ValueError):
    SENTRY_PROFILES_SAMPLE_RATE = 0.0

if SENTRY_DSN:

    def _sentry_before_send(event, _hint):
        if has_request_context():
            request_id = getattr(g, "request_id", None)
            if request_id:
                event.setdefault("tags", {})["request_id"] = request_id
        return event

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENV,
        release=SENTRY_RELEASE,
        integrations=[FlaskIntegration()],
        traces_sample_rate=max(0.0, SENTRY_TRACES_SAMPLE_RATE),
        profiles_sample_rate=max(0.0, SENTRY_PROFILES_SAMPLE_RATE),
        send_default_pii=False,
        before_send=_sentry_before_send,
    )

# Gallery file-list caching (in-memory, per gunicorn worker)
DEFAULT_CACHE_TTL_SECONDS = int(os.environ.get("DROPPR_SHARE_CACHE_TTL_SECONDS", "3600"))
MAX_CACHE_SIZE = 1000  # Max number of shares to cache
SHARE_CACHE_WARM_ENABLED = parse_bool(os.environ.get("DROPPR_SHARE_CACHE_WARM_ENABLED", "true"))
SHARE_CACHE_WARM_INTERVAL_SECONDS = int(
    os.environ.get("DROPPR_SHARE_CACHE_WARM_INTERVAL_SECONDS", "900")
)
SHARE_CACHE_WARM_LIMIT = int(os.environ.get("DROPPR_SHARE_CACHE_WARM_LIMIT", "20"))
SHARE_CACHE_WARM_DAYS = int(os.environ.get("DROPPR_SHARE_CACHE_WARM_DAYS", "7"))
_last_share_cache_warm_at: float = 0.0

CELERY_BROKER_URL = (os.environ.get("DROPPR_CELERY_BROKER_URL") or "").strip()
CELERY_RESULT_BACKEND = (
    os.environ.get("DROPPR_CELERY_RESULT_BACKEND") or ""
).strip() or CELERY_BROKER_URL
CELERY_ENABLED = bool(CELERY_BROKER_URL)
celery_app = (
    Celery("droppr", broker=CELERY_BROKER_URL, backend=CELERY_RESULT_BACKEND)
    if CELERY_ENABLED
    else None
)
if celery_app:
    celery_app.conf.update(
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
    )

RATE_LIMIT_UPLOADS = os.environ.get("DROPPR_RATE_LIMIT_UPLOADS", "50 per hour")
RATE_LIMIT_DOWNLOADS = os.environ.get("DROPPR_RATE_LIMIT_DOWNLOADS", "1000 per hour")
RATE_LIMIT_SHARE_CREATE = os.environ.get("DROPPR_RATE_LIMIT_SHARE_CREATE", "20 per hour")

try:
    AUTH_FAILURE_MAX = int(os.environ.get("DROPPR_AUTH_FAILURE_MAX", "5"))
except (TypeError, ValueError):
    AUTH_FAILURE_MAX = 5
AUTH_FAILURE_MAX = max(1, AUTH_FAILURE_MAX)

try:
    AUTH_FAILURE_WINDOW_SECONDS = int(os.environ.get("DROPPR_AUTH_FAILURE_WINDOW_SECONDS", "900"))
except (TypeError, ValueError):
    AUTH_FAILURE_WINDOW_SECONDS = 900

DROPPR_AUTH_ISSUER = os.environ.get("DROPPR_AUTH_ISSUER", "droppr")
DROPPR_AUTH_SECRET = os.environ.get("DROPPR_AUTH_SECRET", "").strip()
if not DROPPR_AUTH_SECRET:
    DROPPR_AUTH_SECRET = secrets.token_urlsafe(48)
    app.logger.warning(
        "DROPPR_AUTH_SECRET not set; generated ephemeral secret (tokens reset on restart)."
    )

try:
    # Back-compat: older configs used DROPPR_AUTH_TOKEN_TTL_SECONDS.
    _access_ttl_raw = (
        os.environ.get("DROPPR_AUTH_ACCESS_TTL_SECONDS")
        or os.environ.get("DROPPR_AUTH_TOKEN_TTL_SECONDS")
        or "900"
    )
    DROPPR_AUTH_ACCESS_TTL_SECONDS = int(_access_ttl_raw)
except (TypeError, ValueError):
    DROPPR_AUTH_ACCESS_TTL_SECONDS = 900
DROPPR_AUTH_ACCESS_TTL_SECONDS = max(60, DROPPR_AUTH_ACCESS_TTL_SECONDS)

try:
    DROPPR_AUTH_REFRESH_TTL_SECONDS = int(
        os.environ.get("DROPPR_AUTH_REFRESH_TTL_SECONDS", "86400")
    )
except (TypeError, ValueError):
    DROPPR_AUTH_REFRESH_TTL_SECONDS = 86400
DROPPR_AUTH_REFRESH_TTL_SECONDS = max(
    DROPPR_AUTH_ACCESS_TTL_SECONDS, DROPPR_AUTH_REFRESH_TTL_SECONDS
)

try:
    ADMIN_PASSWORD_MAX_AGE_DAYS = int(os.environ.get("DROPPR_ADMIN_PASSWORD_MAX_AGE_DAYS", "90"))
except (TypeError, ValueError):
    ADMIN_PASSWORD_MAX_AGE_DAYS = 90
ADMIN_PASSWORD_MAX_AGE_DAYS = max(0, ADMIN_PASSWORD_MAX_AGE_DAYS)

ADMIN_IP_ALLOWLIST_RAW = (
    os.environ.get("DROPPR_ADMIN_IP_ALLOWLIST") or os.environ.get("DROPPR_ADMIN_ALLOWLIST") or ""
).strip()
ADMIN_IP_ALLOWLIST: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
if ADMIN_IP_ALLOWLIST_RAW:
    for part in re.split(r"[,\s]+", ADMIN_IP_ALLOWLIST_RAW):
        if not part:
            continue
        try:
            ADMIN_IP_ALLOWLIST.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            app.logger.warning("Invalid admin allowlist entry: %s", part)

_refresh_tokens_lock = threading.Lock()
_refresh_tokens: dict[str, dict] = {}

_background_lock = threading.Lock()
_background_tasks: set[str] = set()


def _update_background_tasks_gauge():
    if BACKGROUND_TASKS is not None:
        BACKGROUND_TASKS.set(len(_background_tasks))


_auth_failures_lock = threading.Lock()
_auth_failures: dict[str, deque[float]] = {}


def _store_refresh_token(jti: str, exp: int, otp_verified: bool) -> None:
    with _refresh_tokens_lock:
        _refresh_tokens[jti] = {"exp": int(exp), "revoked": False, "otp": bool(otp_verified)}


def _get_refresh_token_record(jti: str) -> dict | None:
    now = int(time.time())
    with _refresh_tokens_lock:
        record = _refresh_tokens.get(jti)
        if not record:
            return None
        if int(record.get("exp") or 0) < now:
            _refresh_tokens.pop(jti, None)
            return None
        return record


def _revoke_refresh_token(jti: str) -> None:
    with _refresh_tokens_lock:
        record = _refresh_tokens.get(jti)
        if record:
            record["revoked"] = True


def _issue_droppr_tokens(
    otp_verified: bool, fb_token: str | None = None, fb_iat: int | None = None
) -> dict:
    now = int(time.time())
    access_exp = now + DROPPR_AUTH_ACCESS_TTL_SECONDS
    refresh_exp = now + DROPPR_AUTH_REFRESH_TTL_SECONDS
    access_jti = secrets.token_urlsafe(16)
    refresh_jti = secrets.token_urlsafe(24)

    access_payload = {
        "iss": DROPPR_AUTH_ISSUER,
        "iat": now,
        "exp": access_exp,
        "jti": access_jti,
        "typ": "droppr_access",
        "otp": bool(otp_verified),
    }
    refresh_payload = {
        "iss": DROPPR_AUTH_ISSUER,
        "iat": now,
        "exp": refresh_exp,
        "jti": refresh_jti,
        "typ": "droppr_refresh",
        "otp": bool(otp_verified),
    }
    if fb_token:
        access_payload["fb_token"] = fb_token
        refresh_payload["fb_token"] = fb_token
    if fb_iat:
        access_payload["fb_iat"] = int(fb_iat)
        refresh_payload["fb_iat"] = int(fb_iat)

    access_token = _encode_jwt(access_payload, DROPPR_AUTH_SECRET)
    refresh_token = _encode_jwt(refresh_payload, DROPPR_AUTH_SECRET)
    _store_refresh_token(refresh_jti, refresh_exp, bool(otp_verified))

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_expires_in": DROPPR_AUTH_ACCESS_TTL_SECONDS,
        "refresh_expires_in": DROPPR_AUTH_REFRESH_TTL_SECONDS,
        "access_expires_at": access_payload["exp"],
        "refresh_expires_at": refresh_payload["exp"],
    }


def _get_bearer_token() -> str | None:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None
    return auth_header[7:].strip() or None


def _get_droppr_access_claims() -> dict | None:
    token = _get_bearer_token()
    if not token:
        return None
    peek = _peek_jwt_payload(token)
    if not peek or peek.get("typ") != "droppr_access":
        return None
    claims = _decode_jwt(token, DROPPR_AUTH_SECRET, verify_exp=True)
    if not claims or claims.get("iss") != DROPPR_AUTH_ISSUER:
        return None
    return claims


def _get_droppr_refresh_claims() -> dict | None:
    token = _get_bearer_token() or request.headers.get("X-Refresh-Token")
    if not token:
        return None
    peek = _peek_jwt_payload(token)
    if not peek or peek.get("typ") != "droppr_refresh":
        return None
    claims = _decode_jwt(token, DROPPR_AUTH_SECRET, verify_exp=True)
    if not claims or claims.get("iss") != DROPPR_AUTH_ISSUER:
        return None
    return claims


init_rate_limiter(app)


def _record_request_metrics(response) -> None:
    if not METRICS_ENABLED or REQUEST_COUNT is None:
        return
    if getattr(g, "_metrics_done", False):
        return
    g._metrics_done = True
    if getattr(g, "_metrics_inflight", False):
        if REQUEST_IN_FLIGHT is not None:
            REQUEST_IN_FLIGHT.dec()
        g._metrics_inflight = False

    endpoint = request.endpoint or "unknown"
    method = request.method
    status = str(response.status_code)
    REQUEST_COUNT.labels(method, endpoint, status).inc()
    if REQUEST_LATENCY is not None and hasattr(g, "_request_started_at"):
        duration = time.perf_counter() - g._request_started_at
        REQUEST_LATENCY.labels(method, endpoint).observe(duration)
    if REQUEST_ERRORS is not None and response.status_code >= 400:
        REQUEST_ERRORS.labels(method, endpoint, status).inc()


@app.before_request
def _init_request_context():
    g.request_id = _generate_request_id(request.headers.get(REQUEST_ID_HEADER))
    g._request_started_at = time.perf_counter()
    if METRICS_ENABLED and REQUEST_IN_FLIGHT is not None:
        REQUEST_IN_FLIGHT.inc()
        g._metrics_inflight = True


@app.after_request
def _finalize_request(response):
    if hasattr(g, "request_id"):
        response.headers[REQUEST_ID_HEADER] = g.request_id
    _record_request_metrics(response)
    return response


@app.teardown_request
def _teardown_request(_exc):
    if METRICS_ENABLED and getattr(g, "_metrics_inflight", False) and REQUEST_IN_FLIGHT is not None:
        REQUEST_IN_FLIGHT.dec()
        g._metrics_inflight = False


def _prune_failures(failures: deque[float], cutoff: float) -> None:
    while failures and failures[0] < cutoff:
        failures.popleft()


def _get_failure_count(
    store: dict[str, deque[float]], key: str, window_seconds: int, lock: threading.Lock
) -> int:
    now = time.time()
    with lock:
        failures = store.get(key)
        if not failures:
            return 0
        _prune_failures(failures, now - window_seconds)
        if not failures:
            store.pop(key, None)
            return 0
        return len(failures)


def _record_failure(
    store: dict[str, deque[float]], key: str, window_seconds: int, lock: threading.Lock
) -> int:
    now = time.time()
    with lock:
        failures = store.get(key)
        if not failures:
            failures = deque()
            store[key] = failures
        _prune_failures(failures, now - window_seconds)
        failures.append(now)
        return len(failures)


def _clear_failures(store: dict[str, deque[float]], key: str, lock: threading.Lock) -> None:
    with lock:
        store.pop(key, None)


def _auth_failure_count(ip: str) -> int:
    return _get_failure_count(_auth_failures, ip, AUTH_FAILURE_WINDOW_SECONDS, _auth_failures_lock)


def _record_auth_failure(ip: str) -> int:
    return _record_failure(_auth_failures, ip, AUTH_FAILURE_WINDOW_SECONDS, _auth_failures_lock)


def _clear_auth_failures(ip: str) -> None:
    _clear_failures(_auth_failures, ip, _auth_failures_lock)


def _get_auth_token() -> str | None:
    token = request.headers.get("X-Auth")
    if token:
        return token.strip()

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        bearer = auth_header[7:].strip()
        peek = _peek_jwt_payload(bearer)
        if peek and peek.get("typ") in {"droppr_access", "droppr_refresh"}:
            return None
        return bearer

    cookie_token = request.cookies.get("auth")
    if cookie_token:
        return cookie_token.strip()

    return None


def _validate_filebrowser_admin(token: str) -> int | None:
    client_ip = _get_rate_limit_key()
    if client_ip and _auth_failure_count(client_ip) >= AUTH_FAILURE_MAX:
        _log_auth_event("filebrowser_admin", False, "rate_limited")
        return 429

    url = f"{FILEBROWSER_BASE_URL}/api/users"
    headers = _with_internal_signature({"X-Auth": token}, "GET", url)
    resp = requests.get(url, headers=headers, timeout=10)
    if resp.status_code in {401, 403}:
        failures = _record_auth_failure(client_ip)
        if failures >= AUTH_FAILURE_MAX:
            _log_auth_event("filebrowser_admin", False, "rate_limited")
            return 429
        _log_auth_event("filebrowser_admin", False, f"unauthorized:{resp.status_code}")
        return resp.status_code
    try:
        resp.raise_for_status()
    except Exception as e:
        _log_auth_event("filebrowser_admin", False, f"error:{e}")
        raise
    if client_ip:
        _clear_auth_failures(client_ip)
    _log_auth_event("filebrowser_admin", True, "ok")
    return None


def _admin_ip_allowed(ip_value: str | None) -> bool:
    if not ADMIN_IP_ALLOWLIST:
        return True
    if not ip_value:
        return False
    try:
        addr = ipaddress.ip_address(ip_value)
    except ValueError:
        return False
    for net in ADMIN_IP_ALLOWLIST:
        if addr in net:
            return True
    return False


def _require_admin_access():
    if not _admin_ip_allowed(_get_request_ip()):
        _log_auth_event("droppr_access", False, "ip_blocked")
        resp = jsonify({"error": "Admin access denied"})
        resp.status_code = 403
        return resp, None

    claims = _get_droppr_access_claims()
    if claims:
        if ADMIN_TOTP_ENABLED and not claims.get("otp"):
            _log_auth_event("droppr_access", False, "otp_required")
            resp = jsonify({"error": "OTP required", "otp_required": True})
            resp.status_code = 401
            return resp, None
        fb_token = claims.get("fb_token")
        if not fb_token:
            _log_auth_event("droppr_access", False, "missing_fb_token")
            resp = jsonify({"error": "Invalid droppr token"})
            resp.status_code = 401
            return resp, None
        if _admin_password_expired(fb_token, claims.get("fb_iat")):
            _log_auth_event("droppr_access", False, "password_expired")
            resp = jsonify({"error": "Admin password expired", "password_expired": True})
            resp.status_code = 403
            return resp, None
        _log_auth_event("droppr_access", True, "droppr_token")
        return None, {"droppr": True, "claims": claims, "token": fb_token}

    token = _get_auth_token()
    if not token:
        _log_auth_event("droppr_access", False, "missing_token")
        resp = jsonify({"error": "Missing auth token"})
        resp.status_code = 401
        return resp, None

    try:
        status = _validate_filebrowser_admin(token)
    except Exception as e:
        _log_auth_event("droppr_access", False, f"error:{e}")
        resp = jsonify({"error": f"Failed to validate auth: {e}"})
        resp.status_code = 502
        return resp, None

    if status is not None:
        if status == 429:
            resp = jsonify({"error": "Too many authentication attempts"})
            resp.status_code = 429
            return resp, None
        resp = jsonify({"error": "Unauthorized"})
        resp.status_code = status
        return resp, None

    if ADMIN_TOTP_ENABLED:
        code = _get_totp_code_from_request()
        if not _is_valid_totp(code):
            _log_auth_event("droppr_otp", False, "missing_or_invalid")
            resp = jsonify({"error": "OTP required", "otp_required": True})
            resp.status_code = 401
            return resp, None
        _log_auth_event("droppr_otp", True, "ok")

    if _admin_password_expired(token):
        _log_auth_event("droppr_access", False, "password_expired")
        resp = jsonify({"error": "Admin password expired", "password_expired": True})
        resp.status_code = 403
        return resp, None

    _log_auth_event("droppr_access", True, "filebrowser_token")
    return None, {"droppr": False, "claims": None, "token": token}


def _admin_password_expired(fb_token: str | None, fb_iat: int | None = None) -> bool:
    if ADMIN_PASSWORD_MAX_AGE_DAYS <= 0:
        return False
    iat_value = fb_iat
    if iat_value is None and fb_token:
        payload = _peek_jwt_payload(fb_token)
        if payload and payload.get("iat") is not None:
            iat_value = payload.get("iat")
    if iat_value is None:
        return False
    try:
        age_seconds = int(time.time()) - int(iat_value)
    except (TypeError, ValueError):
        return False
    return age_seconds > (ADMIN_PASSWORD_MAX_AGE_DAYS * 86400)


def _maybe_warm_share_cache() -> None:
    if not SHARE_CACHE_WARM_ENABLED or not ANALYTICS_ENABLED:
        return
    if SHARE_CACHE_WARM_INTERVAL_SECONDS <= 0:
        return

    global _last_share_cache_warm_at
    now = time.time()
    if now - _last_share_cache_warm_at < SHARE_CACHE_WARM_INTERVAL_SECONDS:
        return
    _last_share_cache_warm_at = now

    since = int(now - max(1, SHARE_CACHE_WARM_DAYS) * 86400)
    limit = max(1, SHARE_CACHE_WARM_LIMIT)

    def runner():
        try:
            with _analytics_conn() as conn:
                rows = conn.execute(
                    """
                    SELECT share_hash, COUNT(*) AS downloads
                    FROM download_events
                    WHERE created_at >= ? AND event_type IN ('file_download', 'zip_download')
                    GROUP BY share_hash
                    ORDER BY downloads DESC
                    LIMIT ?
                    """,
                    (since, limit),
                ).fetchall()
        except Exception as e:
            app.logger.warning("Share cache warm query failed: %s", e)
            return

        for row in rows:
            share_hash = str(row["share_hash"] or "")
            if not is_valid_share_hash(share_hash):
                continue
            try:
                source_hash = _resolve_share_hash(share_hash)
                _get_share_files(
                    share_hash,
                    source_hash=source_hash,
                    force_refresh=False,
                    max_age_seconds=DEFAULT_CACHE_TTL_SECONDS,
                    recursive=True,
                )
            except Exception:
                continue

    _spawn_background("share-cache-warm", runner)


def _get_share_files(
    request_hash: str,
    *,
    source_hash: str,
    force_refresh: bool,
    max_age_seconds: int,
    recursive: bool,
) -> list[dict] | None:
    now = time.time()
    if not force_refresh:
        redis_cached = _redis_share_cache_get(
            request_hash,
            source_hash=source_hash,
            recursive=recursive,
            max_age_seconds=max_age_seconds,
        )
        if redis_cached is not None:
            if SHARE_CACHE_HITS is not None and REDIS_ENABLED:
                SHARE_CACHE_HITS.labels("redis").inc()
            return redis_cached
        if SHARE_CACHE_MISSES is not None and REDIS_ENABLED:
            SHARE_CACHE_MISSES.labels("redis").inc()

        with _share_cache_lock:
            memory_cached = _share_files_cache.get(request_hash)
            if (
                memory_cached
                and (now - memory_cached[0]) < max_age_seconds
                and memory_cached[1] == source_hash
                and memory_cached[2] == recursive
            ):
                if SHARE_CACHE_HITS is not None:
                    SHARE_CACHE_HITS.labels("memory").inc()
                return memory_cached[3]
        if SHARE_CACHE_MISSES is not None:
            SHARE_CACHE_MISSES.labels("memory").inc()

    data = _fetch_public_share_json(source_hash)
    if not data:
        return None

    if isinstance(data.get("items"), list):
        files = _build_folder_share_file_list(
            request_hash=request_hash, source_hash=source_hash, root=data, recursive=recursive
        )
    else:
        files = _build_file_share_file_list(
            request_hash=request_hash, source_hash=source_hash, meta=data
        )

    _redis_share_cache_set(
        request_hash,
        source_hash=source_hash,
        recursive=recursive,
        files=files,
        ttl_seconds=max_age_seconds,
    )
    with _share_cache_lock:
        if len(_share_files_cache) >= MAX_CACHE_SIZE:
            # Simple eviction strategy: clear the whole cache if it gets too big.
            # A more sophisticated LRU is possible but likely overkill for this scale.
            _share_files_cache.clear()
        _share_files_cache[request_hash] = (now, source_hash, recursive, files)

    return files


def _spawn_background(task_id: str, fn, *args, **kwargs) -> bool:
    with _background_lock:
        if task_id in _background_tasks:
            return False
        _background_tasks.add(task_id)
        _update_background_tasks_gauge()

    def runner():
        try:
            fn(*args, **kwargs)
        except Exception as e:
            app.logger.warning("background task %s failed: %s", task_id, e)
        finally:
            with _background_lock:
                _background_tasks.discard(task_id)
                _update_background_tasks_gauge()

    t = threading.Thread(target=runner, daemon=True)
    t.start()
    return True


def _enqueue_task(task_id: str, task_name: str, fn, *args, **kwargs) -> bool:
    if celery_app:
        try:
            celery_app.send_task(task_name, args=args, kwargs=kwargs, task_id=task_id)
            return True
        except Exception as e:
            app.logger.warning("Celery enqueue failed for %s: %s", task_id, e)
    return _spawn_background(task_id, fn, *args, **kwargs)


configure_enqueue_task(_enqueue_task)


if celery_app:

    @celery_app.task(name="droppr.transcode_fast")
    def _celery_transcode_fast(
        share_hash: str, file_path: str, size: int, modified: str | None
    ) -> None:
        _ensure_fast_proxy_mp4(
            share_hash=share_hash, file_path=file_path, size=size, modified=modified
        )

    @celery_app.task(name="droppr.transcode_hd")
    def _celery_transcode_hd(
        share_hash: str, file_path: str, size: int, modified: str | None
    ) -> None:
        _ensure_hd_mp4(share_hash=share_hash, file_path=file_path, size=size, modified=modified)

    @celery_app.task(name="droppr.transcode_hls")
    def _celery_transcode_hls(
        share_hash: str, file_path: str, size: int, modified: str | None
    ) -> None:
        _ensure_hls_package(
            share_hash=share_hash, file_path=file_path, size=size, modified=modified
        )

    @celery_app.task(name="droppr.r2_upload_file")
    def _celery_r2_upload_file(local_path: str, key: str, content_type: str | None) -> None:
        _r2_upload_file(local_path, key, content_type)

    @celery_app.task(name="droppr.r2_upload_hls")
    def _celery_r2_upload_hls(cache_key: str, output_dir: str) -> None:
        _r2_upload_hls_package(cache_key, output_dir)


app.register_blueprint(health_bp)
app.register_blueprint(metrics_bp)
app.register_blueprint(seo_bp)
app.register_blueprint(
    create_share_blueprint(
        {
            "is_valid_share_hash": is_valid_share_hash,
            "resolve_share_hash": _resolve_share_hash,
            "parse_bool": parse_bool,
            "default_cache_ttl_seconds": DEFAULT_CACHE_TTL_SECONDS,
            "get_share_files": _get_share_files,
            "log_event": _log_event,
            "maybe_warm_share_cache": _maybe_warm_share_cache,
            "safe_rel_path": _safe_rel_path,
            "rate_limit_downloads": RATE_LIMIT_DOWNLOADS,
            "fetch_public_share_json": _fetch_public_share_json,
            "filebrowser_public_dl_api": FILEBROWSER_PUBLIC_DL_API,
            "with_internal_signature": _with_internal_signature,
            "increment_share_alias_download_count": _increment_share_alias_download_count,
            "get_share_alias_meta": _get_share_alias_meta,
        }
    )
)
app.register_blueprint(
    create_share_media_blueprint(
        {
            "is_valid_share_hash": is_valid_share_hash,
            "resolve_share_hash": _resolve_share_hash,
            "safe_rel_path": _safe_rel_path,
            "video_exts": VIDEO_EXTS,
            "image_exts": IMAGE_EXTS,
            "select_preview_format": _select_preview_format,
            "parse_preview_time": _parse_preview_time,
            "normalize_thumb_width": _normalize_thumb_width,
            "thumb_max_width": THUMB_MAX_WIDTH,
            "get_cache_path": _get_cache_path,
            "thumb_cache_basename": _thumb_cache_basename,
            "preview_fallbacks": _preview_fallbacks,
            "r2_thumb_key": _r2_thumb_key,
            "maybe_redirect_r2": _maybe_redirect_r2,
            "enqueue_r2_upload_file": _enqueue_r2_upload_file,
            "ffmpeg_thumbnail_cmd": _ffmpeg_thumbnail_cmd,
            "thumb_sema": _thumb_sema,
            "thumb_ffmpeg_timeout_seconds": THUMB_FFMPEG_TIMEOUT_SECONDS,
            "preview_mimetype": _preview_mimetype,
            "filebrowser_public_dl_api": FILEBROWSER_PUBLIC_DL_API,
            "normalize_preview_format": _normalize_preview_format,
            "ffprobe_video_meta": _ffprobe_video_meta,
            "thumb_multi_default": THUMB_MULTI_DEFAULT,
            "thumb_multi_max": THUMB_MULTI_MAX,
            "fetch_public_share_json": _fetch_public_share_json,
            "parse_bool": parse_bool,
            "proxy_cache_key": _proxy_cache_key,
            "r2_proxy_key": _r2_proxy_key,
            "ensure_fast_proxy_mp4": _ensure_fast_proxy_mp4,
            "hls_cache_key": _hls_cache_key,
            "r2_hls_key": _r2_hls_key,
            "ensure_hls_package": _ensure_hls_package,
            "proxy_cache_dir": PROXY_CACHE_DIR,
            "r2_available_url": _r2_available_url,
            "hd_cache_key": _hd_cache_key,
            "hls_cache_dir": HLS_CACHE_DIR,
            "enqueue_task": _enqueue_task,
            "ensure_hd_mp4": _ensure_hd_mp4,
            "hls_renditions": HLS_RENDITIONS,
            "ensure_video_meta_record": _ensure_video_meta_record,
            "video_transcode_count": VIDEO_TRANSCODE_COUNT,
            "video_transcode_latency": VIDEO_TRANSCODE_LATENCY,
            "thumbnail_count": THUMBNAIL_COUNT,
        }
    )
)
app.register_blueprint(create_analytics_blueprint(_require_admin_access))
app.register_blueprint(
    create_comments_blueprint(
        {
            "resolve_share_hash": _resolve_share_hash,
        }
    )
)
app.register_blueprint(
    create_exif_search_blueprint(
        {
            "get_share_files": _get_share_files,
        }
    )
)
app.register_blueprint(create_droppr_aliases_blueprint(_require_admin_access))

app.register_blueprint(create_droppr_shares_blueprint(_require_admin_access))
app.register_blueprint(
    create_droppr_requests_blueprint(
        _require_admin_access,
        {
            "is_valid_share_hash": is_valid_share_hash,
            "safe_root_path": _safe_root_path,
            "fetch_filebrowser_resource": _fetch_filebrowser_resource,
            "parse_bool": parse_bool,
            "normalize_request_password": _normalize_request_password,
            "generate_password_hash": generate_password_hash,
            "create_file_request_record": _create_file_request_record,
            "fetch_file_request": _fetch_file_request,
            "request_is_expired": _request_is_expired,
            "get_rate_limit_key": _get_rate_limit_key,
            "captcha_required_for_request": _captcha_required_for_request,
            "request_password_blocked": _request_password_blocked,
            "verify_captcha_token": _verify_captcha_token,
            "captcha_payload": _captcha_payload,
            "record_request_password_failure": _record_request_password_failure,
            "clear_request_password_failures": _clear_request_password_failures,
            "captcha_enabled": CAPTCHA_ENABLED,
            "request_password_captcha_threshold": REQUEST_PASSWORD_CAPTCHA_THRESHOLD,
            "request_password_failure_max": REQUEST_PASSWORD_FAILURE_MAX,
            "normalize_upload_rel_path": _normalize_upload_rel_path,
            "validate_upload_size": _validate_upload_size,
            "validate_upload_type": _validate_upload_type,
            "upload_validation_error": UploadValidationError,
            "resolve_request_dir": _resolve_request_dir,
            "safe_join": _safe_join,
            "ensure_unique_path": _ensure_unique_path,
            "copy_stream_with_limit": _copy_stream_with_limit,
            "upload_max_bytes": UPLOAD_MAX_BYTES,
            "upload_allow_all_exts": UPLOAD_ALLOW_ALL_EXTS,
            "upload_allowed_exts": UPLOAD_ALLOWED_EXTS,
            "parse_content_range": _parse_content_range,
            "normalize_chunk_upload_id": _normalize_chunk_upload_id,
            "load_chunk_upload_meta": _load_chunk_upload_meta,
            "save_chunk_upload_meta": _save_chunk_upload_meta,
            "chunk_upload_paths": _chunk_upload_paths,
            "upload_session_dirname": UPLOAD_SESSION_DIRNAME,
            "validate_chunk_upload_type": _validate_chunk_upload_type,
            "rate_limit_share_create": RATE_LIMIT_SHARE_CREATE,
            "rate_limit_uploads": RATE_LIMIT_UPLOADS,
        },
    )
)
app.register_blueprint(create_droppr_users_blueprint(_require_admin_access))
app.register_blueprint(
    create_droppr_auth_blueprint(
        {
            "get_auth_token": _get_auth_token,
            "validate_filebrowser_admin": _validate_filebrowser_admin,
            "log_auth_event": _log_auth_event,
            "admin_totp_enabled": ADMIN_TOTP_ENABLED,
            "get_totp_code_from_request": _get_totp_code_from_request,
            "is_valid_totp": _is_valid_totp,
            "peek_jwt_payload": _peek_jwt_payload,
            "admin_password_expired": _admin_password_expired,
            "issue_droppr_tokens": _issue_droppr_tokens,
            "get_droppr_refresh_claims": _get_droppr_refresh_claims,
            "get_refresh_token_record": _get_refresh_token_record,
            "revoke_refresh_token": _revoke_refresh_token,
        }
    )
)
app.register_blueprint(
    create_droppr_media_blueprint(
        _require_admin_access,
        {
            "safe_root_path": _safe_root_path,
            "fetch_filebrowser_resource": _fetch_filebrowser_resource,
            "ensure_video_meta_record": _ensure_video_meta_record,
            "select_preview_format": _select_preview_format,
            "normalize_thumb_width": _normalize_thumb_width,
            "thumb_max_width": THUMB_MAX_WIDTH,
            "get_cache_path": _get_cache_path,
            "thumb_cache_basename": _thumb_cache_basename,
            "preview_fallbacks": _preview_fallbacks,
            "r2_thumb_key": _r2_thumb_key,
            "maybe_redirect_r2": _maybe_redirect_r2,
            "enqueue_r2_upload_file": _enqueue_r2_upload_file,
            "ffmpeg_thumbnail_cmd": _ffmpeg_thumbnail_cmd,
            "thumb_sema": _thumb_sema,
            "thumb_ffmpeg_timeout_seconds": THUMB_FFMPEG_TIMEOUT_SECONDS,
            "preview_mimetype": _preview_mimetype,
            "filebrowser_base_url": FILEBROWSER_BASE_URL,
            "video_exts": VIDEO_EXTS,
            "image_exts": IMAGE_EXTS,
            "parse_bool": parse_bool,
        },
    )
)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
