"""
PLC API Routes — REST endpoints + WebSocket for real-time PLC data.

This module exposes a normalized contract for frontend consumption and
adds safe AI-agent workflow endpoints:
- diagnose -> plan -> approve/execute
- hardware acknowledge
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, model_validator

from .plc.connector import get_connector
from .plc.contracts import (
    _normalize_action,
    _normalize_alarm,
    _normalize_machine,
    _to_float,
)
from .core.plc_snapshot import get_plc_snapshot
from .security import authenticate_websocket

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

from .routes_plc_data import router as data_router
from .routes_plc_alarms import router as alarms_router
from .routes_plc_actions import router as actions_router

router.include_router(data_router)
router.include_router(alarms_router)
router.include_router(actions_router)


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

    try:
        while True:
            snapshot = await get_plc_snapshot(websocket.app.state, connector)
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
