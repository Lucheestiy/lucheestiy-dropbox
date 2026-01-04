from __future__ import annotations

import json
import logging
import os
import re
from datetime import UTC, datetime

from flask import g, has_request_context, request

LOG_FORMAT = (os.environ.get("DROPPR_LOG_FORMAT", "json") or "json").strip().lower()
LOG_LEVEL = (os.environ.get("DROPPR_LOG_LEVEL", "INFO") or "INFO").strip().upper()
REQUEST_ID_HEADER = (
    os.environ.get("DROPPR_REQUEST_ID_HEADER", "X-Request-ID") or "X-Request-ID"
).strip()
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,128}$")


class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if has_request_context():
            setattr(record, "request_id", getattr(g, "request_id", None))
            setattr(
                record,
                "remote_addr",
                request.headers.get("X-Real-IP") or request.remote_addr,
            )
            setattr(record, "method", request.method)
            setattr(record, "path", request.path)
        else:
            setattr(record, "request_id", None)
            setattr(record, "remote_addr", None)
            setattr(record, "method", None)
            setattr(record, "path", None)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        remote_addr = getattr(record, "remote_addr", None)
        if remote_addr:
            payload["remote_addr"] = remote_addr
        method = getattr(record, "method", None)
        if method:
            payload["method"] = method
        path = getattr(record, "path", None)
        if path:
            payload["path"] = path
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def configure_logging(app) -> None:
    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    formatter = (
        JsonFormatter()
        if LOG_FORMAT == "json"
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    for handler in root.handlers:
        handler.setFormatter(formatter)
        handler.addFilter(RequestContextFilter())
    root.setLevel(LOG_LEVEL)
    app.logger.handlers = root.handlers
    app.logger.setLevel(LOG_LEVEL)
    app.logger.propagate = False
