import time

import pytest


def test_password_rules_error(app_module):
    import app.services.users as users_service
    assert users_service._password_rules_error(None) == "Missing password"
    assert "at least" in users_service._password_rules_error("short")
    assert "uppercase" in users_service._password_rules_error("lowercase1!")
    assert "number" in users_service._password_rules_error("NoNumber!")
    assert "symbol" in users_service._password_rules_error("NoSymbol1")
    assert users_service._password_rules_error("GoodPass1!") is None


def test_jwt_encode_decode(app_module):
    import app.utils.jwt as jwt_utils
    secret = "secret"
    payload = {"sub": "user", "exp": int(time.time()) + 60}
    token = jwt_utils._encode_jwt(payload, secret)
    decoded = jwt_utils._decode_jwt(token, secret)
    assert decoded["sub"] == "user"

    expired = jwt_utils._encode_jwt({"sub": "user", "exp": int(time.time()) - 5}, secret)
    assert jwt_utils._decode_jwt(expired, secret) is None

    assert jwt_utils._peek_jwt_payload(token)["sub"] == "user"
    assert jwt_utils._peek_jwt_payload("bad.token") is None


def test_refresh_token_tracking(app_module):
    app_module._refresh_tokens.clear()
    app_module._store_refresh_token("jti", int(time.time()) + 60, otp_verified=True)
    record = app_module._get_refresh_token_record("jti")
    assert record and record["otp"] is True

    app_module._revoke_refresh_token("jti")
    record = app_module._get_refresh_token_record("jti")
    assert record and record["revoked"] is True

    app_module._store_refresh_token("expired", int(time.time()) - 1, otp_verified=False)
    assert app_module._get_refresh_token_record("expired") is None


def test_admin_ip_allowlist(app_module):
    import ipaddress
    app_module.ADMIN_IP_ALLOWLIST[:] = [ipaddress.ip_network("10.0.0.0/8")]
    assert app_module._admin_ip_allowed("10.10.1.5") is True
    assert app_module._admin_ip_allowed("192.168.1.10") is False
    app_module.ADMIN_IP_ALLOWLIST.clear()
