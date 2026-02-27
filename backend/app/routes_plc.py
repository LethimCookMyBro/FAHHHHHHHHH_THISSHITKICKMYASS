"""
PLC API Routes — REST endpoints + WebSocket for real-time PLC data.

This module exposes a normalized contract for frontend consumption and
adds safe AI-agent workflow endpoints:
- diagnose -> plan -> approve/execute
- hardware acknowledge
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, model_validator

from .plc.action_policy import POLICY_VERSION, propose_safe_action_plan
from .plc.connector import get_connector
from .plc.contracts import (
    _iso,
    _normalize_action,
    _normalize_alarm,
    _normalize_alarm_status,
    _normalize_machine,
    _safe_json,
    _to_float,
)
from .plc.diagnostic import diagnose_error
from .security import authenticate_websocket, require_roles

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/plc", tags=["PLC"])


# ────────────────────────────────
# Pydantic Models
# ────────────────────────────────

class DiagnoseRequest(BaseModel):
    error_code: str
    error_message: str = ""
    message: str = ""  # Backward compatibility alias
    machine_id: int = 0
    machine_name: str = ""
    model: str = ""
    category: str = "unknown"
    sensors: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def apply_error_message_alias(self):
        if not self.error_message and self.message:
            self.error_message = self.message
        return self


class DiagnoseResponse(BaseModel):
    error_code: str
    error_message: str
    diagnosis: str
    recommendation: str
    is_hardware: bool
    issue_type: str
    confidence: float
    sources: list = []
    processing_time: float = 0.0
    machine: str = ""
    model: str = ""


class ActionPlanRequest(BaseModel):
    alarm_id: Optional[int] = None
    error_code: str = ""
    error_message: str = ""
    message: str = ""  # Backward compatibility alias
    machine_id: int = 0
    machine_name: str = ""
    model: str = ""
    category: str = "unknown"
    severity: str = "warning"
    sensors: Dict[str, Any] = Field(default_factory=dict)
    diagnosis: str = ""
    recommendation: str = ""
    issue_type: str = ""
    confidence: float = 0.0

    @model_validator(mode="after")
    def apply_error_message_alias(self):
        if not self.error_message and self.message:
            self.error_message = self.message
        return self


class ActionApproveRequest(BaseModel):
    reason: str = ""
    dry_run: Optional[bool] = None


class AlarmAcknowledgeRequest(BaseModel):
    note: str = ""
    checklist: List[str] = Field(default_factory=list)


# ────────────────────────────────
# Helpers
# ────────────────────────────────

def _feature_enabled(key: str, default: bool = False) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def _is_ws_origin_allowed(origin: Optional[str], host: Optional[str]) -> bool:
    if not origin:
        return True

    try:
        parsed = urlparse(origin)
    except Exception:
        return False

    origin_host = (parsed.netloc or "").strip().lower()
    if not origin_host:
        return False

    host_value = (host or "").strip().lower()
    if host_value and origin_host == host_value:
        return True

    allowed_hosts = {
        "localhost:5173",
        "127.0.0.1:5173",
        "localhost:3000",
        "127.0.0.1:3000",
    }

    raw_cors = os.getenv("CORS_ORIGINS", "")
    for origin_value in raw_cors.split(","):
        value = origin_value.strip()
        if not value:
            continue
        try:
            parsed_value = urlparse(value)
            if parsed_value.netloc:
                allowed_hosts.add(parsed_value.netloc.lower())
        except Exception:
            continue

    if origin_host in allowed_hosts:
        return True

    return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rows_to_dicts(cur) -> List[Dict[str, Any]]:
    columns = [desc[0] for desc in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def _get_pool(request: Request):
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database not available")
    return pool


def _get_retriever(request: Request):
    return getattr(request.app.state, "retriever", None)


def _get_llm(request: Request):
    return getattr(request.app.state, "llm", None)


def _append_oee_history(app_state: Any, oee_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    history = getattr(app_state, "oee_history", None)
    if not isinstance(history, list):
        history = []

    history.append(
        {
            "time": datetime.now().strftime("%H:%M:%S"),
            "value": round(_to_float(oee_payload.get("overall"), default=0.0), 2),
        }
    )
    history = history[-40:]
    app_state.oee_history = history
    return history


def _fetch_recent_alarms(pool, limit: int = 10) -> List[Dict[str, Any]]:
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, machine_id, error_code, severity, message,
                       category, status, raw_data, diagnosed_at,
                       resolved_at, created_at, acknowledged_at, acknowledge_note
                FROM plc_alarms
                ORDER BY created_at DESC
                LIMIT %s
                """,
                [limit],
            )
            rows = _rows_to_dicts(cur)
        return [_normalize_alarm(row) for row in rows]
    finally:
        pool.putconn(conn)


