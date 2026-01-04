from __future__ import annotations

from .legacy import app as _legacy_app
from .legacy import celery_app as _celery_app


def create_app():
    return _legacy_app


app = create_app()
celery_app = _celery_app
