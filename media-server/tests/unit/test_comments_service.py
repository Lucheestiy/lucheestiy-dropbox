from __future__ import annotations

import time
from unittest.mock import MagicMock, patch, ANY

import pytest

import app.services.comments as comments_service


@pytest.fixture
def mock_conn():
    conn = MagicMock()
    with patch("app.services.comments._comments_conn") as mock_ctx:
        mock_ctx.return_value.__enter__.return_value = conn
        yield conn


def test_add_comment(mock_conn):
    mock_row = {
        "id": 1,
        "share_hash": "hash1",
        "file_path": "/test.jpg",
        "author": "Alice",
        "content": "Hello",
        "created_at": 1000,
        "updated_at": 1000,
    }
    mock_conn.execute.return_value.fetchone.return_value = mock_row

    res = comments_service._add_comment(
        share_hash="hash1", file_path="/test.jpg", author="Alice", content="Hello"
    )

    assert res == mock_row
    assert mock_conn.execute.called
    args, _ = mock_conn.execute.call_args
    assert "INSERT INTO comments" in args[0]
    assert args[1] == ("hash1", "/test.jpg", "Alice", "Hello", ANY, ANY)


def test_get_comments(mock_conn):
    mock_rows = [
        {"id": 1, "author": "Alice", "content": "Hi", "created_at": 1000, "updated_at": 1000},
        {"id": 2, "author": "Bob", "content": "Bye", "created_at": 2000, "updated_at": 2000},
    ]
    mock_conn.execute.return_value.fetchall.return_value = mock_rows

    res = comments_service._get_comments(share_hash="hash1", file_path="/test.jpg")

    assert res == mock_rows
    assert mock_conn.execute.called
    args, _ = mock_conn.execute.call_args
    assert "SELECT id, author, content, created_at, updated_at" in args[0]
    assert args[1] == ("hash1", "/test.jpg")


def test_delete_comment(mock_conn):
    res = comments_service._delete_comment(1, "hash1")
    assert res is True
    assert mock_conn.execute.called
    args, _ = mock_conn.execute.call_args
    assert "DELETE FROM comments" in args[0]
    assert args[1] == (1, "hash1")
