from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import os
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError

from ..models import VIDEO_META_DB_PATH, VideoMetaBase, get_video_meta_engine
from ..models.video_meta import VideoMeta

logger = logging.getLogger("droppr.video_meta")

_VIDEO_META_ENGINE = get_video_meta_engine()
VIDEO_META_LOCK_DIR = os.environ.get("DROPPR_VIDEO_META_LOCK_DIR", "/database/video-meta-locks")
VIDEO_META_FFPROBE_TIMEOUT_SECONDS = int(
    os.environ.get("DROPPR_VIDEO_META_FFPROBE_TIMEOUT_SECONDS", "25")
)
VIDEO_META_MAX_CONCURRENCY = int(os.environ.get("DROPPR_VIDEO_META_MAX_CONCURRENCY", "2"))
_video_meta_sema = threading.BoundedSemaphore(max(1, VIDEO_META_MAX_CONCURRENCY))

os.makedirs(VIDEO_META_LOCK_DIR, exist_ok=True)

_video_meta_db_ready: bool = False


class _DriverConnection:
    def __init__(self, conn) -> None:
        self._conn = conn

    def execute(self, sql, params: dict | tuple | list | None = None):
        if isinstance(sql, str):
            return self._conn.exec_driver_sql(sql, params or ())
        return self._conn.execute(sql, params or {})


@contextmanager
def _video_meta_conn():
    """
    Context manager for getting a connection to the video metadata SQLite database.
    """
    _ensure_video_meta_db()

    with _VIDEO_META_ENGINE.begin() as conn:
        yield _DriverConnection(conn)


