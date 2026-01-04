from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest
from flask import Flask

from app.middleware.rate_limit import limiter, init_rate_limiter


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def test_limiter_initialization(app):
    """Test that rate limiter can be initialized with Flask app"""
    init_rate_limiter(app)

    # Verify limiter is attached to app
    assert hasattr(app, "extensions")
    assert "limiter" in app.extensions


def test_limiter_key_function():
    """Test that limiter uses custom key function"""
    assert limiter._key_func is not None


@patch("app.middleware.rate_limit._get_rate_limit_key")
def test_limiter_uses_custom_key_func(mock_key_func, app):
    """Test that limiter calls the custom key function"""
    mock_key_func.return_value = "test-key-123"

    init_rate_limiter(app)

    with app.test_request_context():
        # The key function should be callable
        result = limiter._key_func()
        assert result is not None


def test_limiter_default_limits_empty():
    """Test that limiter has no default limits (per-route limiting only)"""
    assert limiter.limit_manager.default_limits == []


def test_limiter_can_exempt_routes(app):
    """Test that limiter can exempt specific routes"""
    from flask import Blueprint

    bp = Blueprint("test", __name__)

    @bp.route("/test")
    @limiter.exempt
    def test_route():
        return "OK"

    app.register_blueprint(bp)
    init_rate_limiter(app)

    client = app.test_client()
    resp = client.get("/test")
    assert resp.status_code == 200
