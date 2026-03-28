import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from psycopg2 import sql

from .plc.action_policy import POLICY_VERSION
from .plc.contracts import _normalize_action, _normalize_alarm, _normalize_alarm_status, _now_iso
from .plc_alarm_queries import build_alarm_where_clause
from .routes_plc import _get_pool, _feature_enabled, AlarmAcknowledgeRequest
from .security import require_roles

router = APIRouter()


class AlarmResolveRequest(BaseModel):
    alarm_ids: List[int]
    note: str = ""
    source: str = "system"

def _rows_to_dicts(cur) -> List[dict[str, Any]]:
    columns = [desc[0] for desc in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]

@router.get("/alarms")
async def list_alarms(
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
    status: Optional[str] = Query(None, description="Filter by status: active/acknowledged/resolved"),
    severity: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _ = current_user
    pool = _get_pool(request)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            where_clause, params = build_alarm_where_clause(status, severity)
            cur.execute(
                sql.SQL(
                    """
                    SELECT id, machine_id, error_code, severity, message,
                           category, status, raw_data, diagnosed_at,
                           resolved_at, created_at, acknowledged_at, acknowledge_note
                    FROM plc_alarms
                    {where_clause}
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """
                ).format(where_clause=where_clause),
                params + [limit, offset],
            )
            rows = _rows_to_dicts(cur)

            cur.execute(
                sql.SQL("SELECT COUNT(*) FROM plc_alarms{where_clause}").format(
                    where_clause=where_clause,
                ),
                params,
            )
            total = cur.fetchone()[0]

        alarms = [_normalize_alarm(row) for row in rows]
        return {"alarms": alarms, "total": total, "limit": limit, "offset": offset}
    finally:
        pool.putconn(conn)


@router.get("/alarms/active")
async def active_alarms(
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
):
    _ = current_user
    pool = _get_pool(request)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, machine_id, error_code, severity, message,
                       category, status, raw_data, diagnosed_at,
                       resolved_at, created_at, acknowledged_at, acknowledge_note
                FROM plc_alarms
                WHERE status = 'active'
                ORDER BY
                    CASE severity
                        WHEN 'critical' THEN 0
                        WHEN 'error' THEN 1
                        WHEN 'warning' THEN 2
                        ELSE 3
                    END,
                    created_at DESC
                """
            )
            rows = _rows_to_dicts(cur)

        alarms = [_normalize_alarm(row) for row in rows]
        return {"alarms": alarms, "count": len(alarms)}
    finally:
        pool.putconn(conn)


@router.post("/alarms/{alarm_id}/acknowledge")
async def acknowledge_alarm(
    alarm_id: int,
    payload: AlarmAcknowledgeRequest,
    request: Request,
    current_user: dict = Depends(require_roles("operator")),
):
    if not _feature_enabled("FEATURE_AGENT_WORKFLOW", True):
        raise HTTPException(status_code=403, detail="Agent workflow is disabled")

    pool = _get_pool(request)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM plc_alarms WHERE id = %s", [alarm_id])
            existing_row = cur.fetchone()
            if not existing_row:
                raise HTTPException(status_code=404, detail="Alarm not found")

            existing_status = _normalize_alarm_status(existing_row[0])
            if existing_status != "active":
                raise HTTPException(status_code=409, detail="Alarm is no longer active")

            cur.execute(
                """
                UPDATE plc_alarms
                SET status = 'acknowledged',
                    acknowledged_at = NOW(),
                    acknowledged_by = %s,
                    acknowledge_note = %s,
                    diagnosed_at = COALESCE(diagnosed_at, NOW())
                WHERE id = %s
                RETURNING id, machine_id, error_code, severity, message,
                          category, status, raw_data, diagnosed_at,
                          resolved_at, created_at, acknowledged_at, acknowledge_note
                """,
                [current_user.get("id"), payload.note or "", alarm_id],
            )
            updated_row = cur.fetchone()
            if not updated_row:
                raise HTTPException(status_code=404, detail="Alarm not found")

            columns = [desc[0] for desc in cur.description]
            alarm_dict = dict(zip(columns, updated_row))

            cur.execute(
                """
                INSERT INTO ai_actions
                    (alarm_id, action_type, diagnosis, recommendation, confidence,
                     is_hardware, repair_steps, sources, action_reason,
                     action_payload, approval_info, execution_status,
                     execution_result, before_state, after_state, policy_version,
                     created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        NOW(), NOW())
                """,
                [
                    alarm_id,
                    "acknowledge",
                    "Hardware issue acknowledged for manual technician workflow.",
                    "Follow technician checklist and validate hardware replacement before resolve.",
                    1.0,
                    True,
                    json.dumps(payload.checklist or []),
                    json.dumps([]),
                    payload.note or "Hardware issue acknowledged by operator.",
                    json.dumps({"checklist": payload.checklist or []}),
                    json.dumps(
                        {
                            "approved_by": current_user.get("id"),
                            "approved_at": _now_iso(),
                        }
                    ),
                    "acknowledged",
                    json.dumps({"success": True, "message": "Alarm acknowledged"}),
                    json.dumps({}),
                    json.dumps({}),
                    POLICY_VERSION,
                ],
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

    return {"alarm": _normalize_alarm(alarm_dict)}


@router.post("/alarms/resolve")
async def resolve_alarms(
    payload: AlarmResolveRequest,
    request: Request,
    current_user: dict = Depends(require_roles("operator")),
):
    if not _feature_enabled("FEATURE_AGENT_WORKFLOW", True):
        raise HTTPException(status_code=403, detail="Agent workflow is disabled")

    alarm_ids = sorted({int(alarm_id) for alarm_id in (payload.alarm_ids or []) if int(alarm_id) > 0})
    if not alarm_ids:
        raise HTTPException(status_code=400, detail="No alarm ids provided")

    pool = _get_pool(request)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE plc_alarms
                SET status = 'resolved',
                    resolved_at = NOW(),
                    diagnosed_at = COALESCE(diagnosed_at, NOW())
                WHERE id = ANY(%s)
                  AND status <> 'resolved'
                RETURNING id, machine_id, error_code, severity, message,
                          category, status, raw_data, diagnosed_at,
                          resolved_at, created_at, acknowledged_at, acknowledge_note
                """,
                [alarm_ids],
            )
            updated_alarm_rows = _rows_to_dicts(cur)

            action_rows = []
            for alarm in updated_alarm_rows:
                source = str(payload.source or "system").strip() or "system"
                note = str(payload.note or "").strip()
                result_message = f"Alarm resolved via {source.replace('_', ' ')}."
                cur.execute(
                    """
                    INSERT INTO ai_actions
                        (alarm_id, action_type, diagnosis, recommendation, confidence,
                         is_hardware, repair_steps, sources, action_reason,
                         action_payload, approval_info, execution_status,
                         execution_result, before_state, after_state, policy_version,
                         created_at, updated_at, executed_at)
                    VALUES (%s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s, %s,
                            NOW(), NOW(), NOW())
                    RETURNING id, alarm_id, action_type, diagnosis,
                              recommendation, confidence, is_hardware,
                              repair_steps, sources, created_at,
                              action_reason, action_payload, approval_info,
                              execution_status, execution_result,
                              before_state, after_state, policy_version,
                              executed_at, %s AS error_code,
                              %s AS error_message, %s AS severity
                    """,
                    [
                        alarm["id"],
                        "resolve",
                        "Incident resolution confirmed by synchronized workflow.",
                        note or result_message,
                        1.0,
                        False,
                        json.dumps([]),
                        json.dumps([]),
                        note or result_message,
                        json.dumps({"source": source, "alarm_ids": alarm_ids}),
                        json.dumps(
                            {
                                "approved_by": current_user.get("id"),
                                "approved_at": _now_iso(),
                                "source": source,
                            }
                        ),
                        "executed",
                        json.dumps({"success": True, "message": result_message}),
                        json.dumps({}),
                        json.dumps({}),
                        POLICY_VERSION,
                        alarm["error_code"],
                        alarm["message"],
                        alarm["severity"],
                    ],
                )
                action_row = cur.fetchone()
                if action_row:
                    columns = [desc[0] for desc in cur.description]
                    action_rows.append(dict(zip(columns, action_row)))

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

    return {
        "resolved_count": len(updated_alarm_rows),
        "alarms": [_normalize_alarm(row) for row in updated_alarm_rows],
        "actions": [_normalize_action(row) for row in action_rows],
    }
