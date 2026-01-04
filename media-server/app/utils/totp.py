from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time

from flask import request

ADMIN_TOTP_SECRETS_RAW = (
    os.environ.get("DROPPR_ADMIN_TOTP_SECRET") or os.environ.get("DROPPR_ADMIN_TOTP_SECRETS") or ""
).strip()
ADMIN_TOTP_SECRETS = [
    s.strip().replace(" ", "") for s in ADMIN_TOTP_SECRETS_RAW.split(",") if s.strip()
]
ADMIN_TOTP_ENABLED = bool(ADMIN_TOTP_SECRETS)
try:
    ADMIN_TOTP_STEP_SECONDS = int(os.environ.get("DROPPR_ADMIN_TOTP_STEP_SECONDS", "30"))
except (TypeError, ValueError):
    ADMIN_TOTP_STEP_SECONDS = 30
try:
    ADMIN_TOTP_WINDOW = int(os.environ.get("DROPPR_ADMIN_TOTP_WINDOW", "1"))
except (TypeError, ValueError):
    ADMIN_TOTP_WINDOW = 1


def _verify_totp_code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret, casefold=True)
    msg = counter.to_bytes(8, "big")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return str(code % 1000000).zfill(6)


def _is_valid_totp(code: str) -> bool:
    if not ADMIN_TOTP_ENABLED:
        return True
    raw = str(code or "").strip().replace(" ", "")
    if not raw or not raw.isdigit():
        return False
    now = int(time.time())
    counter = int(now / ADMIN_TOTP_STEP_SECONDS)
    for secret in ADMIN_TOTP_SECRETS:
        for offset in range(-ADMIN_TOTP_WINDOW, ADMIN_TOTP_WINDOW + 1):
            try:
                if _verify_totp_code(secret, counter + offset) == raw:
                    return True
            except Exception:
                continue
    return False


def _get_totp_code_from_request() -> str | None:
    return (
        request.headers.get("X-Droppr-OTP")
        or request.headers.get("X-OTP")
        or request.headers.get("X-2FA")
        or request.headers.get("X-2fa")
    )
