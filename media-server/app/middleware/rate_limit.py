from __future__ import annotations

from flask_limiter import Limiter

from ..utils.request import _get_rate_limit_key

limiter = Limiter(key_func=_get_rate_limit_key, default_limits=[])


def init_rate_limiter(app) -> None:
    limiter.init_app(app)
