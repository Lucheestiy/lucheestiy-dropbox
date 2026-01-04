from __future__ import annotations

import time
import pytest
from unittest.mock import patch, MagicMock

import app.services.file_requests as requests_service

def test_normalize_request_password():
    assert requests_service._normalize_request_password("secret") == "secret"
    assert requests_service._normalize_request_password(None) is None
    assert requests_service._normalize_request_password("") is None
    with patch("app.services.file_requests.REQUEST_PASSWORD_MAX_LEN", 5):
        assert requests_service._normalize_request_password("too-long") is None

def test_failure_tracking():
    share_hash = "test-hash"
    ip = "1.2.3.4"
    
    # Reset state (since it's module-level global)
    with requests_service._request_password_failures_lock:
        requests_service._request_password_failures.clear()
        
    assert requests_service._request_password_failure_count(share_hash, ip) == 0
    assert requests_service._request_password_blocked(share_hash, ip) is False
    
    # Record failures
    count = requests_service._record_request_password_failure(share_hash, ip)
    assert count == 1
    assert requests_service._request_password_failure_count(share_hash, ip) == 1
    
    # Test blocked
    with patch("app.services.file_requests.REQUEST_PASSWORD_FAILURE_MAX", 2):
        assert requests_service._request_password_blocked(share_hash, ip) is False
        requests_service._record_request_password_failure(share_hash, ip)
        assert requests_service._request_password_blocked(share_hash, ip) is True
        
    # Clear failures
    requests_service._clear_request_password_failures(share_hash, ip)
    assert requests_service._request_password_failure_count(share_hash, ip) == 0
    assert requests_service._request_password_blocked(share_hash, ip) is False

def test_prune_failures():
    from collections import deque
    failures = deque([100.0, 200.0, 300.0])
    requests_service._prune_failures(failures, 250.0)
    assert list(failures) == [300.0]

def test_captcha_required_threshold():
    share_hash = "captcha-hash"
    ip = "5.6.7.8"
    with requests_service._request_password_failures_lock:
        requests_service._request_password_failures.clear()

    with patch("app.services.file_requests.CAPTCHA_ENABLED", True):
        with patch("app.services.file_requests.REQUEST_PASSWORD_CAPTCHA_THRESHOLD", 2):
            assert requests_service._captcha_required_for_request(share_hash, ip) is False
            requests_service._record_request_password_failure(share_hash, ip)
            assert requests_service._captcha_required_for_request(share_hash, ip) is False
            requests_service._record_request_password_failure(share_hash, ip)
            assert requests_service._captcha_required_for_request(share_hash, ip) is True

def test_captcha_payload():
    with patch("app.services.file_requests.CAPTCHA_ENABLED", False):
        payload = requests_service._captcha_payload(True)
        assert payload["captcha_enabled"] is False
    
    with patch("app.services.file_requests.CAPTCHA_ENABLED", True):
        with patch("app.services.file_requests.CAPTCHA_SITE_KEY", "site-key"):
            payload = requests_service._captcha_payload(True)
            assert payload["captcha_enabled"] is True
            assert payload["captcha_required"] is True
            assert payload["captcha_site_key"] == "site-key"

@patch("app.services.file_requests.requests.post")
def test_verify_captcha_token(mock_post):
    with patch("app.services.file_requests.CAPTCHA_ENABLED", True):
        with patch("app.services.file_requests.CAPTCHA_SECRET_KEY", "secret"):
            # Success case
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"success": True}
            mock_post.return_value = mock_resp
            assert requests_service._verify_captcha_token("token", "1.1.1.1") is True
            
            # Failure case
            mock_resp.json.return_value = {"success": False}
            assert requests_service._verify_captcha_token("token", "1.1.1.1") is False
            
            # Empty token
            assert requests_service._verify_captcha_token("", "1.1.1.1") is False
            
            # Exception case
            mock_post.side_effect = Exception("error")
            assert requests_service._verify_captcha_token("token", "1.1.1.1") is False

def test_request_is_expired():
    now = int(time.time())
    assert requests_service._request_is_expired({"expires_at": None}) is False
    assert requests_service._request_is_expired({"expires_at": 0}) is False
    assert requests_service._request_is_expired({"expires_at": now + 100}) is False
    assert requests_service._request_is_expired({"expires_at": now - 100}) is True
    assert requests_service._request_is_expired({"expires_at": "bad"}) is False

def test_resolve_request_dir():
    with patch("app.services.file_requests.USER_DATA_DIR", "/srv"):
        res = requests_service._resolve_request_dir("uploads/bob")
        assert res == "/srv/uploads/bob"
        
        # Directory traversal attempt
        assert requests_service._resolve_request_dir("../etc/passwd") is None

def test_create_and_fetch_request_record(app_module):
    # This uses the real database path from conftest.py
    path = "/user/uploads"
    pwd_hash = "hashed_pwd"
    expires = int(time.time()) + 3600
    
    record = requests_service._create_file_request_record(
        path=path,
        password_hash=pwd_hash,
        expires_at=expires
    )
    
    assert "hash" in record
    assert record["path"] == path
    assert record["password_hash"] == pwd_hash
    assert record["expires_at"] == expires
    
    fetched = requests_service._fetch_file_request(record["hash"])
    assert fetched
    assert fetched["hash"] == record["hash"]
    assert fetched["path"] == path
    assert fetched["password_hash"] == pwd_hash
