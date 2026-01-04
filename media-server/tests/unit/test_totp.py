import time
import pytest
from flask import Flask

def test_totp_validation(app_module, monkeypatch):
    import app.utils.totp as totp
    
    # Mock settings
    secret = "KVKFKRCPKVKFKRCP" # Valid base32
    monkeypatch.setattr(totp, "ADMIN_TOTP_ENABLED", True)
    monkeypatch.setattr(totp, "ADMIN_TOTP_SECRETS", [secret])
    monkeypatch.setattr(totp, "ADMIN_TOTP_STEP_SECONDS", 30)
    monkeypatch.setattr(totp, "ADMIN_TOTP_WINDOW", 1)

    now = 1700000000
    monkeypatch.setattr(time, "time", lambda: now)

    counter = int(now / 30)
    valid_code = totp._verify_totp_code(secret, counter)

    assert totp._is_valid_totp(valid_code) is True
    assert totp._is_valid_totp("000000") is False
    assert totp._is_valid_totp("notdigits") is False
    assert totp._is_valid_totp("") is False

    # Test window
    prev_code = totp._verify_totp_code(secret, counter - 1)
    assert totp._is_valid_totp(prev_code) is True

    next_code = totp._verify_totp_code(secret, counter + 1)
    assert totp._is_valid_totp(next_code) is True

    far_code = totp._verify_totp_code(secret, counter + 2)
    assert totp._is_valid_totp(far_code) is False

def test_totp_disabled(app_module, monkeypatch):
    import app.utils.totp as totp
    monkeypatch.setattr(totp, "ADMIN_TOTP_ENABLED", False)
    assert totp._is_valid_totp("anything") is True

def test_totp_from_request(app_module):
    import app.utils.totp as totp
    app = app_module.app
    with app.test_request_context(headers={"X-Droppr-OTP": "123456"}):
        assert totp._get_totp_code_from_request() == "123456"
    with app.test_request_context(headers={"X-OTP": "654321"}):
        assert totp._get_totp_code_from_request() == "654321"
    with app.test_request_context(headers={"X-2FA": "111111"}):
        assert totp._get_totp_code_from_request() == "111111"
    with app.test_request_context(headers={"X-2fa": "222222"}):
        assert totp._get_totp_code_from_request() == "222222"
    with app.test_request_context():
        assert totp._get_totp_code_from_request() is None
