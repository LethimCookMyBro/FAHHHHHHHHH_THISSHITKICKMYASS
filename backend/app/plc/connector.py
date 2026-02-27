"""
Abstract PLC Connector layer.

Provides a unified interface for reading/writing PLC data regardless of
the underlying protocol (simulator, OPC-UA, Modbus TCP, MQTT).
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import logging
import os
import threading

logger = logging.getLogger(__name__)

# Singleton connector
_active_connector: Optional["PLCConnector"] = None
_active_connector_lock = threading.Lock()
_active_connector_type: Optional[str] = None


class PLCConnector(ABC):
    """Base class all PLC connectors must implement."""

    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection. Returns True on success."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Cleanly close the connection."""

    @abstractmethod
    async def read_data(self) -> Dict[str, Any]:
        """
        Read current snapshot from PLC.

        Returns dict with keys:
            machines: list of machine state dicts
            sensors:  list of sensor reading dicts
            alarms:   list of active alarm dicts (may be empty)
            timestamp: ISO-8601 string
        """

    @abstractmethod
    async def write_data(self, address: str, value: Any) -> bool:
        """
        Write a value back to the PLC (for future auto-fix).
        Returns True on success.
        """

    @abstractmethod
    async def execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a pre-approved safe action.
        Must return a structured result:
          {
            "success": bool,
            "message": str,
            "before_state": dict,
            "after_state": dict,
            "action": dict
          }
        """

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the connector is currently connected."""


class SimulatorConnector(PLCConnector):
    """
    Wraps MitsubishiSimulator behind the PLCConnector interface
    so the rest of the backend doesn't care if data is real or simulated.
    """

    def __init__(self):
        from .simulator import MitsubishiSimulator
        self._sim = MitsubishiSimulator()
        self._connected = False

    async def connect(self) -> bool:
        self._sim.start()
        self._connected = True
        logger.info("[SimulatorConnector] Connected to Mitsubishi PLC Simulator")
        return True

    async def disconnect(self) -> None:
        self._sim.stop()
        self._connected = False
        logger.info("[SimulatorConnector] Disconnected")

    async def read_data(self) -> Dict[str, Any]:
        return self._sim.snapshot()

    async def write_data(self, address: str, value: Any) -> bool:
        logger.info("[SimulatorConnector] WRITE %s = %s (simulated)", address, value)
        return True

    async def execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        return self._sim.execute_safe_action(action)

    @property
    def is_connected(self) -> bool:
        return self._connected


class HybridPLCConnector(PLCConnector):
    """
    Wraps a primary connector with an optional fallback connector.
    - Primary: typically Modbus TCP
    - Fallback: simulator (enabled by PLC_ALLOW_SIMULATOR_FALLBACK)
    """

    def __init__(
        self,
        *,
        primary: PLCConnector,
        fallback: Optional[PLCConnector] = None,
        primary_name: str = "primary",
        fallback_name: str = "fallback",
    ):
        self._primary = primary
        self._fallback = fallback
        self._primary_name = primary_name
        self._fallback_name = fallback_name
        self._active: PLCConnector = primary
        self._using_fallback = False
        self._last_primary_error: Optional[str] = None

    @property
    def is_connected(self) -> bool:
        return self._active.is_connected

    @property
    def using_fallback(self) -> bool:
        return self._using_fallback

    @property
    def active_mode(self) -> str:
        return self._fallback_name if self._using_fallback else self._primary_name

    @property
    def last_primary_error(self) -> Optional[str]:
        return self._last_primary_error

    async def connect(self) -> bool:
        try:
            ok = await self._primary.connect()
            self._active = self._primary
            self._using_fallback = False
            self._last_primary_error = None
            return ok
        except Exception as exc:
            self._last_primary_error = str(exc)
            if self._fallback is None:
                raise

            logger.warning(
                "[HybridPLCConnector] Primary '%s' failed (%s). Falling back to '%s'.",
                self._primary_name,
                exc,
                self._fallback_name,
            )
            ok = await self._fallback.connect()
            self._active = self._fallback
            self._using_fallback = True
            return ok

    async def disconnect(self) -> None:
        try:
            await self._primary.disconnect()
        except Exception:
            pass
        if self._fallback is not None:
            try:
                await self._fallback.disconnect()
            except Exception:
                pass
        self._active = self._primary
        self._using_fallback = False

    async def read_data(self) -> Dict[str, Any]:
        if not self._active.is_connected:
            await self.connect()
        return await self._active.read_data()

    async def write_data(self, address: str, value: Any) -> bool:
        if not self._active.is_connected:
            await self.connect()
        return await self._active.write_data(address, value)

    async def execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        if not self._active.is_connected:
            await self.connect()
        return await self._active.execute_action(action)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def _default_connector_type() -> str:
    explicit = (os.getenv("PLC_CONNECTOR", "") or "").strip().lower()
    if explicit:
        return explicit
    app_env = (os.getenv("APP_ENV", "development") or "development").strip().lower()
    return "modbus_tcp" if app_env == "production" else "simulator"


def _build_connector(connector_type: str) -> PLCConnector:
    normalized = (connector_type or "").strip().lower()
    if normalized == "simulator":
        return SimulatorConnector()

    if normalized == "modbus_tcp":
        from .modbus_connector import ModbusTcpConnector

        primary = ModbusTcpConnector.from_env()
        allow_fallback = _env_bool("PLC_ALLOW_SIMULATOR_FALLBACK", False)
        fallback = SimulatorConnector() if allow_fallback else None
        return HybridPLCConnector(
            primary=primary,
            fallback=fallback,
            primary_name="modbus_tcp",
            fallback_name="simulator",
        )

    raise ValueError(f"Unknown connector type: {connector_type}")


def get_connector(connector_type: Optional[str] = None) -> PLCConnector:
    """Factory: get a singleton PLCConnector by type string or env config."""
    global _active_connector, _active_connector_type
    resolved_type = (connector_type or _default_connector_type()).strip().lower()

    with _active_connector_lock:
        if _active_connector is not None:
            return _active_connector

        _active_connector = _build_connector(resolved_type)
        _active_connector_type = resolved_type
        logger.info("[PLC Connector] Initialized type=%s", resolved_type)
        return _active_connector


def get_connector_state() -> Dict[str, Any]:
    connector = _active_connector
    state: Dict[str, Any] = {
        "configured_type": _active_connector_type or _default_connector_type(),
        "connected": False,
        "active_mode": None,
        "using_fallback": False,
        "last_primary_error": None,
    }
    if connector is None:
        return state

    state["connected"] = bool(connector.is_connected)
    if isinstance(connector, HybridPLCConnector):
        state["active_mode"] = connector.active_mode
        state["using_fallback"] = connector.using_fallback
        state["last_primary_error"] = connector.last_primary_error
    else:
        state["active_mode"] = state["configured_type"]
    return state
