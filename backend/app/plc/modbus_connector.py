"""
Modbus TCP connector implementation for production PLC integration.
"""

from __future__ import annotations

import logging
import os
import struct
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .action_policy import get_allowed_action_names
from .connector import PLCConnector
from .mapping import ActionWriteMapping, MachineMapping, PlcMappingConfig, load_plc_mapping

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional runtime dependency
    from pymodbus.client import AsyncModbusTcpClient
except Exception:  # pragma: no cover
    AsyncModbusTcpClient = None


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ModbusTcpConnector(PLCConnector):
    def __init__(
        self,
        *,
        host: str,
        port: int,
        timeout: float,
        mapping: PlcMappingConfig,
        dry_run_default: bool = True,
    ):
        self._host = host
        self._port = int(port)
        self._timeout = float(timeout)
        self._mapping = mapping
        self._dry_run_default = bool(dry_run_default)
        self._client = None
        self._connected = False
        self._last_snapshot: Dict[str, Any] = {
            "machines": [],
            "alarms": [],
            "oee": {
                "overall": 0.0,
                "availability": 0.0,
                "performance": 0.0,
                "quality": 100.0,
            },
            "summary": {
                "total_machines": 0,
                "running": 0,
                "idle": 0,
                "error": 0,
                "stopped": 0,
            },
            "timestamp": _utc_now(),
        }

    @classmethod
    def from_env(cls) -> "ModbusTcpConnector":
        mapping = load_plc_mapping()
        return cls(
            host=(os.getenv("PLC_MODBUS_HOST", "127.0.0.1") or "127.0.0.1").strip(),
            port=int(os.getenv("PLC_MODBUS_PORT", "502")),
            timeout=float(os.getenv("PLC_MODBUS_TIMEOUT_SECONDS", "1.5")),
            mapping=mapping,
            dry_run_default=_env_bool("PLC_DRY_RUN_DEFAULT", True),
        )

    @property
    def is_connected(self) -> bool:
        return bool(self._connected)

    async def connect(self) -> bool:
        if self._connected:
            return True

        if AsyncModbusTcpClient is None:
            raise RuntimeError(
                "pymodbus is not installed. Install pymodbus to use PLC_CONNECTOR=modbus_tcp."
            )

        client = AsyncModbusTcpClient(
            host=self._host,
            port=self._port,
            timeout=self._timeout,
        )
        connected = await client.connect()
        if not connected:
            raise RuntimeError(f"Could not connect to Modbus TCP endpoint {self._host}:{self._port}")

        self._client = client
        self._connected = True
        logger.info("[ModbusConnector] Connected to %s:%s", self._host, self._port)
        return True

    async def disconnect(self) -> None:
        client = self._client
        self._client = None
        self._connected = False
        if client is not None:
            try:
                await client.close()
            except Exception:
                try:
                    client.close()
                except Exception:
                    pass
        logger.info("[ModbusConnector] Disconnected")

    async def _ensure_connected(self) -> None:
        if self._connected and self._client is not None:
            return
        await self.connect()

    @staticmethod
    def _decode_registers(registers: List[int], data_type: str) -> Any:
        if not registers:
            return 0

        if data_type == "bool":
            return int(registers[0]) != 0

        if data_type == "uint16":
            return int(registers[0]) & 0xFFFF

        if data_type == "int16":
            value = int(registers[0]) & 0xFFFF
            if value >= 0x8000:
                value -= 0x10000
            return value

        if data_type == "float32":
            if len(registers) < 2:
                return 0.0
            raw = ((int(registers[0]) & 0xFFFF) << 16) | (int(registers[1]) & 0xFFFF)
            packed = raw.to_bytes(4, byteorder="big", signed=False)
            return float(struct.unpack(">f", packed)[0])

        return int(registers[0])

    async def _read_raw_register(self, machine: MachineMapping, key: str) -> Any:
        reg = machine.registers.get(key)
        if reg is None:
            return None

        unit_id = reg.unit_id or machine.unit_id
        client = self._client
        if client is None:
            raise RuntimeError("Modbus client is not connected")

        if reg.function == "holding":
            resp = await client.read_holding_registers(
                address=reg.address,
                count=reg.length,
                slave=unit_id,
            )
            if getattr(resp, "isError", lambda: True)():
                raise RuntimeError(f"Read holding registers failed for machine={machine.id} key={key}")
            raw_value = self._decode_registers(list(resp.registers or []), reg.data_type)
        elif reg.function == "input":
            resp = await client.read_input_registers(
                address=reg.address,
                count=reg.length,
                slave=unit_id,
            )
            if getattr(resp, "isError", lambda: True)():
                raise RuntimeError(f"Read input registers failed for machine={machine.id} key={key}")
            raw_value = self._decode_registers(list(resp.registers or []), reg.data_type)
        elif reg.function == "coil":
            resp = await client.read_coils(
                address=reg.address,
                count=1,
                slave=unit_id,
            )
            if getattr(resp, "isError", lambda: True)():
                raise RuntimeError(f"Read coil failed for machine={machine.id} key={key}")
            bits = list(resp.bits or [])
            raw_value = bool(bits[0]) if bits else False
        elif reg.function == "discrete":
            resp = await client.read_discrete_inputs(
                address=reg.address,
                count=1,
                slave=unit_id,
            )
            if getattr(resp, "isError", lambda: True)():
                raise RuntimeError(f"Read discrete input failed for machine={machine.id} key={key}")
            bits = list(resp.bits or [])
            raw_value = bool(bits[0]) if bits else False
        else:  # pragma: no cover - protected by schema
            raise RuntimeError(f"Unsupported function '{reg.function}'")

        if isinstance(raw_value, (int, float)):
            return (float(raw_value) * float(reg.scale)) + float(reg.offset)
        return raw_value

    async def _write_action_mapping(
        self,
        machine: MachineMapping,
        write_map: ActionWriteMapping,
    ) -> None:
        client = self._client
        if client is None:
            raise RuntimeError("Modbus client is not connected")

        unit_id = write_map.unit_id or machine.unit_id
        if write_map.function == "holding":
            resp = await client.write_register(
                address=write_map.address,
                value=int(write_map.value),
                slave=unit_id,
            )
            if getattr(resp, "isError", lambda: True)():
                raise RuntimeError(
                    f"Write register failed for machine={machine.id} address={write_map.address}"
                )
            return

        if write_map.function == "coil":
            resp = await client.write_coil(
                address=write_map.address,
                value=bool(write_map.value),
                slave=unit_id,
            )
            if getattr(resp, "isError", lambda: True)():
                raise RuntimeError(
                    f"Write coil failed for machine={machine.id} address={write_map.address}"
                )
            return

        raise RuntimeError(f"Unsupported write function '{write_map.function}'")

    async def _read_machine(self, machine: MachineMapping) -> Dict[str, Any]:
        status_raw = await self._read_raw_register(machine, "status")
        status_code = int(status_raw or 0)
        status = str(machine.status_map.get(status_code, "IDLE")).upper()

        temp = await self._read_raw_register(machine, "temperature")
        current = await self._read_raw_register(machine, "current")
        vibration = await self._read_raw_register(machine, "vibration")
        pressure = await self._read_raw_register(machine, "pressure")
        production_count = await self._read_raw_register(machine, "production_count")
        production_target = await self._read_raw_register(machine, "production_target")

        return {
            "id": machine.id,
            "name": machine.name,
            "plc_type": machine.plc_type,
            "model": machine.model,
            "location": machine.location,
            "status": status,
            "uptime": "",
            "production_count": int(production_count or 0),
            "production_target": int(production_target or 0),
            "sensors": {
                "temperature": round(float(temp or 0.0), 2),
                "current": round(float(current or 0.0), 2),
                "vibration": round(float(vibration or 0.0), 2),
                "pressure": round(float(pressure or 0.0), 2),
            },
            "active_error": None if status != "ERROR" else {"code": "MODBUS_ERROR"},
            "last_heartbeat": _utc_now(),
        }

    @staticmethod
    def _build_summary(machines: List[Dict[str, Any]]) -> Dict[str, int]:
        running = sum(1 for machine in machines if machine.get("status") == "RUN")
        idle = sum(1 for machine in machines if machine.get("status") == "IDLE")
        error = sum(1 for machine in machines if machine.get("status") == "ERROR")
        stopped = sum(1 for machine in machines if machine.get("status") == "STOP")
        return {
            "total_machines": len(machines),
            "running": running,
            "idle": idle,
            "error": error,
            "stopped": stopped,
        }

    async def read_data(self) -> Dict[str, Any]:
        await self._ensure_connected()

        machines: List[Dict[str, Any]] = []
        alarms: List[Dict[str, Any]] = []

        for machine in self._mapping.machines:
            try:
                machines.append(await self._read_machine(machine))
            except Exception as exc:
                logger.warning(
                    "[ModbusConnector] machine=%s read failed: %s",
                    machine.id,
                    exc,
                )
                alarms.append(
                    {
                        "machine_id": machine.id,
                        "machine_name": machine.name,
                        "error_code": "MODBUS_READ_ERROR",
                        "message": str(exc),
                        "category": "communication",
                        "severity": "error",
                        "status": "active",
                        "timestamp": _utc_now(),
                    }
                )
                machines.append(
                    {
                        "id": machine.id,
                        "name": machine.name,
                        "plc_type": machine.plc_type,
                        "model": machine.model,
                        "location": machine.location,
                        "status": "ERROR",
                        "uptime": "",
                        "production_count": 0,
                        "production_target": 0,
                        "sensors": {
                            "temperature": 0.0,
                            "current": 0.0,
                            "vibration": 0.0,
                            "pressure": 0.0,
                        },
                        "active_error": {"code": "MODBUS_READ_ERROR", "message": str(exc)},
                        "last_heartbeat": _utc_now(),
                    }
                )

        summary = self._build_summary(machines)
        availability = (
            float(summary["running"]) / float(summary["total_machines"])
            if summary["total_machines"] > 0
            else 0.0
        )
        performance = 0.0
        if summary["total_machines"] > 0:
            performance = sum(
                float(machine.get("production_count") or 0)
                / max(1.0, float(machine.get("production_target") or 1))
                for machine in machines
            ) / float(summary["total_machines"])
        quality = 1.0
        oee = availability * min(performance, 1.0) * quality

        payload = {
            "machines": machines,
            "alarms": alarms,
            "summary": summary,
            "oee": {
                "overall": round(oee * 100.0, 2),
                "availability": round(availability * 100.0, 2),
                "performance": round(min(performance, 1.0) * 100.0, 2),
                "quality": round(quality * 100.0, 2),
            },
            "timestamp": _utc_now(),
        }
        self._last_snapshot = payload
        return payload

    async def write_data(self, address: str, value: Any) -> bool:
        # Generic write is intentionally blocked unless explicitly mapped.
        logger.warning("[ModbusConnector] Generic write blocked: address=%s value=%s", address, value)
        return False

    async def execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        await self._ensure_connected()

        action_name = str(action.get("action_name") or "").strip()
        machine_id = int(action.get("machine_id") or 0)
        dry_run = bool(action.get("dry_run", self._dry_run_default))

        if not action_name:
            return {
                "success": False,
                "message": "action_name is required",
                "before_state": {},
                "after_state": {},
                "action": action,
            }

        allowed_names = set(get_allowed_action_names())
        if action_name not in allowed_names:
            return {
                "success": False,
                "message": f"Action '{action_name}' is not in safe allowlist.",
                "before_state": {},
                "after_state": {},
                "action": action,
            }

        machine = next((m for m in self._mapping.machines if m.id == machine_id), None)
        if machine is None:
            return {
                "success": False,
                "message": f"Machine mapping not found for id={machine_id}",
                "before_state": {},
                "after_state": {},
                "action": action,
            }

        before_state = await self._read_machine(machine)
        write_map = machine.action_writes.get(action_name)
        if write_map is None:
            return {
                "success": False,
                "message": f"Action '{action_name}' is not mapped for machine {machine_id}",
                "before_state": before_state,
                "after_state": before_state,
                "action": action,
            }

        if dry_run:
            return {
                "success": True,
                "message": "Dry-run only. No Modbus write executed.",
                "before_state": before_state,
                "after_state": before_state,
                "action": action,
            }

        try:
            await self._write_action_mapping(machine, write_map)
            after_state = await self._read_machine(machine)
            return {
                "success": True,
                "message": "Modbus action executed successfully.",
                "before_state": before_state,
                "after_state": after_state,
                "action": action,
            }
        except Exception as exc:
            logger.error("[ModbusConnector] execute_action failed: %s", exc, exc_info=True)
            return {
                "success": False,
                "message": str(exc),
                "before_state": before_state,
                "after_state": before_state,
                "action": action,
            }