def _fetch_recent_actions(pool, limit: int = 8) -> List[Dict[str, Any]]:
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id, a.alarm_id, a.action_type, a.diagnosis,
                       a.recommendation, a.confidence, a.is_hardware,
                       a.repair_steps, a.sources, a.created_at,
                       a.action_reason, a.action_payload, a.approval_info,
                       a.execution_status, a.execution_result,
                       a.before_state, a.after_state, a.policy_version,
                       a.executed_at,
                       al.error_code, al.message AS error_message, al.severity
                FROM ai_actions a
                LEFT JOIN plc_alarms al ON a.alarm_id = al.id
                ORDER BY a.created_at DESC
                LIMIT %s
                """,
                [limit],
            )
            rows = _rows_to_dicts(cur)
        return [_normalize_action(row) for row in rows]
    finally:
        pool.putconn(conn)


def _build_dashboard_payload(snapshot: Dict[str, Any], app_state: Any, pool=None, include_recent: bool = False) -> Dict[str, Any]:
    machines = [_normalize_machine(m) for m in (snapshot.get("machines") or [])]

    running = sum(1 for machine in machines if machine["status"] == "running")
    idle = sum(1 for machine in machines if machine["status"] == "idle")
    error = sum(1 for machine in machines if machine["status"] == "error")
    stopped = sum(1 for machine in machines if machine["status"] == "stopped")

    oee = snapshot.get("oee") or {}
    oee_payload = {
        "overall": round(_to_float(oee.get("overall"), default=0.0), 2),
        "availability": round(_to_float(oee.get("availability"), default=0.0), 2),
        "performance": round(_to_float(oee.get("performance"), default=0.0), 2),
        "quality": round(_to_float(oee.get("quality"), default=0.0), 2),
    }
    history = _append_oee_history(app_state, oee_payload)

    summary = {
        "total_machines": len(machines),
        "running": running,
        "idle": idle,
        "error": error,
        "stopped": stopped,
    }

    payload = {
        "machines": machines,
        "oee": oee_payload,
        "oee_history": history,
        "summary": summary,
        "timestamp": snapshot.get("timestamp") or _now_iso(),
        "recent_alarms": [],
        "recent_actions": [],
    }

    if include_recent and pool is not None:
        try:
            payload["recent_alarms"] = _fetch_recent_alarms(pool, limit=10)
        except Exception as exc:
            logger.warning("[PLC Routes] Could not fetch recent alarms: %s", exc)

        try:
            payload["recent_actions"] = _fetch_recent_actions(pool, limit=6)
        except Exception as exc:
            logger.warning("[PLC Routes] Could not fetch recent actions: %s", exc)

    return payload


def _load_alarm_by_id(pool, alarm_id: int) -> Optional[Dict[str, Any]]:
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, machine_id, error_code, severity, message, category,
                       status, raw_data, diagnosed_at, resolved_at, created_at,
                       acknowledged_at, acknowledge_note
                FROM plc_alarms
                WHERE id = %s
                """,
                [alarm_id],
            )
            row = cur.fetchone()
            if not row:
                return None
            columns = [desc[0] for desc in cur.description]
            return dict(zip(columns, row))
    finally:
        pool.putconn(conn)


