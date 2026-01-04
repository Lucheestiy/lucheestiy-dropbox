from __future__ import annotations

from flask import Blueprint, Response, jsonify, request

from ..config import parse_bool
from ..services.analytics import (
    ANALYTICS_ENABLED,
    ANALYTICS_IP_MODE,
    ANALYTICS_LOG_FILE_DOWNLOADS,
    ANALYTICS_LOG_GALLERY_VIEWS,
    ANALYTICS_LOG_ZIP_DOWNLOADS,
    ANALYTICS_RETENTION_DAYS,
    _analytics_cache_get,
    _analytics_cache_set,
    _analytics_conn,
    _get_time_range,
)
from ..services.container import get_services
from ..utils.validation import is_valid_share_hash


def create_analytics_blueprint(require_admin_access):
    bp = Blueprint("analytics", __name__)

    @bp.route("/api/analytics/config")
    def analytics_config():
        if not ANALYTICS_ENABLED:
            return jsonify({"error": "Analytics disabled"}), 404

        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None
        if not isinstance(token, str) or not token:
            return jsonify({"error": "Unauthorized"}), 401

        services = get_services()
        try:
            services.filebrowser.fetch_shares(token)
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception as exc:
            return jsonify({"error": f"Failed to validate auth: {exc}"}), 502

        return jsonify(
            {
                "enabled": ANALYTICS_ENABLED,
                "retention_days": ANALYTICS_RETENTION_DAYS,
                "ip_mode": ANALYTICS_IP_MODE,
                "log_gallery_views": ANALYTICS_LOG_GALLERY_VIEWS,
                "log_file_downloads": ANALYTICS_LOG_FILE_DOWNLOADS,
                "log_zip_downloads": ANALYTICS_LOG_ZIP_DOWNLOADS,
            }
        )

    @bp.route("/api/analytics/shares")
    def analytics_shares():
        if not ANALYTICS_ENABLED:
            return jsonify({"error": "Analytics disabled"}), 404

        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None
        if not isinstance(token, str) or not token:
            return jsonify({"error": "Unauthorized"}), 401

        include_empty = parse_bool(
            request.args.get("include_empty") or request.args.get("includeEmpty") or "true"
        )
        include_deleted = parse_bool(
            request.args.get("include_deleted") or request.args.get("includeDeleted") or "true"
        )
        since, until = _get_time_range()
        cache_key = f"analytics_shares:{include_empty}:{include_deleted}:{since}:{until}"
        cached = _analytics_cache_get(cache_key)
        if cached:
            return jsonify(cached)

        services = get_services()
        try:
            filebrowser_shares = services.filebrowser.fetch_shares(token)
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception as exc:
            return jsonify({"error": f"Failed to fetch FileBrowser shares: {exc}"}), 502

        stats_by_hash: dict[str, dict] = {}
        total_unique_ips = 0
        with _analytics_conn() as conn:
            rows = conn.execute(
                """
                SELECT
                    share_hash,
                    SUM(CASE WHEN event_type = 'gallery_view' THEN 1 ELSE 0 END) AS gallery_views,
                    SUM(CASE WHEN event_type = 'file_download' THEN 1 ELSE 0 END) AS file_downloads,
                    SUM(CASE WHEN event_type = 'zip_download' THEN 1 ELSE 0 END) AS zip_downloads,
                    COUNT(DISTINCT CASE WHEN event_type IN ('file_download', 'zip_download') THEN ip END) AS unique_ips,
                    MAX(created_at) AS last_seen,
                    MAX(CASE WHEN event_type IN ('file_download', 'zip_download') THEN created_at ELSE NULL END) AS last_download_at
                FROM download_events
                WHERE created_at >= ? AND created_at <= ?
                GROUP BY share_hash
                """,
                (since, until),
            ).fetchall()

            for row in rows:
                stats_by_hash[str(row["share_hash"])] = {
                    "gallery_views": int(row["gallery_views"] or 0),
                    "file_downloads": int(row["file_downloads"] or 0),
                    "zip_downloads": int(row["zip_downloads"] or 0),
                    "downloads": int((row["file_downloads"] or 0) + (row["zip_downloads"] or 0)),
                    "unique_ips": int(row["unique_ips"] or 0),
                    "last_seen": int(row["last_seen"] or 0) if row["last_seen"] else None,
                    "last_download_at": (
                        int(row["last_download_at"] or 0) if row["last_download_at"] else None
                    ),
                }

            total_unique_ips_row = conn.execute(
                """
                SELECT COUNT(DISTINCT ip) AS unique_ips
                FROM download_events
                WHERE created_at >= ? AND created_at <= ? AND ip IS NOT NULL AND event_type IN ('file_download', 'zip_download')
                """,
                (since, until),
            ).fetchone()
            if total_unique_ips_row is not None:
                total_unique_ips = int(total_unique_ips_row["unique_ips"] or 0)

        shares = []
        seen_hashes: set[str] = set()

        for share in filebrowser_shares:
            share_hash = share.get("hash")
            if not is_valid_share_hash(share_hash):
                continue
            seen_hashes.add(share_hash)
            stats = stats_by_hash.get(share_hash) or {
                "gallery_views": 0,
                "file_downloads": 0,
                "zip_downloads": 0,
                "downloads": 0,
                "unique_ips": 0,
                "last_seen": None,
                "last_download_at": None,
            }

            if not include_empty and stats["gallery_views"] == 0 and stats["downloads"] == 0:
                continue

            shares.append(
                {
                    "hash": share_hash,
                    "path": share.get("path"),
                    "expire": share.get("expire"),
                    "userID": share.get("userID"),
                    "username": share.get("username"),
                    "url": f"/gallery/{share_hash}",
                    **stats,
                }
            )

        if include_deleted:
            for share_hash, stats in stats_by_hash.items():
                if share_hash in seen_hashes:
                    continue
                if not include_empty and stats["gallery_views"] == 0 and stats["downloads"] == 0:
                    continue
                shares.append(
                    {
                        "hash": share_hash,
                        "path": None,
                        "expire": None,
                        "userID": None,
                        "username": None,
                        "url": f"/gallery/{share_hash}",
                        "deleted": True,
                        **stats,
                    }
                )

        shares.sort(
            key=lambda s: (s.get("last_download_at") or 0, s.get("last_seen") or 0), reverse=True
        )

        payload = {
            "range": {"since": since, "until": until},
            "shares": shares,
            "totals": {"unique_ips": total_unique_ips},
        }
        _analytics_cache_set(cache_key, payload)
        return jsonify(payload)

    @bp.route("/api/analytics/shares/<share_hash>")
    def analytics_share_detail(share_hash: str):
        if not ANALYTICS_ENABLED:
            return jsonify({"error": "Analytics disabled"}), 404

        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None
        if not isinstance(token, str) or not token:
            return jsonify({"error": "Unauthorized"}), 401

        since, until = _get_time_range()
        cache_key = f"analytics_share:{share_hash}:{since}:{until}"
        cached = _analytics_cache_get(cache_key)
        if cached:
            return jsonify(cached)

        services = get_services()
        try:
            filebrowser_shares = services.filebrowser.fetch_shares(token)
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception as exc:
            return jsonify({"error": f"Failed to fetch FileBrowser shares: {exc}"}), 502

        share_info = next((s for s in filebrowser_shares if s.get("hash") == share_hash), None)

        counts: dict[str, int] = {}
        with _analytics_conn() as conn:
            for row in conn.execute(
                """
                SELECT event_type, COUNT(*) AS count
                FROM download_events
                WHERE share_hash = ? AND created_at >= ? AND created_at <= ?
                GROUP BY event_type
                """,
                (share_hash, since, until),
            ).fetchall():
                counts[str(row["event_type"])] = int(row["count"] or 0)

            ips = [
                {
                    "ip": row["ip"],
                    "file_downloads": int(row["file_downloads"] or 0),
                    "zip_downloads": int(row["zip_downloads"] or 0),
                    "downloads": int((row["file_downloads"] or 0) + (row["zip_downloads"] or 0)),
                    "last_seen": int(row["last_seen"] or 0) if row["last_seen"] else None,
                }
                for row in conn.execute(
                    """
                    SELECT
                        ip,
                        SUM(CASE WHEN event_type = 'file_download' THEN 1 ELSE 0 END) AS file_downloads,
                        SUM(CASE WHEN event_type = 'zip_download' THEN 1 ELSE 0 END) AS zip_downloads,
                        MAX(created_at) AS last_seen
                    FROM download_events
                    WHERE share_hash = ? AND created_at >= ? AND created_at <= ? AND ip IS NOT NULL AND event_type IN ('file_download', 'zip_download')
                    GROUP BY ip
                    ORDER BY (file_downloads + zip_downloads) DESC, last_seen DESC
                    LIMIT 200
                    """,
                    (share_hash, since, until),
                ).fetchall()
            ]

            events = [
                {
                    "event_type": row["event_type"],
                    "file_path": row["file_path"],
                    "ip": row["ip"],
                    "user_agent": row["user_agent"],
                    "created_at": int(row["created_at"] or 0),
                }
                for row in conn.execute(
                    """
                    SELECT event_type, file_path, ip, user_agent, created_at
                    FROM download_events
                    WHERE share_hash = ? AND created_at >= ? AND created_at <= ?
                    ORDER BY created_at DESC
                    LIMIT 200
                    """,
                    (share_hash, since, until),
                ).fetchall()
            ]

        payload = {
            "range": {"since": since, "until": until},
            "share": {
                "hash": share_hash,
                "path": share_info.get("path") if isinstance(share_info, dict) else None,
                "expire": share_info.get("expire") if isinstance(share_info, dict) else None,
                "userID": share_info.get("userID") if isinstance(share_info, dict) else None,
                "username": share_info.get("username") if isinstance(share_info, dict) else None,
                "url": f"/gallery/{share_hash}",
            },
            "counts": counts,
            "ips": ips,
            "events": events,
        }
        _analytics_cache_set(cache_key, payload)
        return jsonify(payload)

    @bp.route("/api/analytics/shares/<share_hash>/export.csv")
    def analytics_share_export_csv(share_hash: str):
        if not ANALYTICS_ENABLED:
            return "Analytics disabled", 404

        if not is_valid_share_hash(share_hash):
            return "Invalid share hash", 400

        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None
        if not isinstance(token, str) or not token:
            return jsonify({"error": "Unauthorized"}), 401

        services = get_services()
        try:
            services.filebrowser.fetch_shares(token)
        except PermissionError:
            return "Unauthorized", 401
        except Exception as exc:
            return f"Failed to validate auth: {exc}", 502

        since, until = _get_time_range()

        with _analytics_conn() as conn:
            rows = conn.execute(
                """
                SELECT event_type, file_path, ip, user_agent, referer, created_at
                FROM download_events
                WHERE share_hash = ? AND created_at >= ? AND created_at <= ?
                ORDER BY created_at DESC
                """,
                (share_hash, since, until),
            ).fetchall()

        def esc(value):
            if value is None:
                return ""
            value = str(value).replace('"', '""')
            if any(c in value for c in [",", "\n", "\r", '"']):
                return f'"{value}"'
            return value

        lines = ["event_type,file_path,ip,user_agent,referer,created_at"]
        for row in rows:
            lines.append(
                ",".join(
                    [
                        esc(row["event_type"]),
                        esc(row["file_path"]),
                        esc(row["ip"]),
                        esc(row["user_agent"]),
                        esc(row["referer"]),
                        esc(int(row["created_at"] or 0)),
                    ]
                )
            )

        csv_data = "\n".join(lines) + "\n"
        return Response(
            csv_data,
            content_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="droppr-share-{share_hash}-analytics.csv"'
            },
        )

    @bp.route("/api/analytics/audit")
    def analytics_audit():
        if not ANALYTICS_ENABLED:
            return jsonify({"error": "Analytics disabled"}), 404

        error_resp, _auth = require_admin_access()
        if error_resp:
            return error_resp

        since, until = _get_time_range()
        limit = min(max(1, int(request.args.get("limit") or 500)), 5000)

        with _analytics_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, action, target, detail, ip, user_agent, created_at
                FROM audit_events
                WHERE created_at >= ? AND created_at <= ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (since, until, limit),
            ).fetchall()

        events = []
        for row in rows:
            events.append(
                {
                    "id": row["id"],
                    "action": row["action"],
                    "target": row["target"],
                    "detail": row["detail"],
                    "ip": row["ip"],
                    "user_agent": row["user_agent"],
                    "created_at": int(row["created_at"] or 0),
                }
            )

        resp = jsonify({"events": events, "range": {"since": since, "until": until}})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp

    return bp
