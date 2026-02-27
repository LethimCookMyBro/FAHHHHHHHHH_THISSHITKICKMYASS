# backend/app/db_helpers.py
import hashlib
from datetime import datetime
from typing import Optional, Dict, Any
from psycopg2.extras import Json
from app.db import get_db_pool


def _release_connection(db_pool, conn, *, had_error: bool) -> None:
    if conn is None:
        return
    if had_error:
        try:
            conn.rollback()
        except Exception:
            db_pool.putconn(conn, close=True)
            return
    db_pool.putconn(conn)


def _row_to_dict(cur, row):
    if row is None:
        return None
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))

def create_user(email: str, password_hash: str, full_name: Optional[str] = None) -> Dict[str, Any]:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (email, password_hash, full_name) VALUES (%s, %s, %s) RETURNING id, email, full_name, is_active, role, created_at;",
                (email, password_hash, full_name)
            )
            row = cur.fetchone()
            conn.commit()
            return _row_to_dict(cur, row)
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, password_hash, full_name, is_active, role FROM users WHERE email = %s;", (email,))
            row = cur.fetchone()
            return _row_to_dict(cur, row)
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, full_name, is_active, role FROM users WHERE id = %s;", (user_id,))
            row = cur.fetchone()
            return _row_to_dict(cur, row)
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)


def get_user_ui_preferences(user_id: int) -> Dict[str, Any]:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(ui_preferences, '{}'::jsonb) AS ui_preferences FROM users WHERE id = %s;",
                (user_id,),
            )
            row = cur.fetchone()
            data = _row_to_dict(cur, row) or {}
            prefs = data.get("ui_preferences") or {}
            return prefs if isinstance(prefs, dict) else {}
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)


def update_user_ui_preferences(user_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    patch = patch if isinstance(patch, dict) else {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET ui_preferences = COALESCE(ui_preferences, '{}'::jsonb) || %s::jsonb
                WHERE id = %s
                RETURNING COALESCE(ui_preferences, '{}'::jsonb) AS ui_preferences;
                """,
                (Json(patch), user_id),
            )
            row = cur.fetchone()
            conn.commit()
            data = _row_to_dict(cur, row) or {}
            prefs = data.get("ui_preferences") or {}
            return prefs if isinstance(prefs, dict) else {}
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)

def save_refresh_token(user_id: int, token: str, ip: Optional[str] = None, ua: Optional[str] = None, expires_at: Optional[datetime] = None) -> None:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip, expires_at) VALUES (%s, %s, %s, %s, %s);",
                (user_id, token_hash, ua, ip, expires_at)
            )
            conn.commit()
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)

def find_refresh_token(token: str) -> Optional[Dict[str, Any]]:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with conn.cursor() as cur:
            cur.execute("SELECT id, user_id, revoked, expires_at FROM refresh_tokens WHERE token_hash = %s;", (token_hash,))
            row = cur.fetchone()
            return _row_to_dict(cur, row)
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)

def revoke_refresh_token_by_hash(token: str) -> None:
    db_pool = get_db_pool()
    conn = db_pool.getconn()
    had_error = False
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with conn.cursor() as cur:
            cur.execute("UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = %s;", (token_hash,))
            conn.commit()
    except Exception:
        had_error = True
        raise
    finally:
        _release_connection(db_pool, conn, had_error=had_error)
