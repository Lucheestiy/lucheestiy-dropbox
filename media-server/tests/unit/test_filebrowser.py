from __future__ import annotations

import pytest
import requests
import requests_mock
from unittest.mock import MagicMock

from app.services.filebrowser import FileBrowserClient

def test_filebrowser_create_share():
    client = FileBrowserClient(base_url="http://test", signer=lambda h, m, u: h)
    
    with requests_mock.Mocker() as m:
        m.post("http://test/api/share/path/to/file", json={"hash": "new-hash"}, status_code=200)
        
        res = client.create_share(token="tok", path_encoded="/path/to/file", hours=24)
        assert res["hash"] == "new-hash"
        
        assert m.called
        assert m.request_history[0].json()["expires"] == "24"

def test_filebrowser_create_user():
    client = FileBrowserClient(base_url="http://test", signer=lambda h, m, u: h)
    
    with requests_mock.Mocker() as m:
        m.post("http://test/api/users", json={"id": 1}, status_code=201)
        
        res = client.create_user(token="tok", username="bob", password="pwd", scope="/bob")
        assert res["id"] == 1
        
        # Test already exists
        m.post("http://test/api/users", status_code=409)
        with pytest.raises(FileExistsError):
            client.create_user(token="tok", username="bob", password="pwd", scope="/bob")
            
        # Test unauthorized
        m.post("http://test/api/users", status_code=401)
        with pytest.raises(PermissionError):
            client.create_user(token="tok", username="bob", password="pwd", scope="/bob")

def test_filebrowser_fetch_public_share_json():
    client = FileBrowserClient(base_url="http://test", signer=lambda h, m, u: h)
    
    with requests_mock.Mocker() as m:
        m.get("http://test/api/public/share/hash", json={"items": []}, status_code=200)
        res = client.fetch_public_share_json("hash")
        assert res["items"] == []
        
        m.get("http://test/api/public/share/hash/sub/path", json={"name": "sub"}, status_code=200)
        res = client.fetch_public_share_json("hash", subpath="sub/path")
        assert res["name"] == "sub"
        
        m.get("http://test/api/public/share/missing", status_code=404)
        assert client.fetch_public_share_json("missing") is None

def test_filebrowser_fetch_resource():
    client = FileBrowserClient(base_url="http://test", signer=lambda h, m, u: h)
    
    with requests_mock.Mocker() as m:
        m.get("http://test/api/resources/data/file.txt", json={"name": "file.txt"}, status_code=200)
        res = client.fetch_resource("/data/file.txt", "tok")
        assert res["name"] == "file.txt"
        
        m.get("http://test/api/resources/missing", status_code=404)
        assert client.fetch_resource("/missing", "tok") is None
