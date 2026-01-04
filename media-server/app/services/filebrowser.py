from __future__ import annotations

import logging
import os
from urllib.parse import quote

import requests

from ..utils.security import _with_internal_signature
from ..utils.validation import _safe_root_path

logger = logging.getLogger("droppr.filebrowser")

FILEBROWSER_BASE_URL = os.environ.get("DROPPR_FILEBROWSER_BASE_URL", "http://dropbox-app:80")
FILEBROWSER_PUBLIC_DL_API = f"{FILEBROWSER_BASE_URL}/api/public/dl"
FILEBROWSER_PUBLIC_SHARE_API = f"{FILEBROWSER_BASE_URL}/api/public/share"
FILEBROWSER_SHARES_API = f"{FILEBROWSER_BASE_URL}/api/shares"

USER_DEFAULT_PERMS = {
    "admin": False,
    "create": True,
    "delete": True,
    "download": True,
    "modify": True,
    "rename": True,
    "share": True,
    "execute": True,
}


class FileBrowserClient:
    """
    A client for interacting with the FileBrowser API.
    Handles authentication, request signing, and provides methods for
    managing shares, users, and resources.
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        signer=_with_internal_signature,
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = base_url or FILEBROWSER_BASE_URL
        self.public_dl_api = f"{self.base_url}/api/public/dl"
        self.public_share_api = f"{self.base_url}/api/public/share"
        self.shares_api = f"{self.base_url}/api/shares"
        self._signer = signer
        self._session = session or requests.Session()

    def _signed_headers(self, headers: dict, method: str, url: str) -> dict:
        """Adds internal HMAC signatures to the request headers."""
        return self._signer(headers, method, url)

    def create_share(self, *, token: str, path_encoded: str, hours: int) -> dict:
        """Creates a new public share for a given path."""
        body = {"password": "", "expires": "", "unit": "hours"}
        if hours > 0:
            body["expires"] = str(hours)

        url = f"{self.base_url}/api/share{path_encoded}"
        headers = self._signed_headers(
            {"X-Auth": token, "Content-Type": "application/json"},
            "POST",
            url,
        )
        resp = self._session.post(
            url,
            headers=headers,
            json=body,
            timeout=10,
        )
        if resp.status_code in {401, 403}:
            raise PermissionError("Unauthorized")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {}

    def create_user(self, *, token: str, username: str, password: str, scope: str) -> dict:
        """Creates a new FileBrowser user with a specific scope."""
        payload = {
            "what": "user",
            "data": {
                "username": username,
                "password": password,
                "scope": scope,
                "perm": USER_DEFAULT_PERMS,
            },
        }
        url = f"{self.base_url}/api/users"
        headers = self._signed_headers(
            {"X-Auth": token, "Content-Type": "application/json"},
            "POST",
            url,
        )
        resp = self._session.post(
            url,
            headers=headers,
            json=payload,
            timeout=10,
        )
        if resp.status_code in {401, 403}:
            raise PermissionError("Unauthorized")
        if resp.status_code == 409:
            raise FileExistsError("User already exists")
        if resp.status_code >= 400:
            try:
                data = resp.json()
                msg = data.get("error") or data.get("message")
            except Exception:
                msg = None
            raise RuntimeError(msg or f"User API failed ({resp.status_code})")
        try:
            data = resp.json()
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def fetch_shares(self, token: str) -> list[dict]:
        """Fetches all shares managed by the user (currently disabled)."""
        # TEMPORARY FIX: Disable fetching shares to prevent FileBrowser panic (slice bounds out of range)
        # The endpoint GET /api/shares seems to crash the current FileBrowser instance.
        # TODO: Re-enable once FileBrowser is updated or the root cause is fixed.
        logger.warning("Skipping fetch_shares to prevent crash")
        return []

    def fetch_public_share_json(self, share_hash: str, subpath: str | None = None) -> dict | None:
        """Fetches metadata for a public share, optionally for a subpath."""
        if subpath:
            # subpath expected to start with "/"
            subpath = "/" + subpath.lstrip("/")
            url = f"{self.public_share_api}/{share_hash}{quote(subpath, safe='/')}"
        else:
            url = f"{self.public_share_api}/{share_hash}"

        headers = self._signed_headers({}, "GET", url)
        resp = self._session.get(url, headers=headers, timeout=10)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else None

    def fetch_resource(self, path: str, token: str) -> dict | None:
        """Fetches metadata for a private resource."""
        safe_path = _safe_root_path(path)
        if not safe_path:
            return None

        encoded = quote(safe_path.lstrip("/"), safe="/")
        url = f"{self.base_url}/api/resources/{encoded}"
        headers = self._signed_headers({"X-Auth": token}, "GET", url)
        resp = self._session.get(url, headers=headers, timeout=10)
        if resp.status_code == 404:
            return None
        if resp.status_code in {401, 403}:
            raise PermissionError("Unauthorized")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else None


DEFAULT_FILEBROWSER_CLIENT = FileBrowserClient()


def _create_filebrowser_share(
    *, token: str, path_encoded: str, hours: int, client: FileBrowserClient | None = None
) -> dict:
    return (client or DEFAULT_FILEBROWSER_CLIENT).create_share(
        token=token, path_encoded=path_encoded, hours=hours
    )


def _create_filebrowser_user(
    *, token: str, username: str, password: str, scope: str, client: FileBrowserClient | None = None
) -> dict:
    return (client or DEFAULT_FILEBROWSER_CLIENT).create_user(
        token=token, username=username, password=password, scope=scope
    )


def _fetch_filebrowser_shares(token: str, client: FileBrowserClient | None = None) -> list[dict]:
    return (client or DEFAULT_FILEBROWSER_CLIENT).fetch_shares(token)


def _fetch_public_share_json(
    share_hash: str, subpath: str | None = None, client: FileBrowserClient | None = None
) -> dict | None:
    return (client or DEFAULT_FILEBROWSER_CLIENT).fetch_public_share_json(
        share_hash, subpath=subpath
    )


def _fetch_filebrowser_resource(
    path: str, token: str, client: FileBrowserClient | None = None
) -> dict | None:
    return (client or DEFAULT_FILEBROWSER_CLIENT).fetch_resource(path, token)
