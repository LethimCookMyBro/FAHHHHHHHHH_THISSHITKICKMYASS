import asyncio
import json
import logging
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)


def _normalize_alarm_input(alarm: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    error_code = str(alarm.get("error_code") or "").strip()
    if not error_code:
        return None

    machine_id = alarm.get("machine_id")
    try:
        machine_id = int(machine_id) if machine_id is not None else None
    except Exception:
        machine_id = None

    message = str(alarm.get("message") or alarm.get("error_message") or "").strip()
    category = str(alarm.get("category") or "unknown").strip().lower()
    severity = str(alarm.get("severity") or "warning").strip().lower()

    if severity not in {"info", "warning", "error", "critical"}:
        severity = "warning"

    return {
        "machine_id": machine_id,
        "error_code": error_code,
        "severity": severity,
        "message": message,
        "category": category or "unknown",
        "raw_data": alarm,
    }


def persist_plc_alarms(db_pool, alarms: Iterable[Dict[str, Any]]) -> int:
    normalized = []
    for item in alarms:
        record = _normalize_alarm_input(item)
        if record is not None:
            normalized.append(record)

    if not normalized:
        return 0

    inserted = 0
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            for row in normalized:
                cur.execute(
                    """
                    INSERT INTO plc_alarms
                        (machine_id, error_code, severity, message, category, status, raw_data, created_at)
                    SELECT %s, %s, %s, %s, %s, 'active', %s::jsonb, NOW()
                    WHERE NOT EXISTS (
                        SELECT 1 FROM plc_alarms
                        WHERE machine_id IS NOT DISTINCT FROM %s
                          AND error_code = %s
                          AND status = 'active'
                          AND created_at > NOW() - INTERVAL '30 seconds'
                    )
                    """,
                    [
                        row["machine_id"],
                        row["error_code"],
                        row["severity"],
                        row["message"],
                        row["category"],
                        json.dumps(row["raw_data"]),
                        row["machine_id"],
                        row["error_code"],
                    ],
                )
                inserted += int(cur.rowcount > 0)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db_pool.putconn(conn)

    return inserted


async def plc_alarm_ingestion_loop(
    *,
    connector,
    db_pool,
    stop_event: asyncio.Event,
    poll_interval_seconds: float = 1.5,
) -> None:
    interval = max(0.5, float(poll_interval_seconds))
    logger.info("[PLC Ingest] Started background alarm ingestion loop (interval=%.2fs)", interval)

    while not stop_event.is_set():
        try:
            if not connector.is_connected:
                await connector.connect()

            snapshot = await connector.read_data()
            alarms = snapshot.get("alarms") or []
            inserted = persist_plc_alarms(db_pool=db_pool, alarms=alarms)
            if inserted:
                logger.info("[PLC Ingest] persisted %s alarm rows", inserted)
        except Exception as exc:
            logger.warning("[PLC Ingest] loop error: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue

    logger.info("[PLC Ingest] Stopped")

