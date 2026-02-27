"""
Shared utilities for the PLC Assistant backend.
"""

import os
import math
import logging
from typing import Any, Optional

import numpy as np

from app.env_resolver import is_placeholder

logger = logging.getLogger("PLCAssistant")

# ── Module-level LLM singleton (set by main.py lifespan) ──

_llm_instance = None


def set_llm(llm):
    global _llm_instance
    _llm_instance = llm


def get_llm():
    return _llm_instance


# ── Pure utilities ──

def client_ip(request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def to_bool(val: Any) -> Optional[bool]:
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ("1", "true", "yes", "y", "on"):
        return True
    if s in ("0", "false", "no", "n", "off"):
        return False
    return None


def sanitize_json(obj: Any) -> Any:
    """Recursively sanitize objects for JSON serialization."""
    if obj is None:
        return None

    if isinstance(obj, (np.float32, np.float64)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    elif isinstance(obj, (np.int32, np.int64)):
        return int(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()

    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None

    if isinstance(obj, dict):
        return {k: sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_json(v) for v in obj]

    return obj


# ── Security helpers ──

def get_app_env(config=None) -> str:
    fallback = getattr(config, "APP_ENV", "development") if config else "development"
    env = (os.getenv("APP_ENV", fallback) or "development").strip().lower()
    if env not in {"development", "production"}:
        logger.warning("Unknown APP_ENV '%s'; defaulting to 'development'", env)
        return "development"
    return env


def is_weak_jwt_secret(secret: Optional[str]) -> bool:
    value = (secret or "").strip()
    return not value or value == "dev-secret" or is_placeholder(value)


def validate_runtime_security_config(app_env: str) -> None:
    jwt_secret = os.getenv("JWT_SECRET", "")
    if app_env == "production" and is_weak_jwt_secret(jwt_secret):
        raise RuntimeError(
            "JWT_SECRET is missing/weak for production. "
            "Set APP_ENV=production with a real JWT_SECRET (not 'dev-secret' and not placeholder)."
        )

    if app_env != "production" and is_weak_jwt_secret(jwt_secret):
        logger.warning(
            "JWT_SECRET is missing/weak while APP_ENV=%s. This is okay for local development but unsafe for production.",
            app_env,
        )
