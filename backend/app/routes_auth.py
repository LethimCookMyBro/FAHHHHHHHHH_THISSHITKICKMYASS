# backend/app/routes_auth.py
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from app.auth import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.core.ws_ticket import issue_ws_ticket
from app.db_helpers import (
    create_user,
    find_refresh_token,
    get_user_ui_preferences,
    get_user_by_email,
    revoke_refresh_token_by_hash,
    save_refresh_token,
    update_user_ui_preferences,
)
from app.security import (
    CSRF_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    clear_auth_cookies,
    create_csrf_token,
    get_current_user,
    require_roles,
    set_auth_cookies,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UiPreferencesPatchIn(BaseModel):
    theme: Optional[str] = None
    locale: Optional[str] = None


def _refresh_expiry() -> datetime:
    seconds = int(os.getenv("REFRESH_TOKEN_EXPIRE_SECONDS", "1209600"))
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


def _auth_service_unavailable(detail: str = "Authentication service temporarily unavailable") -> HTTPException:
    return HTTPException(status_code=503, detail=detail)


def _sanitize_ui_preferences_patch(payload: UiPreferencesPatchIn) -> dict:
    result = {}

    theme = (payload.theme or "").strip().lower()
    if theme in {"dark", "light"}:
        result["theme"] = theme

    locale = (payload.locale or "").strip().lower()
    if locale in {"th", "en"}:
        result["locale"] = locale

    return result


@router.post("/register")
def register(payload: RegisterIn):
    try:
        existing = get_user_by_email(payload.email)
    except Exception:
        logger.exception("Failed checking existing user for email=%s", payload.email)
        raise _auth_service_unavailable()

    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    pwd_hash = hash_password(payload.password)
    try:
        user = create_user(
            email=payload.email,
            password_hash=pwd_hash,
            full_name=payload.full_name,
        )
    except Exception:
        logger.exception("Failed to create user for email=%s", payload.email)
        raise _auth_service_unavailable()
    return {"id": user["id"], "email": user["email"]}


@router.post("/login")
def login(payload: LoginIn, response: Response, request: Request):
    try:
        user = get_user_by_email(payload.email)
    except Exception:
        logger.exception("Failed loading user for login email=%s", payload.email)
        raise _auth_service_unavailable()
    password_ok = False
    if user:
        try:
            password_ok = verify_password(payload.password, user["password_hash"])
        except Exception:
            # Treat malformed/legacy password hashes as invalid credentials.
            password_ok = False

    if not user or not password_ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access = create_access_token(subject=str(user["id"]))
    refresh = create_refresh_token(subject=str(user["id"]))
    csrf = create_csrf_token()

    try:
        save_refresh_token(
            user_id=user["id"],
            token=refresh,
            ip=request.client.host if request.client else None,
            ua=request.headers.get("user-agent"),
            expires_at=_refresh_expiry(),
        )
    except Exception:
        logger.exception("Failed to persist refresh token for user_id=%s", user["id"])
        raise _auth_service_unavailable()

    set_auth_cookies(
        response,
        access_token=access,
        refresh_token=refresh,
        csrf_token=csrf,
    )

    # Keep legacy body token for one compatibility window.
    return {"access_token": access, "token_type": "bearer"}


@router.post("/refresh")
def refresh(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    try:
        data = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if data.get("typ") != "refresh":
        raise HTTPException(status_code=401, detail="Not a refresh token")

    try:
        record = find_refresh_token(token)
    except Exception:
        logger.exception("Failed to find refresh token")
        raise _auth_service_unavailable()
    if not record or record.get("revoked"):
        raise HTTPException(status_code=401, detail="Refresh token revoked or not found")

    expires_at = record.get("expires_at")
    if expires_at and expires_at <= datetime.now(timezone.utc):
        try:
            revoke_refresh_token_by_hash(token)
        except Exception:
            logger.exception("Failed to revoke expired refresh token")
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user_id = int(record["user_id"])
    access = create_access_token(subject=str(user_id))
    new_refresh = create_refresh_token(subject=str(user_id))
    csrf = create_csrf_token()

    try:
        save_refresh_token(
            user_id=user_id,
            token=new_refresh,
            ip=request.client.host if request.client else None,
            ua=request.headers.get("user-agent"),
            expires_at=_refresh_expiry(),
        )
        revoke_refresh_token_by_hash(token)
    except Exception:
        logger.exception("Failed rotating refresh token for user_id=%s", user_id)
        raise _auth_service_unavailable()

    set_auth_cookies(
        response,
        access_token=access,
        refresh_token=new_refresh,
        csrf_token=csrf,
    )
    return {"access_token": access, "token_type": "bearer"}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if token:
        try:
            revoke_refresh_token_by_hash(token)
        except Exception:
            logger.exception("Failed to revoke refresh token during logout")
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/csrf")
def get_csrf_token(request: Request, response: Response):
    token = (request.cookies.get(CSRF_COOKIE_NAME) or "").strip()
    if not token:
        token = create_csrf_token()
        # Keep existing access/refresh cookies unchanged while setting CSRF.
        response.set_cookie(
            key=CSRF_COOKIE_NAME,
            value=token,
            httponly=False,
            secure=(os.getenv("APP_ENV", "development").strip().lower() == "production"),
            samesite="strict" if os.getenv("APP_ENV", "development").strip().lower() == "production" else "lax",
            max_age=int(os.getenv("REFRESH_TOKEN_EXPIRE_SECONDS", "1209600")),
            path="/",
        )
    return {"csrf_token": token}


@router.post("/ws-ticket")
def create_ws_ticket(current_user=Depends(require_roles("viewer"))):
    return issue_ws_ticket(current_user, ttl_seconds=int(os.getenv("WS_TICKET_TTL_SECONDS", "60")))


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    try:
        ui_preferences = get_user_ui_preferences(int(current_user["id"]))
    except Exception:
        logger.exception("Failed loading ui preferences for user_id=%s", current_user.get("id"))
        ui_preferences = {}

    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "full_name": current_user.get("full_name"),
        "role": current_user.get("role", "viewer"),
        "ui_preferences": ui_preferences,
    }


@router.get("/preferences")
def get_preferences(current_user=Depends(get_current_user)):
    try:
        prefs = get_user_ui_preferences(int(current_user["id"]))
    except Exception:
        logger.exception("Failed fetching ui preferences for user_id=%s", current_user.get("id"))
        raise _auth_service_unavailable("Failed to load UI preferences")
    return {"ui_preferences": prefs}


@router.patch("/preferences")
def patch_preferences(payload: UiPreferencesPatchIn, current_user=Depends(get_current_user)):
    patch = _sanitize_ui_preferences_patch(payload)
    if not patch:
        try:
            current = get_user_ui_preferences(int(current_user["id"]))
        except Exception:
            logger.exception("Failed reading ui preferences for empty patch user_id=%s", current_user.get("id"))
            raise _auth_service_unavailable("Failed to load UI preferences")
        return {"ui_preferences": current}

    try:
        prefs = update_user_ui_preferences(int(current_user["id"]), patch)
    except Exception:
        logger.exception("Failed updating ui preferences for user_id=%s", current_user.get("id"))
        raise _auth_service_unavailable("Failed to save UI preferences")
    return {"ui_preferences": prefs}
