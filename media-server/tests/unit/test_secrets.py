import json
import os
from unittest.mock import MagicMock, patch
import pytest
import app.services.secrets as secrets

def test_parse_secret_payload_dict():
    payload = {"A": "1", "B": 2}
    res = secrets._parse_secret_payload(payload)
    assert res == {"A": "1", "B": "2"}

def test_parse_secret_payload_json():
    payload = '{"A": "1", "B": 2}'
    res = secrets._parse_secret_payload(payload)
    assert res == {"A": "1", "B": "2"}

def test_apply_secret_values():
    with patch.dict(os.environ, {}, clear=True):
        with patch("app.services.secrets.SECRETS_PREFIX", "TEST_"):
            secrets._apply_secret_values({"TEST_KEY": "val", "OTHER_KEY": "val2"})
            assert os.environ.get("TEST_KEY") == "val"
            assert "OTHER_KEY" not in os.environ

def test_load_secrets_file():
    content = '{"TEST_KEY": "val"}'
    with patch("builtins.open", MagicMock()):
        with patch("app.services.secrets._parse_secret_payload") as mock_parse:
            mock_parse.return_value = {"TEST_KEY": "val"}
            res = secrets._load_secrets_file("dummy.json")
            assert res == {"TEST_KEY": "val"}

def test_load_aws_secrets():
    mock_client = MagicMock()
    mock_client.get_secret_value.return_value = {"SecretString": '{"K": "V"}'}
    with patch("boto3.client", return_value=mock_client):
        res = secrets._load_aws_secrets("secret-id")
        assert res == {"K": "V"}

@patch("requests.get")
def test_load_vault_secrets(mock_get):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"data": {"data": {"K": "V"}}}
    mock_get.return_value = mock_resp
    res = secrets._load_vault_secrets("http://vault", "token", "path", "ns")
    assert res == {"K": "V"}