def _load_action_by_id(pool, action_id: int) -> Optional[Dict[str, Any]]:
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id, a.alarm_id, a.action_type, a.diagnosis,
                       a.recommendation, a.confidence, a.is_hardware,
                       a.repair_steps, a.sources, a.created_at,
                       a.action_reason, a.action_payload, a.approval_info,
                       a.execution_status, a.execution_result,
                       a.before_state, a.after_state, a.policy_version,
                       a.executed_at,
                       al.error_code, al.message AS error_message, al.severity
                FROM ai_actions a
                LEFT JOIN plc_alarms al ON a.alarm_id = al.id
                WHERE a.id = %s
                """,
                [action_id],
            )
            row = cur.fetchone()
            if not row:
                return None
            columns = [desc[0] for desc in cur.description]
            return dict(zip(columns, row))
    finally:
        pool.putconn(conn)


# ────────────────────────────────
# REST Endpoints
# ────────────────────────────────

@router.get("/machines")
async def list_machines(
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
):
    _ = current_user
    connector = get_connector()
    if not connector.is_connected:
        await connector.connect()

    snapshot = await connector.read_data()
    machines = [_normalize_machine(machine) for machine in (snapshot.get("machines") or [])]
    summary = {
        "total_machines": len(machines),
        "running": sum(1 for machine in machines if machine["status"] == "running"),
        "idle": sum(1 for machine in machines if machine["status"] == "idle"),
        "error": sum(1 for machine in machines if machine["status"] == "error"),
        "stopped": sum(1 for machine in machines if machine["status"] == "stopped"),
    }

    return {
        "machines": machines,
        "summary": summary,
        "timestamp": snapshot.get("timestamp") or _now_iso(),
    }


@router.get("/machines/{machine_id}")
async def get_machine(
    machine_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
):
    _ = current_user
    connector = get_connector()
    if not connector.is_connected:
        await connector.connect()

    snapshot = await connector.read_data()
    for machine in (snapshot.get("machines") or []):
        if int(machine.get("id") or 0) == machine_id:
            return _normalize_machine(machine)

    raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")


@router.get("/dashboard")
async def dashboard_data(
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
):
    _ = current_user
    connector = get_connector()
    if not connector.is_connected:
        await connector.connect()

    snapshot = await connector.read_data()
    pool = _get_pool(request)
    return _build_dashboard_payload(
        snapshot,
        request.app.state,
        pool=pool,
        include_recent=True,
    )


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


@router.get("/actions")
async def list_actions(
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _ = current_user
    pool = _get_pool(request)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id, a.alarm_id, a.action_type, a.diagnosis,
                       a.recommendation, a.confidence, a.is_hardware,
                       a.repair_steps, a.sources, a.created_at,
                       a.action_reason, a.action_payload, a.approval_info,
                       a.execution_status, a.execution_result,
                       a.before_state, a.after_state, a.policy_version,
                       a.executed_at,
                       al.error_code, al.message AS error_message, al.severity
                FROM ai_actions a
                LEFT JOIN plc_alarms al ON a.alarm_id = al.id
                ORDER BY a.created_at DESC
                LIMIT %s OFFSET %s
                """,
                [limit, offset],
            )
            rows = _rows_to_dicts(cur)

            cur.execute("SELECT COUNT(*) FROM ai_actions")
            total = cur.fetchone()[0]

        actions = [_normalize_action(row) for row in rows]
        return {"actions": actions, "total": total, "limit": limit, "offset": offset}
    finally:
        pool.putconn(conn)


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose_alarm(
    req: DiagnoseRequest,
    request: Request,
    current_user: dict = Depends(require_roles("operator")),
):
    retriever = _get_retriever(request)
    llm = _get_llm(request)

    context_data = {
        "machine_name": req.machine_name,
        "model": req.model,
        "category": req.category,
        "sensors": req.sensors,
    }

    result = await diagnose_error(
        error_code=req.error_code,
        error_message=req.error_message,
        context_data=context_data,
        retriever=retriever,
        llm=llm,
    )

    pool = _get_pool(request)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            alarm_id = None
            if req.machine_id:
                cur.execute(
                    """
                    SELECT id FROM plc_alarms
                    WHERE machine_id = %s AND error_code = %s AND status = 'active'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    [req.machine_id, req.error_code],
                )
                row = cur.fetchone()
                if row:
                    alarm_id = row[0]
                    cur.execute(
                        "UPDATE plc_alarms SET diagnosed_at = NOW() WHERE id = %s",
                        [alarm_id],
                    )

            if alarm_id is None:
                cur.execute(
                    """
                    INSERT INTO plc_alarms
                        (machine_id, error_code, severity, message, category,
                         status, raw_data, diagnosed_at, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'active', %s, NOW(), NOW())
                    RETURNING id
                    """,
                    [
                        req.machine_id or None,
                        req.error_code,
                        "critical" if result.get("is_hardware") else "error",
                        req.error_message,
                        req.category or result.get("issue_type") or "unknown",
                        json.dumps(
                            {
                                "machine_name": req.machine_name,
                                "model": req.model,
                                "sensors": req.sensors,
                            }
                        ),
                    ],
                )
                alarm_id = cur.fetchone()[0]

            cur.execute(
                """
                INSERT INTO ai_actions
                    (alarm_id, action_type, diagnosis, recommendation,
                     confidence, is_hardware, repair_steps, sources,
                     action_reason, action_payload, approval_info,
                     execution_status, execution_result, before_state,
                     after_state, policy_version, created_at, updated_at)
                VALUES (%s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, NOW(), NOW())
                """,
                [
                    alarm_id,
                    "diagnose",
                    result.get("diagnosis", ""),
                    result.get("recommendation", ""),
                    result.get("confidence", 0.0),
                    result.get("is_hardware", False),
                    json.dumps([]),
                    json.dumps(result.get("sources", [])),
                    "Diagnosis generated by AI diagnostic engine.",
                    json.dumps({}),
                    json.dumps(
                        {
                            "requested_by": current_user.get("id"),
                            "requested_at": _now_iso(),
                        }
                    ),
                    "diagnosed",
                    json.dumps({"success": True}),
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

    return DiagnoseResponse(**result)


@router.post("/actions/plan")
async def create_action_plan(
    payload: ActionPlanRequest,
    request: Request,
    current_user: dict = Depends(require_roles("operator")),
):
    if not _feature_enabled("FEATURE_AGENT_WORKFLOW", True):
        raise HTTPException(status_code=403, detail="Agent workflow is disabled")

    pool = _get_pool(request)
    alarm = None
    if payload.alarm_id is not None:
        alarm = _load_alarm_by_id(pool, payload.alarm_id)
        if alarm is None:
            raise HTTPException(status_code=404, detail="Alarm not found")

    raw_data = _safe_json((alarm or {}).get("raw_data"), {})

    plan_input = {
        "alarm_id": payload.alarm_id,
        "machine_id": payload.machine_id or (alarm or {}).get("machine_id") or 0,
        "machine_name": payload.machine_name or raw_data.get("machine_name") or "",
        "model": payload.model or raw_data.get("model") or "",
        "error_code": payload.error_code or (alarm or {}).get("error_code") or "",
        "error_message": payload.error_message or (alarm or {}).get("message") or "",
        "category": payload.category or (alarm or {}).get("category") or "unknown",
        "issue_type": payload.issue_type,
        "is_hardware": payload.issue_type.lower() == "hardware",
    }

    diagnosis_text = payload.diagnosis
    recommendation_text = payload.recommendation
    confidence = float(payload.confidence or 0.0)

    if not diagnosis_text:
        retriever = _get_retriever(request)
        llm = _get_llm(request)
        diag_result = await diagnose_error(
            error_code=plan_input["error_code"],
            error_message=plan_input["error_message"],
            context_data={
                "machine_name": plan_input["machine_name"],
                "model": plan_input["model"],
                "category": plan_input["category"],
                "sensors": payload.sensors or raw_data.get("sensors") or {},
            },
            retriever=retriever,
            llm=llm,
        )
        diagnosis_text = diag_result.get("diagnosis", "")
        recommendation_text = diag_result.get("recommendation", "")
        confidence = float(diag_result.get("confidence") or 0.0)
        plan_input["issue_type"] = diag_result.get("issue_type") or plan_input["issue_type"]
        plan_input["is_hardware"] = bool(diag_result.get("is_hardware"))

    plan = propose_safe_action_plan(plan_input)
    execution_status = "planned" if plan.get("allowed") else "requires_manual"

    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_actions
                    (alarm_id, action_type, diagnosis, recommendation,
                     confidence, is_hardware, repair_steps, sources,
                     action_reason, action_payload, approval_info,
                     execution_status, execution_result, before_state,
                     after_state, policy_version, created_at, updated_at)
                VALUES (%s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, NOW(), NOW())
                RETURNING id
                """,
                [
                    payload.alarm_id,
                    "plan",
                    diagnosis_text,
                    recommendation_text,
                    confidence,
                    plan.get("issue_type") == "hardware",
                    json.dumps(plan.get("checklist") or plan.get("steps") or []),
                    json.dumps([]),
                    plan.get("reason", ""),
                    json.dumps(plan.get("payload") or {}),
                    json.dumps(
                        {
                            "planned_by": current_user.get("id"),
                            "planned_at": _now_iso(),
                        }
                    ),
                    execution_status,
                    json.dumps({"success": True, "message": "Plan generated"}),
                    json.dumps({}),
                    json.dumps({}),
                    plan.get("policy_version") or POLICY_VERSION,
                ],
            )
            action_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

    return {
        "action_id": action_id,
        "alarm_id": payload.alarm_id,
        "issue_type": plan.get("issue_type"),
        "execution_status": execution_status,
        "diagnosis": diagnosis_text,
        "recommendation": recommendation_text,
        "confidence": confidence,
        "plan": plan,
    }


