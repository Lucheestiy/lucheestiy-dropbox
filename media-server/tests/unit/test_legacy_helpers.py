import time
import threading
from collections import deque
import pytest
from unittest.mock import MagicMock, patch
import app.legacy as legacy

def test_prune_failures():
    failures = deque([100.0, 200.0, 300.0])
    legacy._prune_failures(failures, 250.0)
    assert list(failures) == [300.0]

def test_get_failure_count():
    store = {"1.2.3.4": deque([time.time() - 10, time.time()])}
    lock = threading.Lock()
    count = legacy._get_failure_count(store, "1.2.3.4", 60, lock)
    assert count == 2
    
    count_missing = legacy._get_failure_count(store, "4.3.2.1", 60, lock)
    assert count_missing == 0

def test_record_failure():
    store = {}
    lock = threading.Lock()
    legacy._record_failure(store, "key", 60, lock)
    assert len(store["key"]) == 1
    legacy._record_failure(store, "key", 60, lock)
    assert len(store["key"]) == 2

def test_clear_failures():
    store = {"key": deque([1])}
    lock = threading.Lock()
    legacy._clear_failures(store, "key", lock)
    assert "key" not in store

def test_admin_ip_allowed():
    with patch("app.legacy.ADMIN_IP_ALLOWLIST", []):
        assert legacy._admin_ip_allowed("1.2.3.4") is True
    
    import ipaddress
    with patch("app.legacy.ADMIN_IP_ALLOWLIST", [ipaddress.ip_network("192.168.1.0/24")]):
        assert legacy._admin_ip_allowed("192.168.1.5") is True
        assert legacy._admin_ip_allowed("10.0.0.1") is False
        assert legacy._admin_ip_allowed(None) is False
        assert legacy._admin_ip_allowed("invalid") is False

def test_generate_request_id():
    assert legacy._generate_request_id("abc-123-long") == "abc-123-long"
    res = legacy._generate_request_id(None)
    assert len(res) > 0
    assert legacy._generate_request_id("short") != "short"
    assert legacy._generate_request_id("invalid!") != "invalid!"

def test_issue_droppr_tokens():
    with patch("app.legacy.DROPPR_AUTH_SECRET", "test-secret"):
        tokens = legacy._issue_droppr_tokens(otp_verified=True, fb_token="fb", fb_iat=100)
        assert "access_token" in tokens
        assert "refresh_token" in tokens
        assert tokens["access_expires_in"] > 0

def test_get_bearer_token():
    app = legacy.app
    with app.test_request_context(headers={"Authorization": "Bearer my-token"}):
        assert legacy._get_bearer_token() == "my-token"
    
    with app.test_request_context(headers={"Authorization": "other"}):
        assert legacy._get_bearer_token() is None
    
    with app.test_request_context(headers={}):
        assert legacy._get_bearer_token() is None

def test_get_droppr_access_claims():
    app = legacy.app
    with app.test_request_context(headers={"Authorization": "Bearer token"}):
        with patch("app.legacy._peek_jwt_payload", return_value={"typ": "droppr_access"}):
            with patch("app.legacy._decode_jwt", return_value={"iss": legacy.DROPPR_AUTH_ISSUER, "sub": "u"}):
                claims = legacy._get_droppr_access_claims()
                assert claims["sub"] == "u"

def test_get_droppr_refresh_claims():
    app = legacy.app
    # From X-Refresh-Token
    with app.test_request_context(headers={"X-Refresh-Token": "token"}):
        with patch("app.legacy._peek_jwt_payload", return_value={"typ": "droppr_refresh"}):
            with patch("app.legacy._decode_jwt", return_value={"iss": legacy.DROPPR_AUTH_ISSUER, "sub": "u"}):
                claims = legacy._get_droppr_refresh_claims()
                assert claims["sub"] == "u"
