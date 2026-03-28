import os
import secrets
import logging
from typing import Dict, Optional

from fastapi import Depends, HTTPException, Request, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import decode_token
from app.db_helpers import get_user_by_id
from app.core.ws_ticket import consume_ws_ticket
from app.utils import get_app_env

logger = logging.getLogger(__name__)

ACCESS_COOKIE_NAME = os.getenv("ACCESS_TOKEN_COOKIE_NAME", "access_token")
REFRESH_COOKIE_NAME = os.getenv("REFRESH_TOKEN_COOKIE_NAME", "refresh_token")
CSRF_COOKIE_NAME = os.getenv("CSRF_COOKIE_NAME", "csrf_token")
CSRF_HEADER_NAME = os.getenv("CSRF_HEADER_NAME", "X-CSRF-Token")

_SECURITY_SCHEME = HTTPBearer(auto_error=False)
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/csrf",
}

ROLE_RANK = {
    "viewer": 1,
    "operator": 2,
    "admin": 3,
}


def _cookie_secure() -> bool:
    env = get_app_env()
    if env == "production":
        return True
    return (os.getenv("COOKIE_SECURE", "false") or "false").strip().lower() == "true"


def _cookie_samesite() -> str:
    env = get_app_env()
    if env == "production":
        return "strict"
    configured = (os.getenv("COOKIE_SAMESITE", "lax") or "lax").strip().lower()
    return configured if configured in {"lax", "strict", "none"} else "lax"


def get_cookie_security_settings() -> Dict[str, object]:
    samesite = _cookie_samesite()
    secure = _cookie_secure() or samesite == "none"
    return {"secure": secure, "samesite": samesite}


def _allow_ws_cookie_fallback() -> bool:
    return (os.getenv("WS_ALLOW_COOKIE_FALLBACK", "false") or "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "y",
        "on",
    }


def create_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookies(response, *, access_token: str, refresh_token: str, csrf_token: str) -> None:
    refresh_max_age = int(os.getenv("REFRESH_TOKEN_EXPIRE_SECONDS", "1209600"))
    access_max_age = int(os.getenv("ACCESS_TOKEN_EXPIRE_SECONDS", "86400"))

    cookie_settings = get_cookie_security_settings()
    cookie_secure = bool(cookie_settings["secure"])
    cookie_samesite = str(cookie_settings["samesite"])

    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=cookie_secure,
        samesite=cookie_samesite,
        max_age=access_max_age,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=cookie_secure,
        samesite=cookie_samesite,
        max_age=refresh_max_age,
        path="/api/auth",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=cookie_secure,
        samesite=cookie_samesite,
        max_age=refresh_max_age,
        path="/",
    )


def rotate_access_cookie(response, *, access_token: str) -> None:
    access_max_age = int(os.getenv("ACCESS_TOKEN_EXPIRE_SECONDS", "86400"))
    cookie_settings = get_cookie_security_settings()
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=bool(cookie_settings["secure"]),
        samesite=str(cookie_settings["samesite"]),
        max_age=access_max_age,
        path="/",
    )


def clear_auth_cookies(response) -> None:
    response.delete_cookie(key=ACCESS_COOKIE_NAME, path="/")
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")


def _token_from_request(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
) -> Optional[str]:
    if credentials and credentials.credentials:
        return credentials.credentials
    cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    return None


def _load_user_or_401(user_id: int) -> Dict:
    try:
        user = get_user_by_id(int(user_id))
    except Exception:
        logger.exception("Failed to load user by id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        )
    if not user or not user.get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_SECURITY_SCHEME),
):
    token = _token_from_request(request, credentials)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if payload.get("typ") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not an access token",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = _load_user_or_401(user_id_int)
    try:
        request.state.user_id = user.get("id")
        request.state.user_role = user.get("role")
    except Exception:
        pass
    return user


def get_optional_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_SECURITY_SCHEME),
):
    token = _token_from_request(request, credentials)
    if not token:
        return None
    return get_current_user(request, credentials)


def require_roles(*roles: str):
    role_names = [str(role).strip().lower() for role in roles if str(role).strip()]
    if not role_names:
        role_names = ["viewer"]
    min_rank = min(ROLE_RANK.get(role, ROLE_RANK["admin"]) for role in role_names)

    def _dependency(current_user=Depends(get_current_user)):
        role = str(current_user.get("role") or "viewer").strip().lower()
        rank = ROLE_RANK.get(role, 0)
        if rank < min_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="RBAC_DENIED",
            )
        return current_user

    return _dependency


def should_enforce_csrf(request: Request) -> bool:
    if request.method.upper() not in _UNSAFE_METHODS:
        return False
    path = request.url.path
    if not path.startswith("/api/"):
        return False
    if path in _CSRF_EXEMPT_PATHS:
        return False

    # Enforce CSRF for cookie-authenticated calls. Bearer-only clients remain backward compatible.
    has_session_cookie = bool(
        request.cookies.get(ACCESS_COOKIE_NAME) or request.cookies.get(REFRESH_COOKIE_NAME)
    )
    return has_session_cookie


def validate_csrf_or_raise(request: Request) -> None:
    header_value = (request.headers.get(CSRF_HEADER_NAME) or "").strip()
    cookie_value = (request.cookies.get(CSRF_COOKIE_NAME) or "").strip()
    if not header_value or not cookie_value or header_value != cookie_value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF_INVALID",
        )


def authenticate_websocket(websocket: WebSocket) -> Optional[Dict]:
    ticket = (websocket.query_params.get("ticket") or "").strip()
    if ticket:
        payload = consume_ws_ticket(ticket)
        if payload is None:
            return None
        user_id = payload.get("user_id")
        if not user_id:
            return None
        try:
            user = _load_user_or_401(int(user_id))
        except Exception:
            return None
        return user

    if not _allow_ws_cookie_fallback():
        return None

    cookie_token = websocket.cookies.get(ACCESS_COOKIE_NAME)
    if not cookie_token:
        return None
    try:
        payload = decode_token(cookie_token)
    except Exception:
        return None
    if payload.get("typ") != "access":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        return _load_user_or_401(int(user_id))
    except Exception:
        return None