@router.post("/actions/{action_id}/approve")
async def approve_action(
    action_id: int,
    payload: ActionApproveRequest,
    request: Request,
    current_user: dict = Depends(require_roles("operator")),
):
    if not _feature_enabled("FEATURE_AGENT_WORKFLOW", True):
        raise HTTPException(status_code=403, detail="Agent workflow is disabled")

    pool = _get_pool(request)
    action = _load_action_by_id(pool, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")

    action_payload = _safe_json(action.get("action_payload"), {})
    if not isinstance(action_payload, dict) or not action_payload:
        raise HTTPException(status_code=400, detail="Action payload is empty or invalid")

    execution_enabled = _feature_enabled("FEATURE_AUTOFIX_EXECUTION", False)
    dry_run = payload.dry_run if payload.dry_run is not None else (not execution_enabled)

    connector = get_connector()
    if not connector.is_connected:
        await connector.connect()

    exec_payload = dict(action_payload)
    exec_payload["dry_run"] = dry_run
    result = await connector.execute_action(exec_payload)

    success = bool(result.get("success"))
    if dry_run:
        execution_status = "simulated"
    else:
        execution_status = "executed" if success else "failed"

    approval_info = _safe_json(action.get("approval_info"), {})
    approval_info.update(
        {
            "approved_by": current_user.get("id"),
            "approved_at": _now_iso(),
            "reason": payload.reason or "Approved by operator",
            "dry_run": dry_run,
        }
    )

    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ai_actions
                SET approval_info = %s,
                    execution_status = %s,
                    execution_result = %s,
                    before_state = %s,
                    after_state = %s,
                    executed_at = NOW(),
                    updated_at = NOW(),
                    action_reason = COALESCE(NULLIF(action_reason, ''), %s)
                WHERE id = %s
                """,
                [
                    json.dumps(approval_info),
                    execution_status,
                    json.dumps(result),
                    json.dumps(result.get("before_state") or {}),
                    json.dumps(result.get("after_state") or {}),
                    payload.reason or "Approved by operator",
                    action_id,
                ],
            )

            alarm_id = action.get("alarm_id")
            if alarm_id and success and not dry_run:
                cur.execute(
                    """
                    UPDATE plc_alarms
                    SET status = 'resolved',
                        resolved_at = NOW(),
                        diagnosed_at = COALESCE(diagnosed_at, NOW())
                    WHERE id = %s
                    """,
                    [alarm_id],
                )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

    updated_action = _load_action_by_id(pool, action_id)
    return {
        "action": _normalize_action(updated_action or action),
        "result": result,
    }


# ────────────────────────────────
# WebSocket — Real-time Data Feed
# ────────────────────────────────

class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)
        logger.info("[WS] Client connected (%d total)", len(self.active_connections))

    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections:
            self.active_connections.remove(ws)
        logger.info("[WS] Client disconnected (%d remaining)", len(self.active_connections))


ws_manager = ConnectionManager()


@router.websocket("/ws")
async def plc_websocket(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    host = websocket.headers.get("host")
    if not _is_ws_origin_allowed(origin=origin, host=host):
        logger.warning("[WS] Blocked origin '%s' for host '%s'", origin, host)
        await websocket.close(code=1008)
        return

    user = authenticate_websocket(websocket)
    if user is None:
        logger.warning("[WS] Rejected unauthenticated websocket connection")
        await websocket.close(code=1008)
        return

    if str(user.get("role", "viewer")).lower() not in {"viewer", "operator", "admin"}:
        logger.warning("[WS] Rejected websocket role '%s'", user.get("role"))
        await websocket.close(code=1008)
        return

    await ws_manager.connect(websocket)
    connector = get_connector()
    if not connector.is_connected:
        await connector.connect()

    try:
        while True:
            snapshot = await connector.read_data()
            payload = _build_dashboard_payload(
                snapshot,
                websocket.app.state,
                pool=None,
                include_recent=False,
            )
            await websocket.send_json(payload)

            await asyncio.sleep(1.5)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("[WS] Error: %s", exc)
        ws_manager.disconnect(websocket)
