from __future__ import annotations

import fcntl
import logging
import os
import sqlite3
import time
from contextlib import contextmanager

from ..utils.validation import is_valid_share_hash

logger = logging.getLogger("droppr.aliases")

ALIASES_DB_PATH = os.environ.get("DROPPR_ALIASES_DB_PATH", "/database/droppr-aliases.sqlite3")
ALIASES_DB_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_ALIASES_DB_TIMEOUT_SECONDS", "30"))

_aliases_db_ready: bool = False

MAX_ALIAS_DEPTH = 10


@contextmanager
def _aliases_conn():
    _ensure_aliases_db()

    conn = sqlite3.connect(
        ALIASES_DB_PATH,
        timeout=ALIASES_DB_TIMEOUT_SECONDS,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
    finally:
        conn.close()


def _init_aliases_db() -> None:
    db_dir = os.path.dirname(ALIASES_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    conn = sqlite3.connect(
        ALIASES_DB_PATH,
        timeout=ALIASES_DB_TIMEOUT_SECONDS,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS share_aliases (
                from_hash TEXT PRIMARY KEY,
                to_hash TEXT NOT NULL,
                path TEXT,
                target_expire INTEGER,
                download_limit INTEGER,
                download_count INTEGER DEFAULT 0,
                allow_download INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_share_aliases_to_hash ON share_aliases(to_hash)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_share_aliases_updated_at ON share_aliases(updated_at)"
        )
    finally:
        conn.close()


def _ensure_aliases_db() -> None:
    global _aliases_db_ready

    if _aliases_db_ready:
        return

    db_dir = os.path.dirname(ALIASES_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    lock_path = f"{ALIASES_DB_PATH}.init.lock"
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        for attempt in range(10):
            try:
                _init_aliases_db()
                _aliases_db_ready = True
                return
            except sqlite3.OperationalError as exc:
                if "locked" in str(exc).lower() and attempt < 9:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                logger.warning("Aliases init failed: %s", exc)
                return
            except Exception as exc:
                logger.warning("Aliases init failed: %s", exc)
                return
    finally:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        finally:
            lock_file.close()


def _resolve_share_hash(share_hash: str) -> str | None:
    if not is_valid_share_hash(share_hash):
        return share_hash

    current = share_hash
    visited = {current}
    try:
        with _aliases_conn() as conn:
            for _ in range(MAX_ALIAS_DEPTH):
                row = conn.execute(
                    "SELECT to_hash, download_limit, download_count, target_expire FROM share_aliases WHERE from_hash = ? LIMIT 1",
                    (current,),
                ).fetchone()
                if row is None:
                    break

                # Check expiration
                expire = row["target_expire"]
                if expire and expire < int(time.time()):
                    return None

                # Check download limit
                limit = row["download_limit"]
                count = row["download_count"] or 0
                if limit is not None and limit > 0 and count >= limit:
                    return None

                nxt = str(row["to_hash"] or "").strip()
                if not is_valid_share_hash(nxt) or nxt in visited:
                    break
                visited.add(nxt)
                current = nxt
    except Exception:
        return share_hash

    return current


def _get_share_alias_meta(share_hash: str) -> dict | None:
    if not is_valid_share_hash(share_hash):
        return None

    with _aliases_conn() as conn:
        row = conn.execute(
            """
            SELECT from_hash, to_hash, path, target_expire, download_limit, download_count, allow_download
            FROM share_aliases
            WHERE from_hash = ?
            LIMIT 1
            """,
            (share_hash,),
        ).fetchone()
        if row:
            return {
                "from_hash": row["from_hash"],
                "to_hash": row["to_hash"],
                "path": row["path"],
                "target_expire": row["target_expire"],
                "download_limit": row["download_limit"],
                "download_count": row["download_count"],
                "allow_download": bool(
                    row["allow_download"] if row["allow_download"] is not None else 1
                ),
            }
    return None


def _upsert_share_alias(
    *,
    from_hash: str,
    to_hash: str,
    path: str | None,
    target_expire: int | None,
    download_limit: int | None = None,
    allow_download: bool = True,
) -> None:
    if not is_valid_share_hash(from_hash) or not is_valid_share_hash(to_hash):
        raise ValueError("Invalid share hash")

    now = int(time.time())
    with _aliases_conn() as conn:
        conn.execute(
            """
            INSERT INTO share_aliases (from_hash, to_hash, path, target_expire, download_limit, allow_download, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(from_hash) DO UPDATE SET
                to_hash = excluded.to_hash,
                path = excluded.path,
                target_expire = excluded.target_expire,
                download_limit = excluded.download_limit,
                allow_download = excluded.allow_download,
                updated_at = excluded.updated_at
            """,
            (
                from_hash,
                to_hash,
                path,
                target_expire,
                download_limit,
                int(allow_download),
                now,
                now,
            ),
        )


def _increment_share_alias_download_count(share_hash: str) -> None:
    if not is_valid_share_hash(share_hash):
        return

    with _aliases_conn() as conn:
        conn.execute(
            "UPDATE share_aliases SET download_count = download_count + 1 WHERE from_hash = ?",
            (share_hash,),
        )


def _list_share_aliases(*, limit: int = 500) -> list[dict]:
    limit = max(1, min(int(limit or 500), 5000))
    with _aliases_conn() as conn:
        rows = conn.execute(
            """
            SELECT from_hash, to_hash, path, target_expire, download_limit, download_count, allow_download, created_at, updated_at
            FROM share_aliases
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    result = []
    for row in rows:
        result.append(
            {
                "from_hash": str(row["from_hash"]),
                "to_hash": str(row["to_hash"]),
                "path": row["path"],
                "target_expire": int(row["target_expire"] or 0) if row["target_expire"] else None,
                "download_limit": (
                    int(row["download_limit"] or 0) if row["download_limit"] else None
                ),
                "download_count": int(row["download_count"] or 0),
                "allow_download": bool(
                    row["allow_download"] if row["allow_download"] is not None else 1
                ),
                "created_at": int(row["created_at"] or 0) if row["created_at"] else None,
                "updated_at": int(row["updated_at"] or 0) if row["updated_at"] else None,
            }
        )

    return result
