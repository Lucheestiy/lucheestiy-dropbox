from __future__ import annotations

import os

from prometheus_client import Counter, Gauge, Histogram

from .config import parse_bool

METRICS_ENABLED = parse_bool(os.environ.get("DROPPR_METRICS_ENABLED", "true"))

if METRICS_ENABLED:
    REQUEST_LATENCY = Histogram(
        "droppr_http_request_duration_seconds",
        "HTTP request latency",
        ["method", "endpoint"],
    )
    REQUEST_COUNT = Counter(
        "droppr_http_requests_total",
        "Total HTTP requests",
        ["method", "endpoint", "status"],
    )
    REQUEST_ERRORS = Counter(
        "droppr_http_request_errors_total",
        "HTTP error responses",
        ["method", "endpoint", "status"],
    )
    REQUEST_IN_FLIGHT = Gauge(
        "droppr_http_requests_in_flight",
        "In-flight HTTP requests",
    )
    SHARE_CACHE_HITS = Counter(
        "droppr_share_cache_hits_total",
        "Share cache hits",
        ["layer"],
    )
    SHARE_CACHE_MISSES = Counter(
        "droppr_share_cache_misses_total",
        "Share cache misses",
        ["layer"],
    )
    BACKGROUND_TASKS = Gauge(
        "droppr_background_tasks",
        "Background tasks running",
    )
    VIDEO_TRANSCODE_COUNT = Counter(
        "droppr_video_transcode_total",
        "Total video transcode attempts",
        ["type", "status"],
    )
    VIDEO_TRANSCODE_LATENCY = Histogram(
        "droppr_video_transcode_duration_seconds",
        "Video transcode duration",
        ["type"],
    )
    THUMBNAIL_COUNT = Counter(
        "droppr_thumbnail_total",
        "Total thumbnail generation attempts",
        ["status"],
    )
else:
    REQUEST_LATENCY = None
    REQUEST_COUNT = None
    REQUEST_ERRORS = None
    REQUEST_IN_FLIGHT = None
    SHARE_CACHE_HITS = None
    SHARE_CACHE_MISSES = None
    BACKGROUND_TASKS = None
    VIDEO_TRANSCODE_COUNT = None
    VIDEO_TRANSCODE_LATENCY = None
    THUMBNAIL_COUNT = None
