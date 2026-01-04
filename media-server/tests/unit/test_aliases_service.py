from __future__ import annotations

import os
import sqlite3
import tempfile
import time
from unittest.mock import patch
import pytest

from app.services.aliases import (
    _resolve_share_hash,
    _get_share_alias_meta,
    _upsert_share_alias,
    _increment_share_alias_download_count,
    _list_share_aliases,
    _ensure_aliases_db,
    _init_aliases_db,
    MAX_ALIAS_DEPTH,
)


@pytest.fixture
def temp_db():
    """Create a temporary database for testing"""
    fd, path = tempfile.mkstemp(suffix=".sqlite3")
    os.close(fd)

    with patch("app.services.aliases.ALIASES_DB_PATH", path):
        _init_aliases_db()
        yield path

    try:
        os.unlink(path)
    except:
        pass


def test_init_aliases_db(temp_db):
    """Test database initialization creates tables and indexes"""
    conn = sqlite3.connect(temp_db)
    cursor = conn.cursor()

    # Check table exists
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='share_aliases'"
    )
    assert cursor.fetchone() is not None

    # Check indexes exist
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_share_aliases_to_hash'"
    )
    assert cursor.fetchone() is not None

    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_share_aliases_updated_at'"
    )
    assert cursor.fetchone() is not None

    conn.close()


def test_upsert_share_alias_insert(temp_db):
    """Test inserting a new share alias"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="abc123",
            to_hash="def456",
            path="/test/file.txt",
            target_expire=int(time.time()) + 3600,
            download_limit=10,
            allow_download=True,
        )

        meta = _get_share_alias_meta("abc123")
        assert meta is not None
        assert meta["from_hash"] == "abc123"
        assert meta["to_hash"] == "def456"
        assert meta["path"] == "/test/file.txt"
        assert meta["download_limit"] == 10
        assert meta["download_count"] == 0
        assert meta["allow_download"] is True


def test_upsert_share_alias_update(temp_db):
    """Test updating an existing share alias"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        # Insert initial alias
        _upsert_share_alias(
            from_hash="abc123",
            to_hash="def456",
            path="/old/path.txt",
            target_expire=None,
            download_limit=5,
        )

        # Update the alias
        _upsert_share_alias(
            from_hash="abc123",
            to_hash="ghi789",
            path="/new/path.txt",
            target_expire=None,
            download_limit=15,
            allow_download=False,
        )

        meta = _get_share_alias_meta("abc123")
        assert meta is not None
        assert meta["to_hash"] == "ghi789"
        assert meta["path"] == "/new/path.txt"
        assert meta["download_limit"] == 15
        assert meta["allow_download"] is False


def test_upsert_share_alias_invalid_hash(temp_db):
    """Test that invalid hashes are rejected"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        with pytest.raises(ValueError, match="Invalid share hash"):
            _upsert_share_alias(
                from_hash="invalid!@#",
                to_hash="def456",
                path=None,
                target_expire=None,
            )


def test_resolve_share_hash_direct(temp_db):
    """Test resolving a hash with no alias"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        result = _resolve_share_hash("abc123")
        assert result == "abc123"


def test_resolve_share_hash_single_alias(temp_db):
    """Test resolving a hash with one alias"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="target1",
            path=None,
            target_expire=None,
        )

        result = _resolve_share_hash("alias1")
        assert result == "target1"


def test_resolve_share_hash_chain(temp_db):
    """Test resolving a chain of aliases"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="alias2",
            path=None,
            target_expire=None,
        )
        _upsert_share_alias(
            from_hash="alias2",
            to_hash="target1",
            path=None,
            target_expire=None,
        )

        result = _resolve_share_hash("alias1")
        assert result == "target1"


def test_resolve_share_hash_expired(temp_db):
    """Test that expired aliases return None"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="target1",
            path=None,
            target_expire=int(time.time()) - 3600,  # Expired 1 hour ago
        )

        result = _resolve_share_hash("alias1")
        assert result is None


def test_resolve_share_hash_download_limit_reached(temp_db):
    """Test that aliases with reached download limits return None"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="target1",
            path=None,
            target_expire=None,
            download_limit=3,
        )

        # Increment count to limit
        _increment_share_alias_download_count("alias1")
        _increment_share_alias_download_count("alias1")
        _increment_share_alias_download_count("alias1")

        result = _resolve_share_hash("alias1")
        assert result is None


def test_resolve_share_hash_circular_reference(temp_db):
    """Test that circular alias chains don't cause infinite loops"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="alias2",
            path=None,
            target_expire=None,
        )
        _upsert_share_alias(
            from_hash="alias2",
            to_hash="alias1",
            path=None,
            target_expire=None,
        )

        # Should stop after detecting the cycle
        result = _resolve_share_hash("alias1")
        assert result in ["alias1", "alias2"]


def test_resolve_share_hash_max_depth(temp_db):
    """Test that alias resolution stops at MAX_ALIAS_DEPTH"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        # Create a chain longer than MAX_ALIAS_DEPTH
        for i in range(MAX_ALIAS_DEPTH + 5):
            _upsert_share_alias(
                from_hash=f"alias{i}",
                to_hash=f"alias{i+1}",
                path=None,
                target_expire=None,
            )

        result = _resolve_share_hash("alias0")
        # Should resolve up to MAX_ALIAS_DEPTH
        assert result == f"alias{MAX_ALIAS_DEPTH}"


def test_increment_download_count(temp_db):
    """Test incrementing download count"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="target1",
            path=None,
            target_expire=None,
        )

        _increment_share_alias_download_count("alias1")
        meta = _get_share_alias_meta("alias1")
        assert meta["download_count"] == 1

        _increment_share_alias_download_count("alias1")
        meta = _get_share_alias_meta("alias1")
        assert meta["download_count"] == 2


def test_list_share_aliases(temp_db):
    """Test listing all share aliases"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        _upsert_share_alias(
            from_hash="alias1",
            to_hash="target1",
            path="/file1.txt",
            target_expire=None,
        )
        time.sleep(0.01)  # Ensure different timestamps
        _upsert_share_alias(
            from_hash="alias2",
            to_hash="target2",
            path="/file2.txt",
            target_expire=None,
        )

        aliases = _list_share_aliases(limit=10)
        assert len(aliases) == 2

        # Should be sorted by updated_at DESC
        assert aliases[0]["from_hash"] == "alias2"
        assert aliases[1]["from_hash"] == "alias1"


def test_list_share_aliases_respects_limit(temp_db):
    """Test that list_share_aliases respects the limit parameter"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        # Create 10 aliases
        for i in range(10):
            _upsert_share_alias(
                from_hash=f"alias{i}",
                to_hash=f"target{i}",
                path=None,
                target_expire=None,
            )
            time.sleep(0.001)

        aliases = _list_share_aliases(limit=5)
        assert len(aliases) == 5


def test_get_share_alias_meta_not_found(temp_db):
    """Test getting metadata for non-existent alias"""
    with patch("app.services.aliases.ALIASES_DB_PATH", temp_db):
        meta = _get_share_alias_meta("nonexistent")
        assert meta is None


def test_ensure_aliases_db_creates_directory():
    """Test that ensure_aliases_db creates parent directories"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "subdir", "test.db")

        with patch("app.services.aliases.ALIASES_DB_PATH", db_path):
            with patch("app.services.aliases._aliases_db_ready", False):
                _ensure_aliases_db()
                assert os.path.exists(os.path.dirname(db_path))
