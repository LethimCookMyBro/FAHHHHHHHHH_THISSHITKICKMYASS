import asyncio
import os
import time
from typing import Any, Dict


_DEFAULT_PLC_SNAPSHOT_CACHE_SECONDS = 1.0


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(str(raw).strip())
    except Exception:
        return default


def _resolve_snapshot_cache_seconds() -> float:
    return max(
        0.0,
        _env_float("PLC_SNAPSHOT_CACHE_SECONDS", _DEFAULT_PLC_SNAPSHOT_CACHE_SECONDS),
    )


def _get_snapshot_cache(app_state: Any) -> Dict[str, Any]:
    cache = getattr(app_state, "_plc_snapshot_cache", None)
    if isinstance(cache, dict):
        return cache

    cache = {"snapshot": None, "loaded_at": 0.0}
    setattr(app_state, "_plc_snapshot_cache", cache)
    return cache


def _get_snapshot_lock(app_state: Any) -> asyncio.Lock:
    lock = getattr(app_state, "_plc_snapshot_lock", None)
    if isinstance(lock, asyncio.Lock):
        return lock

    lock = asyncio.Lock()
    setattr(app_state, "_plc_snapshot_lock", lock)
    return lock


def _has_fresh_snapshot(cache: Dict[str, Any], *, max_age_seconds: float, now: float) -> bool:
    snapshot = cache.get("snapshot")
    loaded_at = float(cache.get("loaded_at") or 0.0)
    if snapshot is None:
        return False
    return max_age_seconds > 0 and (now - loaded_at) <= max_age_seconds


async def get_plc_snapshot(
    app_state: Any,
    connector: Any,
    *,
    max_age_seconds: float | None = None,
) -> Dict[str, Any]:
    resolved_max_age = (
        _resolve_snapshot_cache_seconds()
        if max_age_seconds is None
        else max(0.0, float(max_age_seconds))
    )
    cache = _get_snapshot_cache(app_state)
    now = time.monotonic()

    if _has_fresh_snapshot(cache, max_age_seconds=resolved_max_age, now=now):
        return cache["snapshot"]

    async with _get_snapshot_lock(app_state):
        cache = _get_snapshot_cache(app_state)
        now = time.monotonic()
        if _has_fresh_snapshot(cache, max_age_seconds=resolved_max_age, now=now):
            return cache["snapshot"]

        if not connector.is_connected:
            await connector.connect()

        snapshot = await connector.read_data()
        cache["snapshot"] = snapshot
        cache["loaded_at"] = time.monotonic()
        return snapshot
