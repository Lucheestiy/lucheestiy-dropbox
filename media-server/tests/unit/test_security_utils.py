import time
import pytest

def test_internal_signature(monkeypatch):
    import app.utils.security as security
    
    monkeypatch.setattr(security, "INTERNAL_SIGNING_KEY", "test-key")
    monkeypatch.setattr(security, "INTERNAL_SIGNING_HEADER", "X-Sig")
    monkeypatch.setattr(security, "INTERNAL_SIGNING_TS_HEADER", "X-Ts")
    
    now = 1700000000
    monkeypatch.setattr(time, "time", lambda: now)
    
    method = "GET"
    url = "http://localhost/api/test?foo=bar"
    
    sig, ts = security._build_internal_signature(method, url)
    assert ts == str(now)
    assert sig is not None
    
    # Verify with headers
    headers = {"Existing": "Header"}
    signed = security._with_internal_signature(headers, method, url)
    assert signed["Existing"] == "Header"
    assert signed["X-Sig"] == sig
    assert signed["X-Ts"] == ts

def test_internal_signature_disabled(monkeypatch):
    import app.utils.security as security
    monkeypatch.setattr(security, "INTERNAL_SIGNING_KEY", "")
    
    assert security._build_internal_signature("GET", "/test") is None
    
    headers = {"A": "B"}
    assert security._with_internal_signature(headers, "GET", "/test") == headers

def test_internal_signature_no_query(monkeypatch):
    import app.utils.security as security
    monkeypatch.setattr(security, "INTERNAL_SIGNING_KEY", "test-key")
    monkeypatch.setattr(security, "INTERNAL_SIGNING_INCLUDE_QUERY", False)
    
    now = 1700000000
    monkeypatch.setattr(time, "time", lambda: now)
    
    # Signature should be same with or without query
    sig1, _ = security._build_internal_signature("GET", "/path")
    sig2, _ = security._build_internal_signature("GET", "/path?foo=bar")
    assert sig1 == sig2
