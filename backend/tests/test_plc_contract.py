import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.plc.contracts import _normalize_action, _normalize_alarm, _normalize_machine


class PlcContractTests(unittest.TestCase):
    def test_machine_status_is_normalized(self):
        machine = _normalize_machine(
            {
                "id": 1,
                "name": "Line A",
                "status": "RUN",
                "sensors": {"temperature": 44.2, "current": 6.1, "vibration": 0.9},
            }
        )
        self.assertEqual(machine["status"], "running")
        self.assertAlmostEqual(machine["temp"], 44.2)
        self.assertAlmostEqual(machine["current"], 6.1)
        self.assertAlmostEqual(machine["vibration"], 0.9)

    def test_alarm_status_prefers_resolved_timestamp(self):
        alarm = _normalize_alarm(
            {
                "id": 5,
                "error_code": "6207",
                "message": "PARAMETER ERROR",
                "status": "active",
                "resolved_at": "2026-02-16T09:10:11Z",
                "created_at": "2026-02-16T08:00:00Z",
            }
        )
        self.assertEqual(alarm["status"], "resolved")
        self.assertEqual(alarm["timestamp"], "2026-02-16T08:00:00Z")

    def test_action_normalization_exposes_audit_fields(self):
        action = _normalize_action(
            {
                "id": 11,
                "action_type": "plan",
                "is_hardware": False,
                "execution_status": "EXECUTED",
                "action_payload": {"action_name": "reload_soft_parameters"},
                "approval_info": {"approved_by": 99},
                "execution_result": {"success": True},
                "error_message": "PARAMETER ERROR",
            }
        )
        self.assertEqual(action["issue_type"], "software")
        self.assertEqual(action["execution_status"], "executed")
        self.assertEqual(action["action_payload"]["action_name"], "reload_soft_parameters")
        self.assertEqual(action["approval_info"]["approved_by"], 99)


if __name__ == "__main__":
    unittest.main()