def _init_video_meta_db() -> None:
    db_dir = os.path.dirname(VIDEO_META_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    VideoMetaBase.metadata.create_all(_VIDEO_META_ENGINE)


def _ensure_video_meta_db() -> None:
    global _video_meta_db_ready

    if _video_meta_db_ready:
        return

    db_dir = os.path.dirname(VIDEO_META_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    lock_path = f"{VIDEO_META_DB_PATH}.init.lock"
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        for attempt in range(10):
            try:
                _init_video_meta_db()
                _video_meta_db_ready = True
                return
            except OperationalError as exc:
                if "locked" in str(exc).lower() and attempt < 9:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                logger.warning("Video meta init failed: %s", exc)
                return
            except Exception as exc:
                logger.warning("Video meta init failed: %s", exc)
                return
    finally:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        finally:
            lock_file.close()


def _sanitize_header_value(value: str) -> str:
    return str(value).replace("\r", " ").replace("\n", " ").strip()


def _parse_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _positive_int(value) -> int | None:
    out = _parse_int(value)
    if out is None or out <= 0:
        return None
    return out


def _positive_float(value) -> float | None:
    out = _parse_float(value)
    if out is None or out <= 0:
        return None
    return out


def _parse_ratio(value: str | None) -> tuple[float, float] | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if ":" in raw:
        parts = raw.split(":", 1)
    elif "/" in raw:
        parts = raw.split("/", 1)
    else:
        return None
    num = _positive_float(parts[0])
    den = _positive_float(parts[1])
    if not num or not den:
        return None
    return num, den


def _parse_fps(value: str | None) -> float | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw or raw == "0/0":
        return None
    if "/" in raw:
        parts = raw.split("/", 1)
        num = _positive_float(parts[0])
        den = _positive_float(parts[1])
        if not num or not den:
            return None
        return num / den
    return _positive_float(raw)


def _parse_iso8601_to_unix(value: str | None) -> int | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp())


def _strip_empty(meta: dict) -> dict:
    return {k: v for k, v in meta.items() if v is not None and v != "" and v != {}}


def _extract_ffprobe_meta(payload: dict) -> dict | None:
    if not payload or not isinstance(payload, dict):
        return None

    streams = payload.get("streams")
    if not isinstance(streams, list):
        streams = []
    fmt = payload.get("format") if isinstance(payload.get("format"), dict) else {}

    video_stream = next(
        (s for s in streams if isinstance(s, dict) and s.get("codec_type") == "video"), None
    )
    audio_stream = next(
        (s for s in streams if isinstance(s, dict) and s.get("codec_type") == "audio"), None
    )

    duration = _positive_float(fmt.get("duration"))
    if duration is None and isinstance(video_stream, dict):
        duration = _positive_float(video_stream.get("duration"))

    size = _positive_int(fmt.get("size"))

    video = None
    if video_stream:
        width = _positive_int(video_stream.get("width"))
        height = _positive_int(video_stream.get("height"))
        display_width = width
        display_height = height

        sar = video_stream.get("sample_aspect_ratio") or video_stream.get("sar")
        sar_ratio = _parse_ratio(sar)
        if sar_ratio and width and height:
            num, den = sar_ratio
            if num and den and num != den:
                display_width = int(round(width * (num / den)))

        rotation = None
        tags = video_stream.get("tags")
        if isinstance(tags, dict):
            rotation_val = _parse_float(tags.get("rotate"))
            if rotation_val is not None:
                rotation = int(round(rotation_val))
        if rotation is None:
            side_data = video_stream.get("side_data_list")
            if isinstance(side_data, list):
                for item in side_data:
                    if not isinstance(item, dict):
                        continue
                    if "rotation" in item:
                        rotation_val = _parse_float(item.get("rotation"))
                        if rotation_val is not None:
                            rotation = int(round(rotation_val))
                        break

        if rotation is not None:
            rotation = rotation % 360
            if rotation in {90, 270}:
                display_width, display_height = display_height, display_width

        fps = _parse_fps(video_stream.get("avg_frame_rate")) or _parse_fps(
            video_stream.get("r_frame_rate")
        )

        video = _strip_empty(
            {
                "codec": video_stream.get("codec_name"),
                "width": width,
                "height": height,
                "display_width": display_width,
                "display_height": display_height,
                "fps": fps,
            }
        )

    audio = None
    if audio_stream:
        audio = _strip_empty(
            {
                "codec": audio_stream.get("codec_name"),
                "channels": _positive_int(audio_stream.get("channels")),
                "sample_rate": _positive_int(audio_stream.get("sample_rate")),
                "channel_layout": audio_stream.get("channel_layout"),
            }
        )

    meta = _strip_empty(
        {
            "duration": duration,
            "size": size,
            "video": video,
            "audio": audio,
        }
    )
    return meta or None


def _ffprobe_video_meta(src_url: str, headers: dict | None = None) -> dict | None:
    """
    Executes ffprobe on a video URL to extract metadata (streams, format, etc.).
    Returns a cleaned metadata dictionary.
    """
    cmd = ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]
    if headers:
        header_lines = []
        for key, value in headers.items():
            if value is None:
                continue
            header_lines.append(f"{_sanitize_header_value(key)}: {_sanitize_header_value(value)}")
        if header_lines:
            cmd += ["-headers", "\r\n".join(header_lines) + "\r\n"]
    cmd += ["-i", src_url]

    with _video_meta_sema:
        result = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=VIDEO_META_FFPROBE_TIMEOUT_SECONDS,
        )

    if result.returncode != 0:
        err = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(err or "ffprobe failed")

    raw = result.stdout.decode(errors="replace")
    data = json.loads(raw) if raw.strip() else {}
    return _extract_ffprobe_meta(data)


def _video_meta_lock_path(db_path: str) -> str:
    digest = hashlib.sha256(db_path.encode()).hexdigest()
    return os.path.join(VIDEO_META_LOCK_DIR, f"{digest}.lock")


def _fetch_video_meta_row(conn, db_path: str):
    return conn.execute(
        """
        SELECT
            path,
            status,
            action,
            error,
            uploaded_at,
            processed_at,
            original_size,
            processed_size,
            original_meta_json,
            processed_meta_json
        FROM video_meta
        WHERE path = ?
        LIMIT 1
        """,
        (db_path,),
    ).fetchone()


