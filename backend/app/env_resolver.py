import os
import re
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import quote, urlsplit

from dotenv import load_dotenv

# Load .env from the backend directory (where this module lives)
_backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(_backend_dir / ".env", override=False)


_PLACEHOLDER_PATTERNS = (
    re.compile(r"^\$\{[^}]+\}$"),      # ${VAR}
    re.compile(r"^\$\{\{[^}]+\}\}$"),  # ${{ VAR }}
    re.compile(r"^\{\{[^}]+\}\}$"),    # {{ VAR }}
)

_PG_REQUIRED_KEYS = ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE")
_POSTGRES_REQUIRED_KEYS = (
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
)


def is_placeholder(value: Optional[str]) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    if not text:
        return True
    return any(pattern.match(text) for pattern in _PLACEHOLDER_PATTERNS)


def _missing_required_env(keys: Tuple[str, ...]) -> List[str]:
    missing = []
    for key in keys:
        if is_placeholder(os.getenv(key)):
            missing.append(key)
    return missing


def _build_database_url_from_keys(
    *,
    host_key: str,
    port_key: str,
    user_key: str,
    password_key: str,
    database_key: str,
    sslmode_key: str,
) -> Optional[str]:
    missing = _missing_required_env(
        (
            host_key,
            port_key,
            user_key,
            password_key,
            database_key,
        )
    )
    if missing:
        return None

    host = os.getenv(host_key, "").strip()
    port = os.getenv(port_key, "").strip()
    user = quote(os.getenv(user_key, "").strip(), safe="")
    password = quote(os.getenv(password_key, "").strip(), safe="")
    database = quote(os.getenv(database_key, "").strip(), safe="")

    dsn = f"postgresql://{user}:{password}@{host}:{port}/{database}"

    sslmode = os.getenv(sslmode_key)
    if sslmode and not is_placeholder(sslmode):
        dsn += f"?sslmode={quote(sslmode.strip(), safe='')}"

    return dsn


def build_database_url_from_pg_env() -> Optional[str]:
    return _build_database_url_from_keys(
        host_key="PGHOST",
        port_key="PGPORT",
        user_key="PGUSER",
        password_key="PGPASSWORD",
        database_key="PGDATABASE",
        sslmode_key="PGSSLMODE",
    )


def build_database_url_from_postgres_env() -> Optional[str]:
    return _build_database_url_from_keys(
        host_key="POSTGRES_HOST",
        port_key="POSTGRES_PORT",
        user_key="POSTGRES_USER",
        password_key="POSTGRES_PASSWORD",
        database_key="POSTGRES_DB",
        sslmode_key="POSTGRES_SSLMODE",
    )


def resolve_database_url() -> Tuple[str, str]:
    database_url = os.getenv("DATABASE_URL", "")
    if not is_placeholder(database_url):
        return database_url.strip(), "DATABASE_URL"

    fallback = build_database_url_from_pg_env()
    if fallback:
        return fallback, "PG_ENV"

    fallback = build_database_url_from_postgres_env()
    if fallback:
        return fallback, "POSTGRES_ENV"

    missing = _missing_required_env(_PG_REQUIRED_KEYS)
    missing.extend(_missing_required_env(_POSTGRES_REQUIRED_KEYS))
    invalid_detail = ""
    if database_url.strip():
        invalid_detail = (
            f"DATABASE_URL is unresolved placeholder '{database_url.strip()}'. "
        )

    raise RuntimeError(
        invalid_detail
        + "Unable to resolve database connection string. "
        + "Set DATABASE_URL to a real DSN or provide all PG vars/POSTGRES vars: "
        + ", ".join(_PG_REQUIRED_KEYS)
        + " or "
        + ", ".join(_POSTGRES_REQUIRED_KEYS)
        + f". Missing/invalid: {', '.join(missing)}"
    )


def redact_database_url(dsn: str) -> str:
    if not dsn:
        return "<missing>"

    try:
        parsed = urlsplit(dsn)
    except Exception:
        return "<invalid-dsn>"

    if not parsed.scheme or not parsed.netloc:
        return "<redacted-non-url-dsn>"

    host = parsed.hostname or "unknown-host"
    port = f":{parsed.port}" if parsed.port else ""
    db_name = parsed.path.lstrip("/") or "<unknown-db>"
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{parsed.scheme}://{host}{port}/{db_name}{query}"
