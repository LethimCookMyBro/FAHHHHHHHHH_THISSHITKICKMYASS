import os
import threading
from typing import Optional

try:
    import redis
except Exception:  # pragma: no cover - runtime optional dependency
    redis = None

_redis_lock = threading.Lock()
_redis_client = None


def get_redis_url() -> str:
    return (os.getenv("REDIS_URL", "") or "").strip()


def get_redis_client():
    """
    Lazy Redis client initialization.
    Returns None when Redis is not configured or unavailable.
    """
    global _redis_client

    if _redis_client is not None:
        return _redis_client

    if redis is None:
        return None

    redis_url = get_redis_url()
    if not redis_url:
        return None

    with _redis_lock:
        if _redis_client is not None:
            return _redis_client

        try:
            client = redis.Redis.from_url(
                redis_url,
                decode_responses=True,
                socket_timeout=1.5,
                socket_connect_timeout=1.5,
                health_check_interval=30,
            )
            client.ping()
            _redis_client = client
        except Exception:
            _redis_client = None

    return _redis_client

