from __future__ import annotations

from flask import request

from .validation import _normalize_ip


def _get_request_ip() -> str | None:
    candidates = [
        request.headers.get("CF-Connecting-IP"),
        request.headers.get("X-Forwarded-For"),
        request.headers.get("X-Real-IP"),
        request.remote_addr,
    ]

    for candidate in candidates:
        ip = _normalize_ip(candidate)
        if ip:
            return ip
    return None


def _get_rate_limit_key() -> str:
    try:
        ip = _get_request_ip()
    except RuntimeError:
        ip = None
    return ip or "unknown"
