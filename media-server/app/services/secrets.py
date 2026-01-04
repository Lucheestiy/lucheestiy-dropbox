from __future__ import annotations

import base64
import json
import logging
import os

import boto3
import requests
from botocore.config import Config as BotoConfig

from ..config import parse_bool

SECRETS_PREFIX = (os.environ.get("DROPPR_SECRETS_PREFIX") or "DROPPR_").strip() or "DROPPR_"
SECRETS_OVERRIDE = parse_bool(os.environ.get("DROPPR_SECRETS_OVERRIDE", "false"))
SECRETS_REQUIRED = parse_bool(os.environ.get("DROPPR_SECRETS_REQUIRED", "false"))
SECRETS_FILE = (os.environ.get("DROPPR_SECRETS_FILE") or "").strip()
AWS_SECRETS_ID = (os.environ.get("DROPPR_AWS_SECRETS_MANAGER_SECRET_ID") or "").strip()
AWS_REGION = (os.environ.get("DROPPR_AWS_REGION") or os.environ.get("AWS_REGION") or "").strip()
VAULT_ADDR = (os.environ.get("DROPPR_VAULT_ADDR") or os.environ.get("VAULT_ADDR") or "").strip()
VAULT_TOKEN = (os.environ.get("DROPPR_VAULT_TOKEN") or os.environ.get("VAULT_TOKEN") or "").strip()
VAULT_NAMESPACE = (
    os.environ.get("DROPPR_VAULT_NAMESPACE") or os.environ.get("VAULT_NAMESPACE") or ""
).strip()
VAULT_SECRET_PATH = (os.environ.get("DROPPR_VAULT_SECRET_PATH") or "").strip().lstrip("/")

logger = logging.getLogger("droppr.secrets")


def _parse_secret_payload(payload: object) -> dict[str, str]:
    if payload is None:
        return {}
    if isinstance(payload, dict):
        return {str(k): str(v) for k, v in payload.items()}
    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            return {}
        if isinstance(decoded, dict):
            return {str(k): str(v) for k, v in decoded.items()}
    return {}


def _apply_secret_values(values: dict[str, str]) -> None:
    for key, value in values.items():
        if SECRETS_PREFIX and not str(key).startswith(SECRETS_PREFIX):
            continue
        if not SECRETS_OVERRIDE and os.environ.get(key):
            continue
        os.environ[str(key)] = str(value)


def _load_secrets_file(path: str) -> dict[str, str]:
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
    except OSError:
        return {}
    return _parse_secret_payload(raw)


def _load_aws_secrets(secret_id: str) -> dict[str, str]:
    if not secret_id:
        return {}
    region = AWS_REGION or None
    client = boto3.client(
        "secretsmanager",
        region_name=region,
        config=BotoConfig(retries={"max_attempts": 3, "mode": "standard"}),
    )
    resp = client.get_secret_value(SecretId=secret_id)
    payload = resp.get("SecretString")
    if not payload and resp.get("SecretBinary") is not None:
        payload = base64.b64decode(resp["SecretBinary"]).decode("utf-8", errors="replace")
    return _parse_secret_payload(payload)


def _load_vault_secrets(addr: str, token: str, path: str, namespace: str | None) -> dict[str, str]:
    if not (addr and token and path):
        return {}
    url = f"{addr.rstrip('/')}/v1/{path}"
    headers = {"X-Vault-Token": token}
    if namespace:
        headers["X-Vault-Namespace"] = namespace
    resp = requests.get(url, headers=headers, timeout=5)
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data")
    if isinstance(data, dict) and "data" in data and isinstance(data.get("data"), dict):
        data = data["data"]
    return _parse_secret_payload(data)


def _load_external_secrets() -> None:
    loaded = False
    try:
        file_values = _load_secrets_file(SECRETS_FILE)
        if file_values:
            _apply_secret_values(file_values)
            loaded = True
    except Exception as exc:
        logger.warning("Secrets file load failed: %s", exc)
        if SECRETS_REQUIRED:
            raise

    try:
        aws_values = _load_aws_secrets(AWS_SECRETS_ID)
        if aws_values:
            _apply_secret_values(aws_values)
            loaded = True
    except Exception as exc:
        logger.warning("AWS secrets load failed: %s", exc)
        if SECRETS_REQUIRED:
            raise

    try:
        vault_values = _load_vault_secrets(
            VAULT_ADDR, VAULT_TOKEN, VAULT_SECRET_PATH, VAULT_NAMESPACE or None
        )
        if vault_values:
            _apply_secret_values(vault_values)
            loaded = True
    except Exception as exc:
        logger.warning("Vault secrets load failed: %s", exc)
        if SECRETS_REQUIRED:
            raise

    if SECRETS_REQUIRED and not loaded and (SECRETS_FILE or AWS_SECRETS_ID or VAULT_SECRET_PATH):
        raise RuntimeError("Failed to load required secrets")
