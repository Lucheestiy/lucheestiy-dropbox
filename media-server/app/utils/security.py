from __future__ import annotations

import hashlib
import hmac
import os
import time
from urllib.parse import urlparse

from ..config import parse_bool

INTERNAL_SIGNING_KEY = (os.environ.get("DROPPR_INTERNAL_SIGNING_KEY") or "").strip()
INTERNAL_SIGNING_HEADER = (
    os.environ.get("DROPPR_INTERNAL_SIGNING_HEADER") or "X-Droppr-Signature"
).strip()
INTERNAL_SIGNING_TS_HEADER = (
    os.environ.get("DROPPR_INTERNAL_SIGNING_TIMESTAMP_HEADER") or "X-Droppr-Timestamp"
).strip()
INTERNAL_SIGNING_INCLUDE_QUERY = parse_bool(os.environ.get("DROPPR_INTERNAL_SIGNING_INCLUDE_QUERY", "true"))


def _build_internal_signature(method: str, url: str) -> tuple[str, str] | None:
    if not INTERNAL_SIGNING_KEY:
        return None

    parsed = urlparse(url)
    path = parsed.path or "/"
    if INTERNAL_SIGNING_INCLUDE_QUERY and parsed.query:
        path = f"{path}?{parsed.query}"

    timestamp = str(int(time.time()))
    payload = f"{method.upper()}\n{path}\n{timestamp}"
    digest = hmac.new(INTERNAL_SIGNING_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return digest, timestamp


def _with_internal_signature(headers: dict[str, str], method: str, url: str) -> dict[str, str]:
    signed = dict(headers or {})
    result = _build_internal_signature(method, url)
    if not result:
        return signed
    digest, timestamp = result
    if INTERNAL_SIGNING_HEADER:
        signed[INTERNAL_SIGNING_HEADER] = digest
    if INTERNAL_SIGNING_TS_HEADER:
        signed[INTERNAL_SIGNING_TS_HEADER] = timestamp
    return signed
