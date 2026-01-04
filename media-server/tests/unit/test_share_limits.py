import time
import pytest
from app.services.aliases import (
    _upsert_share_alias, 
    _resolve_share_hash, 
    _increment_share_alias_download_count,
    _init_aliases_db
)

def test_share_alias_download_limit(app_module, monkeypatch):
    _init_aliases_db()
    
    # Create alias with limit 2
    _upsert_share_alias(
        from_hash="short",
        to_hash="long",
        path="/test",
        target_expire=int(time.time()) + 3600,
        download_limit=2
    )
    
    # 1st resolve - OK
    assert _resolve_share_hash("short") == "long"
    
    # Increment count
    _increment_share_alias_download_count("short")
    
    # 2nd resolve - OK
    assert _resolve_share_hash("short") == "long"
    
    # Increment count
    _increment_share_alias_download_count("short")
    
    # 3rd resolve - Gone (reached limit)
    assert _resolve_share_hash("short") is None

def test_share_alias_expiration(app_module):
    _init_aliases_db()
    
    # Create expired alias
    _upsert_share_alias(
        from_hash="expired",
        to_hash="target",
        path="/test",
        target_expire=int(time.time()) - 10
    )
    
    assert _resolve_share_hash("expired") is None

def test_share_alias_permanent(app_module):
    _init_aliases_db()
    
    # Create permanent alias
    _upsert_share_alias(
        from_hash="perm",
        to_hash="target",
        path="/test",
        target_expire=0
    )
    
    assert _resolve_share_hash("perm") == "target"
