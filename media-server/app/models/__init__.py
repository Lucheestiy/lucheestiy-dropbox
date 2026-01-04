from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base

ANALYTICS_DB_PATH = os.environ.get("DROPPR_ANALYTICS_DB_PATH", "/database/droppr-analytics.sqlite3")
ANALYTICS_DB_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_ANALYTICS_DB_TIMEOUT_SECONDS", "30"))
ANALYTICS_POOL_SIZE = int(os.environ.get("DROPPR_ANALYTICS_POOL_SIZE", "4"))

VIDEO_META_DB_PATH = os.environ.get("DROPPR_VIDEO_META_DB_PATH", "/database/droppr-video-meta.sqlite3")
VIDEO_META_DB_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_VIDEO_META_DB_TIMEOUT_SECONDS", "30"))

AnalyticsBase = declarative_base()
VideoMetaBase = declarative_base()


def _sqlite_engine(db_path: str, timeout: float, pool_size: int | None = None):
    url = f"sqlite:///{db_path}"
    options: dict = {
        "connect_args": {"check_same_thread": False, "timeout": timeout},
        "pool_pre_ping": True,
    }
    if pool_size is not None:
        options["pool_size"] = max(1, pool_size)
        options["max_overflow"] = 0

    engine = create_engine(url, **options)

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()

    return engine


@lru_cache(maxsize=1)
def get_analytics_engine():
    return _sqlite_engine(ANALYTICS_DB_PATH, ANALYTICS_DB_TIMEOUT_SECONDS, ANALYTICS_POOL_SIZE)


@lru_cache(maxsize=1)
def get_video_meta_engine():
    return _sqlite_engine(VIDEO_META_DB_PATH, VIDEO_META_DB_TIMEOUT_SECONDS, None)
