import json
import secrets
import threading
import time
from typing import Any, Dict, Optional

from .redis_client import get_redis_client

_DEFAULT_WS_TICKET_TTL_SECONDS = 60

_mem_tickets: Dict[str, Dict[str, Any]] = {}
_mem_lock = threading.Lock()


def _mem_cleanup(now: float) -> None:
    expired = [key for key, payload in _mem_tickets.items() if float(payload.get("exp", 0.0)) <= now]
    for key in expired:
        _mem_tickets.pop(key, None)


def issue_ws_ticket(user: Dict[str, Any], ttl_seconds: int = _DEFAULT_WS_TICKET_TTL_SECONDS) -> Dict[str, Any]:
    token = secrets.token_urlsafe(32)
    ttl = max(10, int(ttl_seconds))
    exp_epoch = time.time() + ttl
    payload = {
        "user_id": int(user.get("id")),
        "role": str(user.get("role") or "viewer").lower(),
        "exp": exp_epoch,
    }

    client = get_redis_client()
    if client is not None:
        try:
            client.setex(f"ws_ticket:{token}", ttl, json.dumps(payload))
            return {"ticket": token, "expires_at": int(exp_epoch)}
        except Exception:
            pass

    with _mem_lock:
        _mem_cleanup(time.time())
        _mem_tickets[token] = payload

    return {"ticket": token, "expires_at": int(exp_epoch)}


def consume_ws_ticket(ticket: str) -> Optional[Dict[str, Any]]:
    token = str(ticket or "").strip()
    if not token:
        return None

    client = get_redis_client()
    if client is not None:
        try:
            raw = client.getdel(f"ws_ticket:{token}")
            if not raw:
                return None
            payload = json.loads(raw)
            if float(payload.get("exp", 0.0)) <= time.time():
                return None
            return payload
        except Exception:
            pass

    with _mem_lock:
        _mem_cleanup(time.time())
        payload = _mem_tickets.pop(token, None)
        if payload is None:
            return None
        if float(payload.get("exp", 0.0)) <= time.time():
            return None
        return payload

