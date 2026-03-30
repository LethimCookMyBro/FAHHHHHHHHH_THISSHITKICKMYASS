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


def _normalize_alarm_batch(alarms: Iterable[Dict[str, Any]]) -> list[Dict[str, Any]]:
    normalized = []
    for item in alarms:
        record = _normalize_alarm_input(item)
        if record is not None:
            normalized.append(record)
    return normalized


def _normalize_machine_error_map(machines: Iterable[Dict[str, Any]]) -> Dict[int, str]:
    current_errors: Dict[int, str] = {}

    for machine in machines or []:
        machine_id = machine.get("id")
        try:
            normalized_machine_id = int(machine_id)
        except Exception:
            continue

        active_error = machine.get("active_error") or {}
        error_code = str(
            active_error.get("code")
            or active_error.get("error_code")
            or machine.get("error_code")
            or "",
        ).strip()

        current_errors[normalized_machine_id] = error_code

    return current_errors


def _collect_stale_alarm_ids(
    open_alarm_rows: Iterable[Dict[str, Any]],
    machines: Iterable[Dict[str, Any]],
) -> list[int]:
    current_errors = _normalize_machine_error_map(machines)
    kept_active_keys: set[tuple[int, str]] = set()
    stale_ids: list[int] = []

    for row in open_alarm_rows or []:
        alarm_id = row.get("id")
        machine_id = row.get("machine_id")
        error_code = str(row.get("error_code") or "").strip()

        try:
            normalized_alarm_id = int(alarm_id)
            normalized_machine_id = int(machine_id)
        except Exception:
            continue

        current_error_code = current_errors.get(normalized_machine_id, "")
        if not current_error_code or current_error_code != error_code:
            stale_ids.append(normalized_alarm_id)
            continue

        alarm_key = (normalized_machine_id, error_code)
        if alarm_key in kept_active_keys:
            stale_ids.append(normalized_alarm_id)
            continue

        kept_active_keys.add(alarm_key)

    return stale_ids


def persist_plc_alarms(db_pool, alarms: Iterable[Dict[str, Any]]) -> int:
    if db_pool is None:
        return 0

    normalized = _normalize_alarm_batch(alarms)

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
                          AND status <> 'resolved'
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


def reconcile_plc_alarms(db_pool, machines: Iterable[Dict[str, Any]]) -> int:
    if db_pool is None:
        return 0

    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, machine_id, error_code, created_at
                FROM plc_alarms
                WHERE status <> 'resolved'
                  AND machine_id IS NOT NULL
                ORDER BY machine_id ASC, created_at DESC, id DESC
                """
            )
            columns = [desc[0] for desc in cur.description]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
            stale_alarm_ids = _collect_stale_alarm_ids(rows, machines)

            if stale_alarm_ids:
                cur.execute(
                    """
                    UPDATE plc_alarms
                    SET status = 'resolved',
                        resolved_at = NOW(),
                        diagnosed_at = COALESCE(diagnosed_at, NOW())
                    WHERE id = ANY(%s)
                    """,
                    [stale_alarm_ids],
                )

        conn.commit()
        return len(stale_alarm_ids)
    except Exception:
        conn.rollback()
        raise
    finally:
        db_pool.putconn(conn)


async def plc_alarm_ingestion_loop(
    *,
    connector,
    db_pool,
    stop_event: asyncio.Event,
    poll_interval_seconds: float = 1.5,
) -> None:
    interval = max(0.5, float(poll_interval_seconds))
    logger.info("[PLC Ingest] Started background alarm ingestion loop (interval=%.2fs)", interval)
    if db_pool is None:
        logger.info("[PLC Ingest] Database unavailable; alarm persistence disabled")

    while not stop_event.is_set():
        try:
            if not connector.is_connected:
                await connector.connect()

            snapshot = await connector.read_data()
            machines = snapshot.get("machines") or []
            reconciled = reconcile_plc_alarms(db_pool=db_pool, machines=machines)
            alarms = snapshot.get("alarms") or []
            inserted = persist_plc_alarms(db_pool=db_pool, alarms=alarms)
            if inserted or reconciled:
                logger.info(
                    "[PLC Ingest] reconciled=%s persisted=%s",
                    reconciled,
                    inserted,
                )
        except Exception as exc:
            logger.warning("[PLC Ingest] loop error: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue

    logger.info("[PLC Ingest] Stopped")
