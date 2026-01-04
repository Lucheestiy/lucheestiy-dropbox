from unittest.mock import patch, MagicMock

def test_health_endpoint(client):
    resp = client.get("/health")
    # Depends on environment, but usually ok in tests if DB path is valid
    assert resp.status_code in (200, 503)
    data = resp.get_json()
    assert "status" in data
    assert "services" in data


def test_health_database_failure(client):
    with patch("sqlite3.connect", side_effect=Exception("Disk full")):
        resp = client.get("/health")
        assert resp.status_code == 503
        data = resp.get_json()
        assert data["status"] == "unhealthy"
        assert "database" in data["services"]
        assert "Disk full" in data["services"]["database"]


def test_health_redis_ping_failure(client):
    with patch("app.routes.health.REDIS_ENABLED", True):
        with patch("app.routes.health._get_redis_client") as mock_redis:
            mock_redis.return_value.ping.return_value = False
            resp = client.get("/health")
            assert resp.status_code == 503
            data = resp.get_json()
            assert data["services"]["redis"] == "disconnected"


def test_health_redis_exception(client):
    with patch("app.routes.health.REDIS_ENABLED", True):
        with patch("app.routes.health._get_redis_client", side_effect=Exception("Redis down")):
            resp = client.get("/health")
            assert resp.status_code == 503
            data = resp.get_json()
            assert "Redis down" in data["services"]["redis"]


def test_version_endpoint(client):
    resp = client.get("/version")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "version" in data
    assert "environment" in data


def test_metrics_disabled(client):
    resp = client.get("/metrics")
    assert resp.status_code == 404
