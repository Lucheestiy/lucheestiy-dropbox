from __future__ import annotations

import os
from typing import Any


def parse_bool(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def load_flask_config() -> dict[str, Any]:
    return {
        "RATELIMIT_STORAGE_URI": os.environ.get("DROPPR_RATE_LIMIT_STORAGE_URI", "memory://"),
    }
