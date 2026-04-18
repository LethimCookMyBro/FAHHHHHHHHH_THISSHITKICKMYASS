from fastapi import APIRouter, Depends, HTTPException, Request
from .core.plc_snapshot import get_plc_snapshot
from .security import require_roles
from .plc.connector import get_connector
from .plc.contracts import _normalize_machine, _now_iso
from .routes_plc import _get_pool, _build_dashboard_payload

router = APIRouter()

@router.get("/machines")
async def list_machines(
    request: Request,
    current_user: dict = Depends(require_roles("viewer")),
):
    _ = current_user
    connector = get_connector()
    snapshot = await get_plc_snapshot(request.app.state, connector)
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
    snapshot = await get_plc_snapshot(request.app.state, connector)
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
    snapshot = await get_plc_snapshot(request.app.state, connector)
    pool = _get_pool(request)
    return _build_dashboard_payload(
        snapshot,
        request.app.state,
        pool=pool,
        include_recent=True,
    )