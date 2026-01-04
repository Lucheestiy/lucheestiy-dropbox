
def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "healthy"}


def test_metrics_disabled(client):
    resp = client.get("/metrics")
    assert resp.status_code == 404
