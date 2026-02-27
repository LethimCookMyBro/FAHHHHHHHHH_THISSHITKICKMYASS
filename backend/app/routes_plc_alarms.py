import json
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from .security import require_roles
from .plc.contracts import _normalize_alarm, _normalize_alarm_status, _now_iso
from .plc.action_policy import POLICY_VERSION
from .routes_plc import _get_pool, _feature_enabled, AlarmAcknowledgeRequest

router = APIRouter()

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
            where_parts: List[str] = []
            params: List[Any] = []

            if status:
                normalized_status = _normalize_alarm_status(status)
                where_parts.append("status = %s")
                params.append(normalized_status)

            if severity:
                where_parts.append("LOWER(severity) = %s")
                params.append(str(severity).strip().lower())

            where_clause = ""
            if where_parts:
                where_clause = "WHERE " + " AND ".join(where_parts)

            cur.execute(
                f"""
                SELECT id, machine_id, error_code, severity, message,
                       category, status, raw_data, diagnosed_at,
                       resolved_at, created_at, acknowledged_at, acknowledge_note
                FROM plc_alarms
                {where_clause}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            rows = _rows_to_dicts(cur)

            cur.execute(f"SELECT COUNT(*) FROM plc_alarms {where_clause}", params)
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
    finally:
        pool.putconn(conn)

    return {"alarm": _normalize_alarm(alarm_dict)}
