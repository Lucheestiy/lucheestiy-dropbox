from __future__ import annotations

import hashlib
import logging
import os
import re

import requests

from ..config import parse_bool
from ..utils.validation import _safe_join, _safe_root_path

logger = logging.getLogger("droppr.users")

USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$")
USER_SCOPE_ROOT = _safe_root_path(os.environ.get("DROPPR_USER_ROOT", "/users")) or "/users"
USER_DATA_DIR = os.environ.get("DROPPR_USER_DATA_DIR", "/srv")
try:
    USER_PASSWORD_MIN_LEN = int(os.environ.get("DROPPR_USER_PASSWORD_MIN_LEN", "8"))
except (TypeError, ValueError):
    USER_PASSWORD_MIN_LEN = 8
USER_PASSWORD_MIN_LEN = max(6, USER_PASSWORD_MIN_LEN)
USER_PASSWORD_REQUIRE_UPPER = parse_bool(os.environ.get("DROPPR_USER_PASSWORD_REQUIRE_UPPER", "true"))
USER_PASSWORD_REQUIRE_LOWER = parse_bool(os.environ.get("DROPPR_USER_PASSWORD_REQUIRE_LOWER", "true"))
USER_PASSWORD_REQUIRE_DIGIT = parse_bool(os.environ.get("DROPPR_USER_PASSWORD_REQUIRE_DIGIT", "true"))
USER_PASSWORD_REQUIRE_SYMBOL = parse_bool(os.environ.get("DROPPR_USER_PASSWORD_REQUIRE_SYMBOL", "true"))
USER_PASSWORD_PWNED_CHECK = parse_bool(os.environ.get("DROPPR_PASSWORD_PWNED_CHECK", "false"))
try:
    USER_PASSWORD_PWNED_MIN_COUNT = int(os.environ.get("DROPPR_PASSWORD_PWNED_MIN_COUNT", "1"))
except (TypeError, ValueError):
    USER_PASSWORD_PWNED_MIN_COUNT = 1
try:
    USER_PASSWORD_PWNED_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_PASSWORD_PWNED_TIMEOUT_SECONDS", "5"))
except (TypeError, ValueError):
    USER_PASSWORD_PWNED_TIMEOUT_SECONDS = 5.0

PASSWORD_UPPER_RE = re.compile(r"[A-Z]")
PASSWORD_LOWER_RE = re.compile(r"[a-z]")
PASSWORD_DIGIT_RE = re.compile(r"\d")
PASSWORD_SYMBOL_RE = re.compile(r"[^A-Za-z0-9]")


def _normalize_username(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    if not value:
        return None
    if not USERNAME_RE.fullmatch(value):
        return None
    return value


def _normalize_password(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value)
    if len(value) < USER_PASSWORD_MIN_LEN:
        return None
    return value


def _password_is_pwned(password: str) -> bool:
    if not USER_PASSWORD_PWNED_CHECK:
        return False
    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    try:
        resp = requests.get(
            f"https://api.pwnedpasswords.com/range/{prefix}",
            timeout=USER_PASSWORD_PWNED_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            logger.warning("Pwned password check failed: %s", resp.status_code)
            return False
        for line in resp.text.splitlines():
            if ":" not in line:
                continue
            hash_suffix, count = line.split(":", 1)
            if hash_suffix.strip().upper() == suffix:
                try:
                    return int(count.strip()) >= USER_PASSWORD_PWNED_MIN_COUNT
                except (TypeError, ValueError):
                    return True
        return False
    except Exception as exc:
        logger.warning("Pwned password check failed: %s", exc)
        return False


def _password_rules_error(password: str | None) -> str | None:
    if password is None:
        return "Missing password"
    value = str(password)
    if len(value) < USER_PASSWORD_MIN_LEN:
        return f"Password must be at least {USER_PASSWORD_MIN_LEN} characters"
    if USER_PASSWORD_REQUIRE_UPPER and not PASSWORD_UPPER_RE.search(value):
        return "Password must include an uppercase letter"
    if USER_PASSWORD_REQUIRE_LOWER and not PASSWORD_LOWER_RE.search(value):
        return "Password must include a lowercase letter"
    if USER_PASSWORD_REQUIRE_DIGIT and not PASSWORD_DIGIT_RE.search(value):
        return "Password must include a number"
    if USER_PASSWORD_REQUIRE_SYMBOL and not PASSWORD_SYMBOL_RE.search(value):
        return "Password must include a symbol"
    if _password_is_pwned(value):
        return "Password appears in a breach. Choose another."
    return None


def _build_user_scope(username: str) -> str:
    root = USER_SCOPE_ROOT or "/users"
    if root == "/":
        return "/" + username
    return root.rstrip("/") + "/" + username


def _ensure_user_directory(scope_path: str) -> str:
    base_dir = USER_DATA_DIR or "/srv"
    base_abs = os.path.abspath(base_dir)
    os.makedirs(base_abs, exist_ok=True)
    rel = scope_path.lstrip("/")
    target = _safe_join(base_abs, rel)
    if not target:
        raise RuntimeError("Invalid user directory")
    os.makedirs(target, exist_ok=True)
    if not os.path.isdir(target):
        raise RuntimeError("User directory is not a directory")
    return target
