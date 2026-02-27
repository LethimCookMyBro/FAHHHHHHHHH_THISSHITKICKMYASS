"""
PLC register/action mapping loader for Modbus TCP connector.

Supports JSON and YAML files validated by Pydantic at startup time.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError, model_validator

logger = logging.getLogger(__name__)

_SUPPORTED_SUFFIXES = {".json", ".yaml", ".yml"}


class RegisterMapping(BaseModel):
    address: int = Field(ge=0)
    function: Literal["holding", "input", "coil", "discrete"] = "holding"
    data_type: Literal["int16", "uint16", "float32", "bool"] = "int16"
    length: int = Field(default=1, ge=1, le=2)
    scale: float = 1.0
    offset: float = 0.0
    unit_id: Optional[int] = Field(default=None, ge=1, le=247)

    @model_validator(mode="after")
    def validate_length(self):
        if self.data_type == "float32" and self.length < 2:
            self.length = 2
        if self.data_type != "float32" and self.length != 1:
            self.length = 1
        return self


class ActionWriteMapping(BaseModel):
    address: int = Field(ge=0)
    function: Literal["holding", "coil"] = "holding"
    value: int = 1
    unit_id: Optional[int] = Field(default=None, ge=1, le=247)


class MachineMapping(BaseModel):
    id: int = Field(ge=1)
    name: str
    plc_type: str = "modbus"
    model: str = ""
    location: str = ""
    unit_id: int = Field(default=1, ge=1, le=247)
    registers: Dict[str, RegisterMapping] = Field(default_factory=dict)
    status_map: Dict[int, str] = Field(
        default_factory=lambda: {
            0: "STOP",
            1: "RUN",
            2: "IDLE",
            3: "ERROR",
        }
    )
    action_writes: Dict[str, ActionWriteMapping] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_required_registers(self):
        if "status" not in self.registers:
            raise ValueError("Each machine mapping must include registers.status")
        return self


class PlcMappingConfig(BaseModel):
    version: str = "1"
    poll_interval_seconds: float = Field(default=1.5, ge=0.2, le=30.0)
    machines: List[MachineMapping] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_machine_ids(self):
        seen = set()
        for machine in self.machines:
            if machine.id in seen:
                raise ValueError(f"Duplicate machine id: {machine.id}")
            seen.add(machine.id)
        return self


def _load_yaml(path: Path) -> dict:
    try:
        import yaml  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "YAML mapping requested but PyYAML is not installed. "
            "Install pyyaml or use JSON mapping."
        ) from exc

    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    if not isinstance(payload, dict):
        raise RuntimeError(f"Invalid mapping payload in {path}: expected object")
    return payload


def _load_payload(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix not in _SUPPORTED_SUFFIXES:
        raise RuntimeError(
            f"Unsupported PLC mapping file extension '{suffix}' for {path}. "
            "Use .json/.yaml/.yml."
        )

    if suffix == ".json":
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise RuntimeError(f"Invalid mapping payload in {path}: expected object")
        return payload

    return _load_yaml(path)


def _candidate_paths(explicit_path: Optional[str]) -> List[Path]:
    candidates: List[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = (os.getenv("PLC_MAPPING_PATH", "") or "").strip()
    if env_path:
        candidates.append(Path(env_path).expanduser())

    # Common project/runtime locations
    candidates.extend(
        [
            Path("backend/data/plc_mapping.json"),
            Path("backend/data/plc_mapping.yaml"),
            Path("backend/data/plc_mapping.yml"),
            Path("/app/backend/data/plc_mapping.json"),
            Path("/app/backend/data/plc_mapping.yaml"),
            Path("/app/backend/data/plc_mapping.yml"),
        ]
    )

    # Keep order, deduplicate by resolved path string when possible.
    deduped: List[Path] = []
    seen = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(path)
    return deduped


def resolve_mapping_path(explicit_path: Optional[str] = None) -> Optional[Path]:
    for candidate in _candidate_paths(explicit_path):
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def load_plc_mapping(explicit_path: Optional[str] = None) -> PlcMappingConfig:
    path = resolve_mapping_path(explicit_path)
    if path is None:
        raise RuntimeError(
            "PLC mapping file not found. Set PLC_MAPPING_PATH to a valid JSON/YAML file."
        )

    payload = _load_payload(path)

    try:
        config = PlcMappingConfig.model_validate(payload)
    except ValidationError as exc:
        raise RuntimeError(f"Invalid PLC mapping file {path}: {exc}") from exc

    logger.info(
        "[PLC Mapping] Loaded %s machines from %s",
        len(config.machines),
        path,
    )
    return config

