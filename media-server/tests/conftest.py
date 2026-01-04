import os
import sys
import tempfile

BASE_DIR = tempfile.mkdtemp(prefix="droppr-tests-")
DATA_DIR = os.path.join(BASE_DIR, "data")
LOCK_DIR = os.path.join(BASE_DIR, "video-locks")

os.environ.setdefault("DROPPR_ANALYTICS_DB_PATH", os.path.join(BASE_DIR, "analytics.sqlite3"))
os.environ.setdefault("DROPPR_ALIASES_DB_PATH", os.path.join(BASE_DIR, "aliases.sqlite3"))
os.environ.setdefault("DROPPR_REQUESTS_DB_PATH", os.path.join(BASE_DIR, "requests.sqlite3"))
os.environ.setdefault("DROPPR_VIDEO_META_DB_PATH", os.path.join(BASE_DIR, "video-meta.sqlite3"))
os.environ.setdefault("DROPPR_VIDEO_META_LOCK_DIR", LOCK_DIR)
os.environ.setdefault("DROPPR_ANALYTICS_ENABLED", "true")
os.environ.setdefault("DROPPR_ANALYTICS_IP_MODE", "full")
os.environ.setdefault("DROPPR_SHARE_CACHE_WARM_ENABLED", "false")
os.environ.setdefault("DROPPR_REDIS_URL", "")
os.environ.setdefault("DROPPR_CAPTCHA_SITE_KEY", "")
os.environ.setdefault("DROPPR_CAPTCHA_SECRET_KEY", "")
os.environ.setdefault("DROPPR_PASSWORD_PWNED_CHECK", "false")
os.environ.setdefault("DROPPR_AUTH_SECRET", "test-secret")
os.environ.setdefault("DROPPR_USER_DATA_DIR", DATA_DIR)
os.environ.setdefault("DROPPR_USER_ROOT", "/users")
os.environ.setdefault("DROPPR_LOG_FORMAT", "plain")
os.environ.setdefault("DROPPR_METRICS_ENABLED", "false")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import importlib
import pytest


@pytest.fixture(scope="session")
def app_module():
    return importlib.import_module("app")


@pytest.fixture()
def client(app_module):
    app = app_module.app
    app.config.update(TESTING=True)
    return app.test_client()
