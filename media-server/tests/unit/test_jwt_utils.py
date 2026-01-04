import time
import pytest
import app.utils.jwt as jwt

def test_encode_decode_jwt():
    secret = "secret"
    payload = {"sub": "user", "exp": int(time.time()) + 60}
    token = jwt._encode_jwt(payload, secret)
    assert token
    
    decoded = jwt._decode_jwt(token, secret)
    assert decoded["sub"] == "user"

def test_decode_jwt_expired():
    secret = "secret"
    payload = {"sub": "user", "exp": int(time.time()) - 60}
    token = jwt._encode_jwt(payload, secret)
    
    assert jwt._decode_jwt(token, secret) is None
    # Test verify_exp=False
    assert jwt._decode_jwt(token, secret, verify_exp=False)["sub"] == "user"

def test_peek_jwt_payload():
    secret = "secret"
    payload = {"sub": "user"}
    token = jwt._encode_jwt(payload, secret)
    
    # Peek doesn't verify signature or exp
    peeked = jwt._peek_jwt_payload(token)
    assert peeked["sub"] == "user"
    
    # Invalid token parts
    assert jwt._peek_jwt_payload("invalid") is None
    assert jwt._peek_jwt_payload("a.b.c.d") is None

def test_decode_jwt_invalid_signature():
    secret = "secret"
    payload = {"sub": "user"}
    token = jwt._encode_jwt(payload, secret)
    
    assert jwt._decode_jwt(token, "wrong-secret") is None

def test_b64url_encode_decode():
    data = b"hello world"
    encoded = jwt._b64url_encode(data)
    assert encoded == "aGVsbG8gd29ybGQ"
    assert jwt._b64url_decode(encoded) == data
