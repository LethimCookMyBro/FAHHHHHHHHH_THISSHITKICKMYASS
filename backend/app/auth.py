import os
import secrets
import logging
from datetime import datetime, timedelta
from typing import Optional

from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import HTTPException, status
from app.utils import is_weak_jwt_secret

# ----------------------
# Password hashing
# ----------------------
PWD_CTX = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger(__name__)
_warned_about_dev_jwt_fallback = False
_generated_dev_jwt_secret: Optional[str] = None


def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")
    if len(pwd_bytes) > 72:
        pwd_bytes = pwd_bytes[:72]
    return PWD_CTX.hash(pwd_bytes.decode("utf-8", errors="ignore"))


def verify_password(password: str, hashed: str) -> bool:
    return PWD_CTX.verify(password, hashed)


# ----------------------
# JWT config
# ----------------------
JWT_ALGO = os.getenv("JWT_ALGORITHM", "HS256")

ACCESS_EXPIRE = int(os.getenv("ACCESS_TOKEN_EXPIRE_SECONDS", "86400"))  # 24 hours
REFRESH_EXPIRE = int(os.getenv("REFRESH_TOKEN_EXPIRE_SECONDS", "1209600"))


# ----------------------
# Token helpers
# ----------------------
def _get_jwt_secret_or_raise() -> str:
    global _generated_dev_jwt_secret, _warned_about_dev_jwt_fallback

    secret = (os.getenv("JWT_SECRET") or "").strip()
    app_env = (os.getenv("APP_ENV") or "production").strip().lower()
    if not is_weak_jwt_secret(secret):
        return secret

    if app_env == "development":
        fallback_secret = (os.getenv("JWT_SECRET_DEV_FALLBACK") or "").strip()
        if not fallback_secret:
            if not _generated_dev_jwt_secret:
                _generated_dev_jwt_secret = secrets.token_urlsafe(48)
            fallback_secret = _generated_dev_jwt_secret

        if not _warned_about_dev_jwt_fallback:
            logger.warning(
                "Using an ephemeral development JWT secret because JWT_SECRET is missing/weak. "
                "Set a real JWT_SECRET before production."
            )
            _warned_about_dev_jwt_fallback = True
        return fallback_secret

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="JWT signing secret is not configured",
    )


def create_access_token(subject: str, expires_seconds: Optional[int] = None) -> str:
    exp = datetime.utcnow() + timedelta(seconds=(expires_seconds or ACCESS_EXPIRE))
    payload = {
        "sub": str(subject),
        "exp": exp,
        "typ": "access",
        "jti": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, _get_jwt_secret_or_raise(), algorithm=JWT_ALGO)


def create_refresh_token(subject: str, expires_seconds: Optional[int] = None) -> str:
    exp = datetime.utcnow() + timedelta(seconds=(expires_seconds or REFRESH_EXPIRE))
    payload = {
        "sub": str(subject),
        "exp": exp,
        "typ": "refresh",
        "jti": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, _get_jwt_secret_or_raise(), algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _get_jwt_secret_or_raise(), algorithms=[JWT_ALGO])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
