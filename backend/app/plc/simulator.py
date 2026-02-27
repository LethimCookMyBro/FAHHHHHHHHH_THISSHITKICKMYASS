"""
Mitsubishi PLC Simulator — generates realistic PLC data for development.

Simulates multiple machines with:
- Machine states: RUN / STOP / ERROR / IDLE
- Sensor readings: temperature, current, vibration, pressure
- Mitsubishi-specific error codes (FX3U, iQ-R series)
- Random alarm events that trigger AI diagnosis
"""

import random
import time
import threading
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float, min_value: float, max_value: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(max_value, value))


SIMULATOR_ALARM_PROBABILITY = _env_float("SIMULATOR_ALARM_PROBABILITY", 0.03, 0.0, 1.0)
SIMULATOR_LOG_ALARM_EVENTS = _env_bool("SIMULATOR_LOG_ALARM_EVENTS", False)

# ──────────────────────────────────────────────
# Mitsubishi Error Code Database
# ──────────────────────────────────────────────
MITSUBISHI_ERRORS = [
    # FX3U Series
    {
        "code": "6101",
        "message": "SP.UNIT LAYOUT ERR",
        "description": "Special function module configuration error",
        "category": "hardware",
        "severity": "error",
        "series": "FX3U",
    },
    {
        "code": "6102",
        "message": "CAN'T USE SP.UNIT",
        "description": "Special function module cannot be used",
        "category": "hardware",
        "severity": "error",
        "series": "FX3U",
    },
    {
        "code": "6103",
        "message": "SP.UNIT FUSE BLOWN",
        "description": "Special adapter fuse blown",
        "category": "hardware",
        "severity": "critical",
        "series": "FX3U",
    },
    {
        "code": "6104",
        "message": "24V DC FUSE BLOWN",
        "description": "24V DC service power supply fuse blown",
        "category": "hardware",
        "severity": "critical",
        "series": "FX3U",
    },
    {
        "code": "6207",
        "message": "PARAMETER ERROR",
        "description": "Parameter setting error in PLC configuration",
        "category": "software",
        "severity": "error",
        "series": "FX3U",
    },
    {
        "code": "6210",
        "message": "I/O ASSIGNMENT ERR",
        "description": "I/O assignment error – module mismatch",
        "category": "software",
        "severity": "error",
        "series": "FX3U",
    },
    {
        "code": "6220",
        "message": "LINK PARA. ERROR",
        "description": "CC-Link parameter out of range or conflict",
        "category": "communication",
        "severity": "warning",
        "series": "FX3U",
    },
    {
        "code": "6232",
        "message": "SERIAL COMM. ERR",
        "description": "Serial communication timeout or frame error",
        "category": "communication",
        "severity": "warning",
        "series": "FX3U",
    },
    # iQ-R Series
    {
        "code": "1000",
        "message": "UNIT VERIFY ERR",
        "description": "Module hardware verification failure",
        "category": "hardware",
        "severity": "critical",
        "series": "iQ-R",
    },
    {
        "code": "1010",
        "message": "MAIN CPU DOWN",
        "description": "CPU watchdog timeout – CPU is not responding",
        "category": "hardware",
        "severity": "critical",
        "series": "iQ-R",
    },
    {
        "code": "1604",
        "message": "OPR. CIRCUIT ERR",
        "description": "Arithmetic operation error in ladder program",
        "category": "software",
        "severity": "error",
        "series": "iQ-R",
    },
    {
        "code": "1610",
        "message": "PRG. TIME OVER",
        "description": "Program scan time exceeded watchdog limit",
        "category": "software",
        "severity": "error",
        "series": "iQ-R",
    },
    {
        "code": "1632",
        "message": "FILE ACCESS ERR",
        "description": "Cannot read/write to memory card or flash",
        "category": "software",
        "severity": "warning",
        "series": "iQ-R",
    },
    {
        "code": "2010",
        "message": "CC-LINK DISCONNECT",
        "description": "CC-Link IE station disconnected from network",
        "category": "communication",
        "severity": "error",
        "series": "iQ-R",
    },
    {
        "code": "2020",
        "message": "ETHERNET DISCONNECT",
        "description": "Ethernet port link down",
        "category": "communication",
        "severity": "warning",
        "series": "iQ-R",
    },
    {
        "code": "3100",
        "message": "MOTOR OVERLOAD",
        "description": "Servo motor current exceeds rated value",
        "category": "hardware",
        "severity": "error",
        "series": "iQ-R",
    },
    {
        "code": "3200",
        "message": "INVERTER FAULT",
        "description": "Variable frequency drive fault detected",
        "category": "hardware",
        "severity": "critical",
        "series": "iQ-R",
    },
    {
        "code": "3300",
        "message": "SENSOR FAULT",
        "description": "Analog input sensor out of range or disconnected",
        "category": "hardware",
        "severity": "warning",
        "series": "iQ-R",
    },
]

