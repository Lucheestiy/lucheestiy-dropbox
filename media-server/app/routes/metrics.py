from __future__ import annotations

from flask import Blueprint, Response, jsonify
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from ..middleware.rate_limit import limiter
from ..services.metrics import METRICS_ENABLED, _get_metrics_registry

metrics_bp = Blueprint("metrics", __name__)


@metrics_bp.route("/metrics")
@limiter.exempt
def metrics():
    if not METRICS_ENABLED:
        return jsonify({"error": "Metrics disabled"}), 404
    registry = _get_metrics_registry()
    return Response(generate_latest(registry), mimetype=CONTENT_TYPE_LATEST)
