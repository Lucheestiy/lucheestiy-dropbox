import os
import sqlite3

from flask import Blueprint, jsonify

from ..models import ANALYTICS_DB_PATH
from ..services.cache import REDIS_ENABLED, _get_redis_client

health_bp = Blueprint("health", __name__)

VERSION = os.environ.get("DROPPR_VERSION", "0.1.0-dev")


@health_bp.route("/health")
def health_check():
    status = {"status": "healthy", "services": {}}
    overall_healthy = True

    # Check SQLite
    try:
        conn = sqlite3.connect(ANALYTICS_DB_PATH, timeout=1)
        conn.execute("SELECT 1")
        conn.close()
        status["services"]["database"] = "ok"
    except Exception as exc:
        status["services"]["database"] = f"error: {exc}"
        overall_healthy = False

    # Check Redis
    if REDIS_ENABLED:
        try:
            client = _get_redis_client()
            if client and client.ping():
                status["services"]["redis"] = "ok"
            else:
                status["services"]["redis"] = "disconnected"
                overall_healthy = False
        except Exception as exc:
            status["services"]["redis"] = f"error: {exc}"
            overall_healthy = False
    else:
        status["services"]["redis"] = "disabled"

    if not overall_healthy:
        status["status"] = "unhealthy"
        return jsonify(status), 503

    return jsonify(status)


@health_bp.route("/version")
def version():
    return jsonify(
        {
            "version": VERSION,
            "release": os.environ.get("DROPPR_RELEASE", "none"),
            "environment": os.environ.get("DROPPR_ENV", "production"),
        }
    )
