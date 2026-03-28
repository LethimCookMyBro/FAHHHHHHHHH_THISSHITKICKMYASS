import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.plc_ingest import persist_plc_alarms


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


if __name__ == "__main__":
    unittest.main()
