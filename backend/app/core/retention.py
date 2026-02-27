import logging
import os
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)


def _retention_days() -> int:
    raw = os.getenv("DATA_RETENTION_DAYS", "90")
    try:
        return max(7, int(str(raw).strip()))
    except Exception:
        return 90


def _retention_interval_seconds() -> int:
    raw = os.getenv("RETENTION_JOB_INTERVAL_SECONDS", str(6 * 3600))
    try:
        return max(600, int(str(raw).strip()))
    except Exception:
        return 6 * 3600


def run_retention_once(db_pool) -> None:
    days = _retention_days()
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM chat_messages
                WHERE created_at < NOW() - (%s || ' days')::interval
                """,
                [days],
            )
            deleted_chat_messages = cur.rowcount

            cur.execute(
                """
                DELETE FROM chat_sessions s
                WHERE s.updated_at < NOW() - (%s || ' days')::interval
                  AND NOT EXISTS (
                    SELECT 1 FROM chat_messages m WHERE m.session_id = s.id
                  )
                """,
                [days],
            )
            deleted_sessions = cur.rowcount

            cur.execute(
                """
                DELETE FROM ai_actions
                WHERE created_at < NOW() - (%s || ' days')::interval
                """,
                [days],
            )
            deleted_actions = cur.rowcount

            cur.execute(
                """
                DELETE FROM plc_alarms
                WHERE created_at < NOW() - (%s || ' days')::interval
                """,
                [days],
            )
            deleted_alarms = cur.rowcount

        conn.commit()
        logger.info(
            "Retention cleanup complete: days=%s chat_messages=%s sessions=%s ai_actions=%s plc_alarms=%s",
            days,
            deleted_chat_messages,
            deleted_sessions,
            deleted_actions,
            deleted_alarms,
        )
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        logger.error("Retention cleanup failed: %s", exc, exc_info=True)
    finally:
        if conn is not None:
            db_pool.putconn(conn)


def start_retention_loop(db_pool, stop_event: threading.Event) -> threading.Thread:
    interval = _retention_interval_seconds()

    def _loop() -> None:
        # Run once immediately after startup.
        run_retention_once(db_pool)
        while not stop_event.wait(interval):
            run_retention_once(db_pool)

    t = threading.Thread(target=_loop, name="retention-loop", daemon=True)
    t.start()
    return t

