
def test_request_id_header_roundtrip(client, app_module):
    supplied = "req_12345678"
    resp = client.get("/health", headers={app_module.REQUEST_ID_HEADER: supplied})
    assert resp.headers[app_module.REQUEST_ID_HEADER] == supplied


def test_request_id_header_falls_back(client, app_module):
    supplied = "bad id"
    resp = client.get("/health", headers={app_module.REQUEST_ID_HEADER: supplied})
    returned = resp.headers[app_module.REQUEST_ID_HEADER]
    assert returned != supplied
    assert app_module.REQUEST_ID_RE.fullmatch(returned)
