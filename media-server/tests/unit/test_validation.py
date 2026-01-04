import io
import types

import pytest


def test_parse_bool(app_module):
    parse_bool = app_module.parse_bool
    assert parse_bool(True) is True
    assert parse_bool(False) is False
    assert parse_bool("true") is True
    assert parse_bool("1") is True
    assert parse_bool(" yes ") is True
    assert parse_bool("no") is False
    assert parse_bool("") is False
    assert parse_bool(None) is False


def test_share_hash_validation(app_module):
    is_valid = app_module.is_valid_share_hash
    assert is_valid("abcXYZ_-123") is True
    assert is_valid("") is False
    assert is_valid("bad!") is False
    assert is_valid("a" * 65) is False


def test_path_normalization_helpers(app_module):
    import app.utils.validation as validation_utils
    assert validation_utils._safe_rel_path("folder/file.txt") == "folder/file.txt"
    assert validation_utils._safe_rel_path("/abs/file") is None
    assert validation_utils._safe_rel_path("..") is None
    assert validation_utils._safe_rel_path("folder\\file") is None

    assert validation_utils._normalize_upload_rel_path("folder//file") == "folder/file"
    assert validation_utils._normalize_upload_rel_path("../file") is None
    assert validation_utils._normalize_upload_rel_path("/abs/file") is None
    assert validation_utils._normalize_upload_rel_path(" ") is None

    assert validation_utils._safe_root_path("users/alice") == "/users/alice"
    assert validation_utils._safe_root_path("//") == "/"
    assert validation_utils._safe_root_path("../etc") is None

    assert validation_utils._encode_share_path("hello world") == "/hello%20world"
    assert validation_utils._encode_share_path("/dir/file") == "/dir/file"


def test_user_and_password_normalization(app_module):
    import app.services.file_requests as requests_service
    import app.services.users as users_service
    
    assert users_service._normalize_username("user_01") == "user_01"
    assert users_service._normalize_username("ab") is None
    assert users_service._normalize_username("bad space") is None

    assert users_service._normalize_password("short") is None
    assert users_service._normalize_password("longenough") == "longenough"

    assert requests_service._normalize_request_password("secret") == "secret"
    too_long = "x" * (requests_service.REQUEST_PASSWORD_MAX_LEN + 1)
    assert requests_service._normalize_request_password(too_long) is None


def test_scope_and_join_helpers(app_module, tmp_path):
    import app.services.users as users_service
    import app.utils.validation as validation_utils
    
    assert users_service._build_user_scope("alice").endswith("/alice")

    base = tmp_path / "base"
    base.mkdir()
    safe = validation_utils._safe_join(str(base), "child", "file.txt")
    assert safe == str(base / "child" / "file.txt")
    assert validation_utils._safe_join(str(base), "..", "escape") is None


def test_ip_and_mime_helpers(app_module):
    import app.utils.validation as validation_utils
    assert validation_utils._normalize_ip("192.168.0.1") == "192.168.0.1"
    assert validation_utils._normalize_ip("192.168.0.1:443") == "192.168.0.1"
    assert validation_utils._normalize_ip("[2001:db8::1]") == "2001:db8::1"
    assert validation_utils._normalize_ip("bad-ip") is None

    assert validation_utils._extract_extension("/tmp/photo.JPG") == "jpg"
    assert validation_utils._extract_extension("noext") is None
    assert validation_utils._normalize_mime_type("text/html; charset=utf-8") == "text/html"

    assert validation_utils._sniff_mime_type(b"\xff\xd8\xffabc") == "image/jpeg"
    assert validation_utils._sniff_mime_type(b"\x89PNG\r\n\x1a\n") == "image/png"
    assert validation_utils._sniff_mime_type(b"") is None


def test_upload_type_validation(app_module):
    import app.utils.validation as validation_utils
    class FakeStorage:
        def __init__(self, mimetype, payload):
            self.mimetype = mimetype
            self.stream = io.BytesIO(payload)

    file_storage = FakeStorage("image/jpeg", b"\xff\xd8\xff")
    validation_utils._validate_upload_type(file_storage, "photo.jpg")

    bad_storage = FakeStorage("text/plain", b"hello")
    with pytest.raises(validation_utils.UploadValidationError):
        validation_utils._validate_upload_type(bad_storage, "note.jpg")


def test_copy_stream_with_limit(app_module):
    import app.utils.validation as validation_utils
    src = io.BytesIO(b"a" * 4)
    dst = io.BytesIO()
    assert validation_utils._copy_stream_with_limit(src, dst, 10) == 4

    src = io.BytesIO(b"a" * 4)
    dst = io.BytesIO()
    with pytest.raises(validation_utils.UploadValidationError):
        validation_utils._copy_stream_with_limit(src, dst, 2)
