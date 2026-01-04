from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest
from flask import Flask
from prometheus_client import CONTENT_TYPE_LATEST

from app.routes.metrics import metrics_bp


@pytest.fixture
def app():
    app = Flask(__name__)
    app.register_blueprint(metrics_bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


@patch("app.routes.metrics.METRICS_ENABLED", True)
@patch("app.routes.metrics._get_metrics_registry")
def test_metrics_endpoint_enabled(mock_registry, client):
    """Test /metrics endpoint when metrics are enabled"""
    mock_reg = MagicMock()
    mock_registry.return_value = mock_reg

    with patch("app.routes.metrics.generate_latest") as mock_generate:
        mock_generate.return_value = b"# HELP test_metric Test metric\n# TYPE test_metric counter\ntest_metric 42\n"

        resp = client.get("/metrics")

        assert resp.status_code == 200
        assert resp.content_type == CONTENT_TYPE_LATEST
        mock_registry.assert_called_once()
        mock_generate.assert_called_once_with(mock_reg)


@patch("app.routes.metrics.METRICS_ENABLED", False)
def test_metrics_endpoint_disabled(client):
    """Test /metrics endpoint when metrics are disabled"""
    resp = client.get("/metrics")

    assert resp.status_code == 404
    data = resp.get_json()
    assert "error" in data
    assert "disabled" in data["error"].lower()


@patch("app.routes.metrics.METRICS_ENABLED", True)
@patch("app.routes.metrics._get_metrics_registry")
def test_metrics_endpoint_returns_prometheus_format(mock_registry, client):
    """Test /metrics endpoint returns Prometheus text format"""
    mock_reg = MagicMock()
    mock_registry.return_value = mock_reg

    prometheus_output = b"""# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1234
# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 10
http_request_duration_seconds_bucket{le="0.5"} 50
http_request_duration_seconds_bucket{le="+Inf"} 100
http_request_duration_seconds_sum 25.5
http_request_duration_seconds_count 100
"""

    with patch("app.routes.metrics.generate_latest") as mock_generate:
        mock_generate.return_value = prometheus_output

        resp = client.get("/metrics")

        assert resp.status_code == 200
        assert b"http_requests_total" in resp.data
        assert b"http_request_duration_seconds" in resp.data
        assert b"# HELP" in resp.data
        assert b"# TYPE" in resp.data
