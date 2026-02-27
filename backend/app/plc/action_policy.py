"""
Safe action planning policy for PLC auto-fix workflow.

This module intentionally exposes only allowlisted software actions.
Hardware issues are always converted to technician checklist guidance.
"""

from __future__ import annotations

from typing import Any, Dict, List

POLICY_VERSION = "v1-safe-actions"

ALLOWED_SOFTWARE_ACTIONS = {
    "reset_alarm_flag": {
        "title": "Reset alarm flag",
        "description": "Clear active alarm state for software-level recovery.",
        "steps": [
            "Capture current alarm and runtime snapshot.",
            "Clear the software alarm flag in PLC runtime state.",
            "Verify machine state transitions out of error mode.",
            "Record before/after state for audit trail.",
        ],
    },
    "restart_communication_channel": {
        "title": "Restart communication channel",
        "description": "Restart communication stack and refresh link parameters.",
        "steps": [
            "Capture link diagnostics and active communication alarms.",
            "Restart communication channel for target machine.",
            "Reload link parameters and perform heartbeat check.",
            "Record before/after communication status.",
        ],
    },
    "reload_soft_parameters": {
        "title": "Reload software parameters",
        "description": "Reload runtime parameters without hardware intervention.",
        "steps": [
            "Capture current software parameter state.",
            "Reload runtime parameter profile for the machine.",
            "Re-run diagnostics for previous error code.",
            "Record before/after parameter validation.",
        ],
    },
}


HARDWARE_CHECKLIST = [
    "Lockout/tagout before touching the panel.",
    "Inspect wiring, fuse state, and terminals around affected module.",
    "Check RUN/ERR/LINK LEDs and compare with manual diagnostics.",
    "Replace/repair failed component and confirm alarm clears.",
]


def _is_hardware_issue(issue_type: str, category: str, is_hardware: bool) -> bool:
    normalized_issue = (issue_type or "").strip().lower()
    normalized_category = (category or "").strip().lower()
    return (
        bool(is_hardware)
        or normalized_issue == "hardware"
        or normalized_category == "hardware"
    )


def _pick_action_name(error_message: str, category: str) -> str:
    text = f"{error_message or ''} {category or ''}".lower()
    if any(token in text for token in ("comm", "link", "network", "serial", "ethernet")):
        return "restart_communication_channel"
    if any(token in text for token in ("parameter", "assignment", "config", "setting")):
        return "reload_soft_parameters"
    return "reset_alarm_flag"


def propose_safe_action_plan(payload: Dict[str, Any]) -> Dict[str, Any]:
    issue_type = str(payload.get("issue_type") or "unknown").lower()
    category = str(payload.get("category") or "unknown").lower()
    is_hardware = bool(payload.get("is_hardware"))
    machine_id = int(payload.get("machine_id") or 0)
    machine_name = str(payload.get("machine_name") or "Unknown machine")
    error_code = str(payload.get("error_code") or "")
    error_message = str(payload.get("error_message") or "")

    if _is_hardware_issue(issue_type, category, is_hardware):
        return {
            "policy_version": POLICY_VERSION,
            "allowed": False,
            "plan_type": "manual",
            "issue_type": "hardware",
            "title": "Manual hardware intervention required",
            "reason": (
                f"Error {error_code} is classified as hardware. "
                "Auto-fix execution is blocked by policy."
            ).strip(),
            "checklist": HARDWARE_CHECKLIST,
            "payload": {},
            "steps": [],
        }

    action_name = _pick_action_name(error_message=error_message, category=category)
    spec = ALLOWED_SOFTWARE_ACTIONS[action_name]

    return {
        "policy_version": POLICY_VERSION,
        "allowed": True,
        "plan_type": "safe_execute",
        "issue_type": "software",
        "title": spec["title"],
        "reason": (
            f"Policy selected '{action_name}' for software issue on {machine_name}."
        ),
        "steps": spec["steps"],
        "checklist": [],
        "payload": {
            "action_name": action_name,
            "machine_id": machine_id,
            "machine_name": machine_name,
            "error_code": error_code,
            "params": {
                "category": category,
                "error_message": error_message,
            },
        },
    }


def get_allowed_action_names() -> List[str]:
    return sorted(ALLOWED_SOFTWARE_ACTIONS.keys())
