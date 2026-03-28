from app.core.rate_limit import _scope_config


def test_read_only_chat_endpoints_use_general_scope():
    scope, window, limit = _scope_config("GET", "/api/chat/sessions")
    assert scope == "general"
    assert window > 0
    assert limit > 0


def test_chat_post_uses_sensitive_scope():
    scope, window, limit = _scope_config("POST", "/api/chat")
    assert scope == "sensitive"
    assert window > 0
    assert limit > 0


def test_auth_refresh_uses_sensitive_scope():
    scope, _, _ = _scope_config("POST", "/api/auth/refresh")
    assert scope == "sensitive"
