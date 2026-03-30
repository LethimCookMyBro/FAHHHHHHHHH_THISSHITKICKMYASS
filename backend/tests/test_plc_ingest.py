import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.plc_ingest import _collect_stale_alarm_ids, persist_plc_alarms


class PlcIngestTests(unittest.TestCase):
    def test_persist_plc_alarms_is_noop_without_database(self):
        alarms = [
            {
                "machine_id": 1,
                "error_code": "6207",
                "severity": "critical",
                "message": "PARAMETER ERROR",
            }
        ]

        self.assertEqual(0, persist_plc_alarms(None, alarms))

    def test_collect_stale_alarm_ids_resolves_recovered_and_duplicate_rows(self):
        open_alarm_rows = [
            {
                "id": 22,
                "machine_id": 2,
                "error_code": "A051",
                "created_at": "2026-03-30T10:05:00Z",
            },
            {
                "id": 21,
                "machine_id": 2,
                "error_code": "A051",
                "created_at": "2026-03-30T10:00:00Z",
            },
            {
                "id": 20,
                "machine_id": 2,
                "error_code": "A052",
                "created_at": "2026-03-30T09:55:00Z",
            },
            {
                "id": 19,
                "machine_id": 3,
                "error_code": "6103",
                "created_at": "2026-03-30T09:50:00Z",
            },
        ]
        machines = [
            {
                "id": 2,
                "active_error": {"code": "A051"},
            },
            {
                "id": 3,
                "active_error": None,
            },
        ]

        stale_ids = _collect_stale_alarm_ids(open_alarm_rows, machines)

        self.assertEqual([21, 20, 19], stale_ids)

    def test_collect_stale_alarm_ids_keeps_latest_matching_alarm_per_machine(self):
        open_alarm_rows = [
            {
                "id": 42,
                "machine_id": 4,
                "error_code": "QX210",
                "created_at": "2026-03-30T11:00:00Z",
            },
            {
                "id": 41,
                "machine_id": 4,
                "error_code": "QX210",
                "created_at": "2026-03-30T10:30:00Z",
            },
        ]
        machines = [
            {
                "id": 4,
                "active_error": {"code": "QX210"},
            },
        ]

        stale_ids = _collect_stale_alarm_ids(open_alarm_rows, machines)

        self.assertEqual([41], stale_ids)


if __name__ == "__main__":
    unittest.main()