# ──────────────────────────────────────────────
# Machine Templates
# ──────────────────────────────────────────────
MACHINE_TEMPLATES = [
    {
        "id": 1,
        "name": "Conveyor Line A",
        "plc_type": "mitsubishi",
        "model": "FX3U-64M",
        "location": "Zone A – Assembly",
    },
    {
        "id": 2,
        "name": "Packaging Robot B",
        "plc_type": "mitsubishi",
        "model": "iQ-R R08CPU",
        "location": "Zone B – Packaging",
    },
    {
        "id": 3,
        "name": "CNC Machine C",
        "plc_type": "mitsubishi",
        "model": "iQ-R R16CPU",
        "location": "Zone C – Machining",
    },
    {
        "id": 4,
        "name": "Air Quality Monitor",
        "plc_type": "siemens",
        "model": "S7-1200",
        "location": "Zone D – Environment",
    },
]

STATES = ["RUN", "STOP", "IDLE", "ERROR"]
STATE_WEIGHTS = [0.60, 0.10, 0.20, 0.10]


class MachineState:
    """Runtime state for a single simulated machine."""

    __slots__ = (
        "id", "name", "plc_type", "model", "location",
        "status", "uptime_start", "production_count", "production_target",
        "temp", "current", "vibration", "pressure",
        "active_error",
    )

    def __init__(self, template: dict):
        self.id: int = template["id"]
        self.name: str = template["name"]
        self.plc_type: str = template["plc_type"]
        self.model: str = template["model"]
        self.location: str = template["location"]
        self.status: str = "IDLE"
        self.uptime_start: float = time.time()
        self.production_count: int = 0
        self.production_target: int = random.randint(800, 1500)
        self.temp: float = 35.0
        self.current: float = 5.0
        self.vibration: float = 0.5
        self.pressure: float = 4.5
        self.active_error: Optional[dict] = None

    def tick(self) -> Optional[dict]:
        """
        Advance one simulation tick (~1-2s).
        Returns an alarm dict if a new error was triggered, else None.
        """
        new_alarm = None

        # State transitions
        if self.status == "ERROR":
            # 15% chance to auto-recover from error
            if random.random() < 0.15:
                self.active_error = None
                self.status = random.choices(["RUN", "IDLE"], [0.7, 0.3])[0]
        else:
            # Small chance to trigger a new error
            if random.random() < SIMULATOR_ALARM_PROBABILITY:
                series = "iQ-R" if "iQ-R" in self.model else "FX3U"
                candidates = [e for e in MITSUBISHI_ERRORS if e["series"] == series]
                if not candidates:
                    candidates = MITSUBISHI_ERRORS
                err = random.choice(candidates)
                self.status = "ERROR"
                self.active_error = err
                new_alarm = {
                    "machine_id": self.id,
                    "machine_name": self.name,
                    "error_code": err["code"],
                    "message": err["message"],
                    "description": err["description"],
                    "category": err["category"],
                    "severity": err["severity"],
                    "series": err["series"],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            else:
                # Normal state changes
                if random.random() < 0.05:
                    self.status = random.choices(STATES[:3], STATE_WEIGHTS[:3])[0]

        # Sensor drift
        if self.status == "RUN":
            self.temp += random.uniform(-0.5, 0.8)
            self.current += random.uniform(-0.3, 0.4)
            self.vibration += random.uniform(-0.1, 0.15)
            self.pressure += random.uniform(-0.1, 0.1)
            self.production_count += random.randint(0, 3)
        elif self.status == "ERROR":
            self.temp += random.uniform(0, 1.5)
            self.current += random.uniform(0.2, 0.8)
            self.vibration += random.uniform(0.1, 0.5)

        # Clamp values
        self.temp = max(20.0, min(95.0, self.temp))
        self.current = max(0.5, min(25.0, self.current))
        self.vibration = max(0.1, min(10.0, self.vibration))
        self.pressure = max(1.0, min(8.0, self.pressure))

        return new_alarm

    def to_dict(self) -> dict:
        uptime_seconds = int(time.time() - self.uptime_start)
        hours, remainder = divmod(uptime_seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        return {
            "id": self.id,
            "name": self.name,
            "plc_type": self.plc_type,
            "model": self.model,
            "location": self.location,
            "status": self.status,
            "uptime": f"{hours}h {minutes}m",
            "production_count": self.production_count,
            "production_target": self.production_target,
            "sensors": {
                "temperature": round(self.temp, 1),
                "current": round(self.current, 2),
                "vibration": round(self.vibration, 2),
                "pressure": round(self.pressure, 2),
            },
            "active_error": self.active_error,
            "last_heartbeat": datetime.now(timezone.utc).isoformat(),
        }


class MitsubishiSimulator:
    """
    Simulates a factory floor with multiple Mitsubishi PLC-controlled machines.
    Runs in a background thread, generates data every ~1 second.
    """

    def __init__(self):
        self._machines: List[MachineState] = [
            MachineState(t) for t in MACHINE_TEMPLATES
        ]
        self._alarm_buffer: List[dict] = []
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("[Simulator] Started — %d machines online", len(self._machines))

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
        logger.info("[Simulator] Stopped")

    def _run_loop(self):
        while self._running:
            with self._lock:
                for machine in self._machines:
                    alarm = machine.tick()
                    if alarm:
                        self._alarm_buffer.append(alarm)
                        if SIMULATOR_LOG_ALARM_EVENTS:
                            logger.warning(
                                "[Simulator] ALARM on %s: %s - %s",
                                alarm["machine_name"],
                                alarm["error_code"],
                                alarm["message"],
                            )
            time.sleep(random.uniform(1.0, 2.0))

    def snapshot(self) -> Dict[str, Any]:
        """Return current state of all machines + pending alarms."""
        with self._lock:
            machines = [m.to_dict() for m in self._machines]
            alarms = list(self._alarm_buffer)
            self._alarm_buffer.clear()

        # Compute OEE
        running = sum(1 for m in machines if m["status"] == "RUN")
        total = len(machines)
        availability = running / total if total else 0
        performance = sum(
            m["production_count"] / max(m["production_target"], 1)
            for m in machines
        ) / total if total else 0
        quality = random.uniform(0.92, 0.99)  # simulated
        oee = availability * performance * quality

        return {
            "machines": machines,
            "alarms": alarms,
            "oee": {
                "overall": round(oee * 100, 1),
                "availability": round(availability * 100, 1),
                "performance": round(min(performance * 100, 100), 1),
                "quality": round(quality * 100, 1),
            },
            "summary": {
                "total_machines": total,
                "running": running,
                "idle": sum(1 for m in machines if m["status"] == "IDLE"),
                "error": sum(1 for m in machines if m["status"] == "ERROR"),
                "stopped": sum(1 for m in machines if m["status"] == "STOP"),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def get_machines(self) -> List[dict]:
        with self._lock:
            return [m.to_dict() for m in self._machines]

    def get_machine(self, machine_id: int) -> Optional[dict]:
        with self._lock:
            for m in self._machines:
                if m.id == machine_id:
                    return m.to_dict()
        return None

    def _find_machine_locked(self, machine_id: int) -> Optional[MachineState]:
        for machine in self._machines:
            if machine.id == machine_id:
                return machine
        return None

    def execute_safe_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute allowlisted safe actions in simulator mode.
        This mutates runtime simulator state and returns before/after snapshots.
        """
        action_name = str(action.get("action_name") or "").strip()
        machine_id = int(action.get("machine_id") or 0)
        dry_run = bool(action.get("dry_run", False))

        with self._lock:
            machine = self._find_machine_locked(machine_id)
            if machine is None:
                return {
                    "success": False,
                    "message": f"Machine {machine_id} not found",
                    "before_state": {},
                    "after_state": {},
                    "action": action,
                }

            before_state = machine.to_dict()

            if dry_run:
                return {
                    "success": True,
                    "message": "Dry-run only. No simulator state was changed.",
                    "before_state": before_state,
                    "after_state": before_state,
                    "action": action,
                }

            if action_name == "reset_alarm_flag":
                machine.active_error = None
                if machine.status == "ERROR":
                    machine.status = "IDLE"
                message = "Reset alarm flag completed in simulator."
                success = True
            elif action_name == "restart_communication_channel":
                if machine.active_error and machine.active_error.get("category") == "communication":
                    machine.active_error = None
                    machine.status = "IDLE"
                    message = "Communication channel restarted and alarm cleared."
                else:
                    message = "Communication channel restarted. No communication alarm was active."
                success = True
            elif action_name == "reload_soft_parameters":
                if machine.active_error and machine.active_error.get("category") in {"software", "communication"}:
                    machine.active_error = None
                    machine.status = "IDLE"
                    message = "Software parameters reloaded and error cleared."
                else:
                    message = "Software parameters reloaded."
                success = True
            else:
                return {
                    "success": False,
                    "message": f"Action '{action_name}' is not allowlisted for simulator execution.",
                    "before_state": before_state,
                    "after_state": before_state,
                    "action": action,
                }

            # Normalize physical metrics toward stable state after software fix.
            machine.temp = max(20.0, machine.temp - random.uniform(0.2, 0.8))
            machine.current = max(0.5, machine.current - random.uniform(0.1, 0.4))
            machine.vibration = max(0.1, machine.vibration - random.uniform(0.05, 0.2))
            after_state = machine.to_dict()

        return {
            "success": success,
            "message": message,
            "before_state": before_state,
            "after_state": after_state,
            "action": action,
        }
