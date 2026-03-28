import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from .redis_client import get_redis_client

_GENERAL_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("GENERAL_RATE_LIMIT_WINDOW_SECONDS", "60"))
_GENERAL_RATE_LIMIT_MAX_REQUESTS = int(os.getenv("GENERAL_RATE_LIMIT_MAX_REQUESTS", "240"))
_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("SENSITIVE_RATE_LIMIT_WINDOW_SECONDS", "60"))
_SENSITIVE_RATE_LIMIT_MAX_REQUESTS = int(os.getenv("SENSITIVE_RATE_LIMIT_MAX_REQUESTS", "40"))
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

_MEM_BUCKETS: Dict[str, Deque[float]] = defaultdict(deque)
_MEM_LOCK = threading.Lock()


def _is_sensitive_request(method: str, path: str) -> bool:
    normalized_method = str(method or "GET").strip().upper()
    if normalized_method in _SAFE_METHODS:
        return False

    return (
        path.startswith("/api/auth/login")
        or path.startswith("/api/auth/register")
        or path.startswith("/api/auth/refresh")
        or path.startswith("/api/auth/ws-ticket")
        or path.startswith("/api/chat")
        or path.startswith("/api/transcribe")
        or path.startswith("/api/agent/action")
        or path.startswith("/api/plc/diagnose")
        or path.startswith("/api/plc/alarms")
        or path.startswith("/api/plc/actions")
    )


def _scope_config(method: str, path: str) -> Tuple[str, int, int]:
    if _is_sensitive_request(method, path):
        return (
            "sensitive",
            _SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
            _SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
        )
    return (
        "general",
        _GENERAL_RATE_LIMIT_WINDOW_SECONDS,
        _GENERAL_RATE_LIMIT_MAX_REQUESTS,
    )


def _check_rate_limit_memory(ip: str, path: str, method: str, now: float) -> Tuple[bool, int]:
    scope, window, max_requests = _scope_config(method, path)
    bucket_key = f"{ip}:{scope}"

    with _MEM_LOCK:
        bucket = _MEM_BUCKETS[bucket_key]
        cutoff = now - window
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= max_requests:
            retry_after = max(1, int(window - (now - bucket[0])))
            return False, retry_after

        bucket.append(now)

    return True, 0


def _check_rate_limit_redis(ip: str, path: str, method: str, now: float) -> Tuple[bool, int]:
    client = get_redis_client()
    if client is None:
        return _check_rate_limit_memory(ip=ip, path=path, method=method, now=now)

    scope, window, max_requests = _scope_config(method, path)
    window_bucket = int(now // window)
    key = f"ratelimit:{scope}:{ip}:{window_bucket}"

    try:
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, window + 2)
        if count > max_requests:
            retry_after = max(1, int(window - (now % window)))
            return False, retry_after
    except Exception:
        return _check_rate_limit_memory(ip=ip, path=path, method=method, now=now)

    return True, 0


def check_rate_limit(ip: str, path: str, method: str = "GET", now: float | None = None) -> Tuple[bool, int]:
    return _check_rate_limit_redis(
        ip=ip,
        path=path,
        method=method,
        now=now if now is not None else time.time(),
    )
