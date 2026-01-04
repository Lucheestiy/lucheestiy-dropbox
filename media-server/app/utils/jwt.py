from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padded = data + ("=" * (-len(data) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _encode_jwt(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(signature)}"


def _decode_jwt(token: str, secret: str, verify_exp: bool = True) -> dict | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
    try:
        signature = _b64url_decode(parts[2])
    except Exception:
        return None
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
    except Exception:
        return None
    if verify_exp:
        exp = payload.get("exp")
        if exp is not None:
            try:
                if int(exp) < int(time.time()):
                    return None
            except (TypeError, ValueError):
                return None
    return payload if isinstance(payload, dict) else None


def _peek_jwt_payload(token: str) -> dict | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None
