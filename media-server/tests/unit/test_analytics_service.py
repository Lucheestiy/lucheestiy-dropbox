from __future__ import annotations

import time
import pytest
from unittest.mock import patch, MagicMock

import app.services.analytics as analytics_service

def test_parse_int():
    assert analytics_service._parse_int("123") == 123
    assert analytics_service._parse_int(None) is None
    assert analytics_service._parse_int("abc") is None

def test_get_time_range(app_module):
    with app_module.app.test_request_context("/?days=5"):
        since, until = analytics_service._get_time_range()
        assert until > since
        assert until - since == 5 * 86400
        
    with app_module.app.test_request_context("/?since=1000&until=2000"):
        since, until = analytics_service._get_time_range()
        assert since == 1000
        assert until == 2000

def test_get_client_ip_modes(app_module):
    # Mode: full
    with patch("app.services.analytics.ANALYTICS_IP_MODE", "full"):
        with app_module.app.test_request_context("/", environ_base={"REMOTE_ADDR": "1.2.3.4"}):
            assert analytics_service._get_client_ip() == "1.2.3.4"
            
        with app_module.app.test_request_context("/", headers={"X-Forwarded-For": "5.6.7.8"}):
            assert analytics_service._get_client_ip() == "5.6.7.8"

    # Mode: anonymized
    with patch("app.services.analytics.ANALYTICS_IP_MODE", "anonymized"):
        with app_module.app.test_request_context("/", environ_base={"REMOTE_ADDR": "192.168.1.50"}):
            assert analytics_service._get_client_ip() == "192.168.1.0/24"
            
    # Mode: off
    with patch("app.services.analytics.ANALYTICS_IP_MODE", "off"):
        with app_module.app.test_request_context("/", environ_base={"REMOTE_ADDR": "1.2.3.4"}):
            assert analytics_service._get_client_ip() is None

def test_analytics_cache():
    # Reset cache
    with analytics_service._analytics_cache_lock:
        analytics_service._analytics_cache.clear()
        
    with patch("app.services.analytics.ANALYTICS_CACHE_TTL_SECONDS", 60):
        analytics_service._analytics_cache_set("key1", {"data": 1})
        assert analytics_service._analytics_cache_get("key1") == {"data": 1}
        assert analytics_service._analytics_cache_get("missing") is None
        
    with patch("app.services.analytics.ANALYTICS_CACHE_TTL_SECONDS", -1):
        analytics_service._analytics_cache_set("key2", {"data": 2})
        assert analytics_service._analytics_cache_get("key2") is None

def test_should_log_event():
    with patch("app.services.analytics.ANALYTICS_ENABLED", True):
        with patch("app.services.analytics.ANALYTICS_LOG_GALLERY_VIEWS", True):
            assert analytics_service._should_log_event("gallery_view") is True
        with patch("app.services.analytics.ANALYTICS_LOG_GALLERY_VIEWS", False):
            assert analytics_service._should_log_event("gallery_view") is False
    with patch("app.services.analytics.ANALYTICS_ENABLED", False):
        assert analytics_service._should_log_event("any") is False

@patch("app.services.analytics._analytics_conn")
def test_log_event(mock_conn_ctx, app_module):
    mock_conn = MagicMock()
    mock_conn_ctx.return_value.__enter__.return_value = mock_conn
    
    with app_module.app.test_request_context("/", headers={"User-Agent": "test-ua"}):
        analytics_service._log_event("gallery_view", "hash1")
        assert mock_conn.execute.called
        # Check if it tried to insert into download_events
        args, kwargs = mock_conn.execute.call_args
        assert args[1]["share_hash"] == "hash1"
        assert args[1]["event_type"] == "gallery_view"

@patch("app.services.analytics._analytics_conn")
def test_log_auth_event(mock_conn_ctx, app_module):
    mock_conn = MagicMock()
    mock_conn_ctx.return_value.__enter__.return_value = mock_conn
    
    with app_module.app.test_request_context("/api/login", headers={"User-Agent": "test-ua"}):
        analytics_service._log_auth_event("login", True, "success-detail")
        assert mock_conn.execute.called
        args, kwargs = mock_conn.execute.call_args
        assert args[1]["event_type"] == "login"
        assert args[1]["success"] == 1
        assert args[1]["detail"] == "success-detail"
