from __future__ import annotations

import os
import pytest
from unittest.mock import patch, MagicMock

import app.services.users as users_service

def test_normalize_username():
    assert users_service._normalize_username("validUser") == "validUser"
    assert users_service._normalize_username("valid-user") == "valid-user"
    assert users_service._normalize_username("valid_user") == "valid_user"
    assert users_service._normalize_username("123user") == "123user"
    assert users_service._normalize_username("usr") == "usr"
    
    assert users_service._normalize_username("sh") is None  # Too short (regex says {2,31} but actually starting with [A-Za-z0-9] then {2,31} more? No, wait)
    # USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$")
    # This means 1 char + (2 to 31 chars) = 3 to 32 chars total.
    assert users_service._normalize_username("us") is None 
    assert users_service._normalize_username("a" * 33) is None
    assert users_service._normalize_username("invalid user") is None
    assert users_service._normalize_username("invalid!user") is None
    assert users_service._normalize_username("-invalid") is None
    assert users_service._normalize_username(None) is None
    assert users_service._normalize_username("") is None

def test_normalize_password():
    # USER_PASSWORD_MIN_LEN defaults to 8 in conftest or 8 by default
    assert users_service._normalize_password("password123") == "password123"
    assert users_service._normalize_password("short") is None
    assert users_service._normalize_password(None) is None

def test_password_rules_error_defaults():
    # Based on conftest.py env vars and defaults
    # USER_PASSWORD_REQUIRE_UPPER = true
    # USER_PASSWORD_REQUIRE_LOWER = true
    # USER_PASSWORD_REQUIRE_DIGIT = true
    # USER_PASSWORD_REQUIRE_SYMBOL = true
    
    assert users_service._password_rules_error(None) == "Missing password"
    assert users_service._password_rules_error("short") == "Password must be at least 8 characters"
    assert users_service._password_rules_error("lowercaseonly123!") == "Password must include an uppercase letter"
    assert users_service._password_rules_error("UPPERCASEONLY123!") == "Password must include a lowercase letter"
    assert users_service._password_rules_error("NoDigitOrSymbol!abc") == "Password must include a number"
    assert users_service._password_rules_error("NoSymbol123abc") == "Password must include a symbol"
    assert users_service._password_rules_error("Valid123!") is None

@patch("app.services.users.requests.get")
def test_password_is_pwned(mock_get):
    # Enable pwned check for this test
    with patch("app.services.users.USER_PASSWORD_PWNED_CHECK", True):
        # Mocking Pwned Passwords API response
        # password "password123" SHA1: CBFDAC6008F9CAB4083784CBD1874F76618D2A97
        # Prefix: CBFDA
        # Suffix: C6008F9CAB4083784CBD1874F76618D2A97
        
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "C6008F9CAB4083784CBD1874F76618D2A97:10\nOTHER:1"
        mock_get.return_value = mock_resp
        
        assert users_service._password_is_pwned("password123") is True
        
        mock_resp.text = "DIFFERENT:10"
        assert users_service._password_is_pwned("password123") is False
        
        mock_resp.status_code = 404
        assert users_service._password_is_pwned("password123") is False

def test_password_rules_error_pwned():
    with patch("app.services.users.USER_PASSWORD_PWNED_CHECK", True):
        with patch("app.services.users._password_is_pwned", return_value=True):
            assert users_service._password_rules_error("Valid123!") == "Password appears in a breach. Choose another."

def test_build_user_scope():
    with patch("app.services.users.USER_SCOPE_ROOT", "/users"):
        assert users_service._build_user_scope("bob") == "/users/bob"
    with patch("app.services.users.USER_SCOPE_ROOT", "/"):
        assert users_service._build_user_scope("bob") == "/bob"

def test_ensure_user_directory(tmp_path):
    user_data_dir = tmp_path / "srv"
    with patch("app.services.users.USER_DATA_DIR", str(user_data_dir)):
        scope = "/users/alice"
        target = users_service._ensure_user_directory(scope)
        assert os.path.isdir(target)
        assert target.endswith("srv/users/alice")
        
        # Test existing directory
        target2 = users_service._ensure_user_directory(scope)
        assert target == target2
        
        # Test failure (e.g. file exists where directory should be)
        file_path = user_data_dir / "users" / "bob"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.touch()
        with pytest.raises(RuntimeError, match="User directory is not a directory"):
            users_service._ensure_user_directory("/users/bob")