def _needs_video_meta_refresh(
    row,
    current_size: int | None,
    current_uploaded_at: int | None,
    force: bool,
) -> bool:
    if force:
        return True
    if not row:
        return True
    if str(row["status"] or "") != "ready":
        return True
    if not row["original_meta_json"] and not row["processed_meta_json"]:
        return True
    if current_size and row["original_size"] and int(row["original_size"]) != int(current_size):
        return True
    if (
        current_uploaded_at
        and row["uploaded_at"]
        and int(row["uploaded_at"]) != int(current_uploaded_at)
    ):
        return True
    return False


def _upsert_video_meta(
    *,
    db_path: str,
    status: str,
    action: str | None,
    error: str | None,
    uploaded_at: int | None,
    processed_at: int | None,
    original_size: int | None,
    processed_size: int | None,
    original_meta: dict | None,
    processed_meta: dict | None,
) -> None:
    original_json = json.dumps(original_meta) if original_meta else None
    processed_json = json.dumps(processed_meta) if processed_meta else None

    with _video_meta_conn() as conn:
        stmt = sqlite_insert(VideoMeta).values(
            path=db_path,
            status=status,
            action=action,
            error=error,
            uploaded_at=uploaded_at,
            processed_at=processed_at,
            original_size=original_size,
            processed_size=processed_size,
            original_meta_json=original_json,
            processed_meta_json=processed_json,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["path"],
            set_={
                "status": stmt.excluded.status,
                "action": stmt.excluded.action,
                "error": stmt.excluded.error,
                "uploaded_at": stmt.excluded.uploaded_at,
                "processed_at": stmt.excluded.processed_at,
                "original_size": stmt.excluded.original_size,
                "processed_size": stmt.excluded.processed_size,
                "original_meta_json": stmt.excluded.original_meta_json,
                "processed_meta_json": stmt.excluded.processed_meta_json,
            },
        )
        conn.execute(stmt)


def _ensure_video_meta_record(
    *,
    db_path: str,
    src_url: str,
    current_size: int | None,
    current_modified: str | None,
    headers: dict | None = None,
    force: bool = False,
):
    """
    Ensures that a video metadata record exists and is up-to-date in the database.
    If the record is missing or stale, it triggers a refresh using ffprobe.
    """
    lock_path = _video_meta_lock_path(db_path)
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        with _video_meta_conn() as conn:
            row = _fetch_video_meta_row(conn, db_path)

        uploaded_at = _parse_iso8601_to_unix(current_modified)
        if not uploaded_at and row and row["uploaded_at"]:
            uploaded_at = int(row["uploaded_at"])
        if not uploaded_at:
            uploaded_at = int(time.time())

        if not _needs_video_meta_refresh(row, current_size, uploaded_at, force):
            return row

        now = int(time.time())
        try:
            meta = _ffprobe_video_meta(src_url, headers=headers)
            if not meta:
                raise RuntimeError("ffprobe returned no metadata")

            original_size = current_size or meta.get("size")
            _upsert_video_meta(
                db_path=db_path,
                status="ready",
                action=None,
                error=None,
                uploaded_at=uploaded_at,
                processed_at=now,
                original_size=original_size,
                processed_size=None,
                original_meta=meta,
                processed_meta=None,
            )
        except Exception as exc:
            err = str(exc).strip()
            if len(err) > 2000:
                err = err[:2000]
            _upsert_video_meta(
                db_path=db_path,
                status="error",
                action=None,
                error=err or "ffprobe failed",
                uploaded_at=uploaded_at,
                processed_at=now,
                original_size=current_size,
                processed_size=None,
                original_meta=None,
                processed_meta=None,
            )

        with _video_meta_conn() as conn:
            return _fetch_video_meta_row(conn, db_path)
