import pytest
import io
from unittest.mock import MagicMock, patch
import app.utils.validation as val

def test_safe_rel_path():
    assert val._safe_rel_path("test.jpg") == "test.jpg"
    assert val._safe_rel_path("folder/test.jpg") == "folder/test.jpg"
    assert val._safe_rel_path("/absolute") is None
    assert val._safe_rel_path("../outside") is None
    assert val._safe_rel_path("folder/../outside") is None
    assert val._safe_rel_path(r"path\with\backslash") is None

def test_is_valid_share_hash():
    assert val.is_valid_share_hash("valid-hash_123") is True
    assert val.is_valid_share_hash("invalid hash") is False
    assert val.is_valid_share_hash("a" * 65) is False

def test_normalize_upload_rel_path():
    assert val._normalize_upload_rel_path("test.jpg") == "test.jpg"
    assert val._normalize_upload_rel_path("  test.jpg  ") == "test.jpg"
    assert val._normalize_upload_rel_path("path/./to/file.jpg") == "path/to/file.jpg"
    assert val._normalize_upload_rel_path("/absolute") is None
    assert val._normalize_upload_rel_path("path/../outside") is None
    assert val._normalize_upload_rel_path("path/with/\x00/char") is None

def test_safe_root_path():
    assert val._safe_root_path("uploads") == "/uploads"
    assert val._safe_root_path("/uploads/") == "/uploads"
    assert val._safe_root_path("///multiple///slashes") == "/multiple/slashes"
    assert val._safe_root_path("/path/../outside") is None

def test_encode_share_path():
    assert val._encode_share_path("/path with space") == "/path%20with%20space"
    assert val._encode_share_path("folder/file.jpg") == "/folder/file.jpg"

def test_normalize_ip():
    assert val._normalize_ip("1.2.3.4") == "1.2.3.4"
    assert val._normalize_ip("1.2.3.4, 5.6.7.8") == "1.2.3.4"
    assert val._normalize_ip("[2001:db8::1]:80") == "2001:db8::1"
    assert val._normalize_ip("1.2.3.4:8080") == "1.2.3.4"
    assert val._normalize_ip("invalid") is None

def test_sniff_mime_type():
    assert val._sniff_mime_type(b"\xff\xd8\xff") == "image/jpeg"
    assert val._sniff_mime_type(b"\x89PNG\r\n\x1a\n") == "image/png"
    assert val._sniff_mime_type(b"GIF89a") == "image/gif"
    # MP4 ftyp
    assert val._sniff_mime_type(b"0000ftypmp42") == "video/mp4"
    assert val._sniff_mime_type(b"0000ftypavif") == "image/avif"

def test_parse_content_range():
    assert val._parse_content_range("bytes 0-99/200") == (0, 99, 200)
    assert val._parse_content_range("invalid") is None
    assert val._parse_content_range("bytes 100-50/200") is None # end < start
    assert val._parse_content_range("bytes 0-200/200") is None # end >= total

def test_normalize_chunk_upload_id():
    assert val._normalize_chunk_upload_id("valid_id-123") == "valid_id-123"
    assert val._normalize_chunk_upload_id("short") is None
    assert val._normalize_chunk_upload_id("id with spaces") is None

def test_peek_stream():
    stream = io.BytesIO(b"hello world")
    assert val._peek_stream(stream, 5) == b"hello"
    assert stream.tell() == 0

def test_validate_upload_size(monkeypatch):
    monkeypatch.setattr(val, "UPLOAD_MAX_BYTES", 100)
    mock_file = MagicMock()
    mock_file.content_length = 50
    val._validate_upload_size(mock_file)
    
    mock_file.content_length = 150
    with pytest.raises(val.UploadValidationError, match="File exceeds"):
        val._validate_upload_size(mock_file)

def test_copy_stream_with_limit():
    src = io.BytesIO(b"a" * 100)
    dst = io.BytesIO()
    val._copy_stream_with_limit(src, dst, 100)
    assert len(dst.getvalue()) == 100
    
    src = io.BytesIO(b"a" * 101)
    dst = io.BytesIO()
    with pytest.raises(val.UploadValidationError, match="File exceeds"):
        val._copy_stream_with_limit(src, dst, 100)

def test_validate_upload_type(monkeypatch):
    monkeypatch.setattr(val, "UPLOAD_ALLOW_ALL_EXTS", False)
    monkeypatch.setattr(val, "UPLOAD_ALLOWED_EXTS", {"jpg"})
    monkeypatch.setattr(val, "EXTENSION_MIME_TYPES", {"jpg": {"image/jpeg"}})
    
    mock_file = MagicMock()
    mock_file.mimetype = "image/jpeg"
    mock_file.stream = io.BytesIO(b"\xff\xd8\xff")
    
    val._validate_upload_type(mock_file, "test.jpg")
    
    with pytest.raises(val.UploadValidationError, match="Unsupported file type"):
        val._validate_upload_type(mock_file, "test.png")

def test_chunk_upload_paths():
    meta, part = val._chunk_upload_paths("/base", "uid123")
    assert "/base/.droppr_uploads/uid123.json" in meta
    assert "/base/.droppr_uploads/uid123.part" in part

def test_load_save_chunk_meta(tmp_path):
    base_dir = str(tmp_path)
    upload_id = "test_upload"
    payload = {"offset": 100, "total": 1000}
    
    val._save_chunk_upload_meta(base_dir, upload_id, payload)
    loaded = val._load_chunk_upload_meta(base_dir, upload_id)
    assert loaded == payload

    assert val._load_chunk_upload_meta(base_dir, "nonexistent") is None
