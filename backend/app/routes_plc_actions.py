import json
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from .security import require_roles
from .plc.connector import get_connector
from .plc.contracts import _normalize_action, _now_iso, _safe_json
from .plc.action_policy import POLICY_VERSION, propose_safe_action_plan
from .plc.diagnostic import diagnose_error
from .routes_plc import (
    _get_pool, _get_retriever, _get_llm, _feature_enabled,
    DiagnoseRequest, DiagnoseResponse, ActionPlanRequest, ActionApproveRequest
)

router = APIRouter()

def _rows_to_dicts(cur) -> List[dict[str, Any]]:
    columns = [desc[0] for desc in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]

def _load_alarm_by_id(pool, alarm_id: int) -> Optional[dict[str, Any]]:
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

def _load_action_by_id(pool, action_id: int) -> Optional[dict[str, Any]]:
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

    return {"status": execution_status, "result": result}
