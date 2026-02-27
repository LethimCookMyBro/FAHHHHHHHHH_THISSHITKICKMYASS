"""
Shared PLC API normalization helpers.

This module is dependency-light so it can be used by route handlers and tests
without importing the full FastAPI stack.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from .action_policy import POLICY_VERSION

_MACHINE_STATUS_MAP = {
    "run": "running",
    "running": "running",
    "idle": "idle",
    "error": "error",
    "stop": "stopped",
    "stopped": "stopped",
}

_ALARM_STATUS_VALUES = {"active", "acknowledged", "resolved"}


def _to_float(*values: Any, default: float = 0.0) -> float:
    for value in values:
        try:
            if value is None or value == "":
                continue
            return float(value)
        except Exception:
            continue
    return float(default)


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _normalize_machine_status(raw_status: Any) -> str:
    key = str(raw_status or "").strip().lower()
    return _MACHINE_STATUS_MAP.get(key, "idle")


def _normalize_alarm_status(raw_status: Any) -> str:
    key = str(raw_status or "active").strip().lower()
    if key in _ALARM_STATUS_VALUES:
        return key
    return "active"


def _safe_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            if isinstance(decoded, type(fallback)):
                return decoded
        except Exception:
            return fallback
    return fallback


def _normalize_machine(machine: Dict[str, Any]) -> Dict[str, Any]:
    sensors = machine.get("sensors") or {}
    raw_status = machine.get("status")
    status = _normalize_machine_status(raw_status)

    temp = _to_float(machine.get("temp"), sensors.get("temperature"), default=0.0)
    current = _to_float(machine.get("current"), sensors.get("current"), default=0.0)
    vibration = _to_float(machine.get("vibration"), sensors.get("vibration"), default=0.0)
    pressure = _to_float(machine.get("pressure"), sensors.get("pressure"), default=0.0)

    active_error = machine.get("active_error") or {}

    return {
        "id": machine.get("id"),
        "name": machine.get("name", "Unknown"),
        "model": machine.get("model", "Unknown"),
        "plc_type": machine.get("plc_type", "unknown"),
        "location": machine.get("location", ""),
        "status": status,
        "status_legacy": str(raw_status or "").upper(),
        "uptime": machine.get("uptime", ""),
        "production_count": int(machine.get("production_count") or 0),
        "production_target": int(machine.get("production_target") or 0),
        "temp": round(temp, 2),
        "current": round(current, 2),
        "vibration": round(vibration, 2),
        "pressure": round(pressure, 2),
        "sensors": {
            "temperature": round(temp, 2),
            "current": round(current, 2),
            "vibration": round(vibration, 2),
            "pressure": round(pressure, 2),
        },
        "active_error": active_error,
        "error_code": active_error.get("code") or active_error.get("error_code"),
        "last_heartbeat": machine.get("last_heartbeat"),
    }


def _normalize_alarm(alarm: Dict[str, Any]) -> Dict[str, Any]:
    created = _iso(alarm.get("created_at") or alarm.get("timestamp"))
    status = _normalize_alarm_status(alarm.get("status"))
    resolved_at = _iso(alarm.get("resolved_at"))
    diagnosed_at = _iso(alarm.get("diagnosed_at"))

    if resolved_at:
        status = "resolved"

    return {
        "id": alarm.get("id"),
        "machine_id": alarm.get("machine_id") or 0,
        "machine_name": alarm.get("machine_name", ""),
        "error_code": str(alarm.get("error_code") or "").strip(),
        "message": alarm.get("message") or alarm.get("error_message") or "",
        "error_message": alarm.get("message") or alarm.get("error_message") or "",
        "severity": str(alarm.get("severity") or "warning").lower(),
        "category": str(alarm.get("category") or "unknown").lower(),
        "status": status,
        "created_at": created,
        "timestamp": created,
        "diagnosed_at": diagnosed_at,
        "resolved_at": resolved_at,
        "acknowledged_at": _iso(alarm.get("acknowledged_at")),
        "acknowledge_note": alarm.get("acknowledge_note") or "",
        "raw_data": _safe_json(alarm.get("raw_data"), {}),
    }


def _normalize_action(action: Dict[str, Any]) -> Dict[str, Any]:
    is_hardware = bool(action.get("is_hardware"))
    issue_type = "hardware" if is_hardware else "software"
    execution_status = str(action.get("execution_status") or "planned").lower()

    return {
        "id": action.get("id"),
        "alarm_id": action.get("alarm_id"),
        "action_type": action.get("action_type") or "unknown",
        "issue_type": issue_type,
        "diagnosis": action.get("diagnosis") or "",
        "recommendation": action.get("recommendation") or "",
        "confidence": float(action.get("confidence") or 0.0),
        "is_hardware": is_hardware,
        "repair_steps": _safe_json(action.get("repair_steps"), []),
        "sources": _safe_json(action.get("sources"), []),
        "created_at": _iso(action.get("created_at")),
        "executed_at": _iso(action.get("executed_at")),
        "error_code": action.get("error_code") or "",
        "error_message": action.get("error_message") or action.get("message") or "",
        "message": action.get("error_message") or action.get("message") or "",
        "severity": action.get("severity") or "warning",
        "action_reason": action.get("action_reason") or "",
        "action_payload": _safe_json(action.get("action_payload"), {}),
        "approval_info": _safe_json(action.get("approval_info"), {}),
        "execution_status": execution_status,
        "execution_result": _safe_json(action.get("execution_result"), {}),
        "before_state": _safe_json(action.get("before_state"), {}),
        "after_state": _safe_json(action.get("after_state"), {}),
        "policy_version": action.get("policy_version") or POLICY_VERSION,
    }
