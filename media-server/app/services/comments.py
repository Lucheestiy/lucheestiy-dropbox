from __future__ import annotations

import fcntl
import logging
import os
import sqlite3
import time
from contextlib import contextmanager

from ..models import COMMENTS_DB_PATH, CommentsBase, get_comments_engine

logger = logging.getLogger("droppr.comments")

_COMMENTS_ENGINE = get_comments_engine()
_comments_db_ready: bool = False

class _DriverConnection:
    def __init__(self, conn) -> None:
        self._conn = conn

    def execute(self, sql, params: dict | tuple | list | None = None):
        if isinstance(sql, str):
            return self._conn.exec_driver_sql(sql, params or ()).mappings()
        return self._conn.execute(sql, params or {})

@contextmanager
def _comments_conn():
    _ensure_comments_db()
    with _COMMENTS_ENGINE.begin() as conn:
        yield _DriverConnection(conn)

def _init_comments_db() -> None:
    db_dir = os.path.dirname(COMMENTS_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    CommentsBase.metadata.create_all(_COMMENTS_ENGINE)

def _ensure_comments_db() -> None:
    global _comments_db_ready
    if _comments_db_ready:
        return

    db_dir = os.path.dirname(COMMENTS_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    lock_path = f"{COMMENTS_DB_PATH}.init.lock"
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        for attempt in range(10):
            try:
                _init_comments_db()
                _comments_db_ready = True
                return
            except sqlite3.OperationalError as exc:
                if "locked" in str(exc).lower() and attempt < 9:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                logger.warning("Comments init failed: %s", exc)
                return
            except Exception as exc:
                logger.warning("Comments init failed: %s", exc)
                return
    finally:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        finally:
            lock_file.close()

def _add_comment(*, share_hash: str, file_path: str, author: str, content: str) -> dict:
    now = int(time.time())
    with _comments_conn() as conn:
        result = conn.execute(
            """
            INSERT INTO comments (share_hash, file_path, author, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id, share_hash, file_path, author, content, created_at, updated_at
            """,
            (share_hash, file_path, author, content, now, now)
        ).fetchone()
        return dict(result) if result else {}

def _get_comments(*, share_hash: str, file_path: str) -> list[dict]:
    with _comments_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, author, content, created_at, updated_at
            FROM comments
            WHERE share_hash = ? AND file_path = ?
            ORDER BY created_at ASC
            """,
            (share_hash, file_path)
        ).fetchall()
        return [dict(row) for row in rows]

def _delete_comment(comment_id: int, share_hash: str) -> bool:
    with _comments_conn() as conn:
        result = conn.execute(
            "DELETE FROM comments WHERE id = ? AND share_hash = ?",
            (comment_id, share_hash)
        )
        return result.rowcount > 0
