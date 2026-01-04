from __future__ import annotations

import logging
import os

logger = logging.getLogger("droppr.config")

REQUIRED_VARS = [
    "DROPPR_AUTH_SECRET",
    "DROPPR_REDIS_URL",
]


def validate_config():
    missing = []
    for var in REQUIRED_VARS:
        if not os.environ.get(var):
            missing.append(var)

    if missing:
        msg = f"Missing required environment variables: {', '.join(missing)}"
        logger.error(msg)
        # In a real production app, we might want to raise SystemExit(1) here
        # but let's just log for now to avoid breaking existing setups that might
        # rely on defaults I'm not aware of.
        # raise SystemExit(msg)

    # Validate specific formats if needed
    auth_secret = os.environ.get("DROPPR_AUTH_SECRET")
    if auth_secret and len(auth_secret) < 32:
        logger.warning("DROPPR_AUTH_SECRET is too short. Use at least 32 characters for security.")
