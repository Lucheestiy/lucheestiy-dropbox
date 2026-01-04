import sqlite3
import time


def _table_exists(conn, name):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def test_analytics_db_bootstrap(app_module):
    app_module._ensure_analytics_db()
    conn = sqlite3.connect(app_module.ANALYTICS_DB_PATH)
    try:
        assert _table_exists(conn, "download_events")
        assert _table_exists(conn, "auth_events")
    finally:
        conn.close()


def test_aliases_flow(app_module):
    app_module._ensure_aliases_db()
    app_module._upsert_share_alias(from_hash="alpha", to_hash="beta", path="/x", target_expire=None)
    resolved = app_module._resolve_share_hash("alpha")
    assert resolved == "beta"
    aliases = app_module._list_share_aliases(limit=5)
    assert any(item["from_hash"] == "alpha" for item in aliases)


def test_file_request_flow(app_module):
    record = app_module._create_file_request_record(
        path="/uploads",
        password_hash=None,
        expires_at=None,
    )
    fetched = app_module._fetch_file_request(record["hash"])
    assert fetched and fetched["path"] == "/uploads"

    expired = {"expires_at": int(time.time()) - 1}
    assert app_module._request_is_expired(expired) is True
