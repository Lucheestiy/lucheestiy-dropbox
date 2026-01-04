from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.comments import create_comments_blueprint


@pytest.fixture
def mock_deps():
    return {
        "resolve_share_hash": MagicMock(side_effect=lambda h: h),
    }


@pytest.fixture
def app(mock_deps):
    app = Flask(__name__)
    bp = create_comments_blueprint(mock_deps)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_get_comments_success(client):
    mock_comments = [
        {"id": 1, "author": "Alice", "content": "Hi", "created_at": 1000},
    ]
    with patch("app.routes.comments._get_comments", return_value=mock_comments) as mock_get:
        resp = client.get("/api/share/hash1/comments?path=test.jpg")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["comments"] == mock_comments
        mock_get.assert_called_once_with(share_hash="hash1", file_path="test.jpg")


def test_get_comments_root(client):
    with patch("app.routes.comments._get_comments", return_value=[]) as mock_get:
        resp = client.get("/api/share/hash1/comments")
        assert resp.status_code == 200
        mock_get.assert_called_once_with(share_hash="hash1", file_path="/")


def test_get_comments_invalid_hash(client):
    resp = client.get("/api/share/invalid_hash_too_long_!!!!!!!!!!!!!!!!/comments")
    assert resp.status_code == 400
    assert "Invalid share hash" in resp.get_json()["error"]


def test_get_comments_invalid_path(client):
    resp = client.get("/api/share/hash1/comments?path=../secret")
    assert resp.status_code == 400
    assert "Invalid file path" in resp.get_json()["error"]


def test_post_comment_success(client):
    mock_comment = {"id": 1, "author": "Alice", "content": "Hello"}
    with patch("app.routes.comments._add_comment", return_value=mock_comment) as mock_add:
        with patch("app.routes.comments._log_audit_event") as mock_log:
            resp = client.post(
                "/api/share/hash1/comments",
                json={"path": "test.jpg", "author": "Alice", "content": "Hello"},
            )
            assert resp.status_code == 201
            assert resp.get_json() == mock_comment
            mock_add.assert_called_once_with(
                share_hash="hash1", file_path="test.jpg", author="Alice", content="Hello"
            )
            mock_log.assert_called_once()


def test_post_comment_no_content(client):
    resp = client.post("/api/share/hash1/comments", json={"content": ""})
    assert resp.status_code == 400
    assert "Comment content is required" in resp.get_json()["error"]


def test_post_comment_too_long(client):
    resp = client.post("/api/share/hash1/comments", json={"content": "a" * 2001})
    assert resp.status_code == 400
    assert "Comment too long" in resp.get_json()["error"]


def test_post_comment_error(client):
    with patch("app.routes.comments._add_comment", side_effect=Exception("DB Error")):
        resp = client.post("/api/share/hash1/comments", json={"content": "Hello"})
        assert resp.status_code == 500
        assert "Internal server error" in resp.get_json()["error"]
