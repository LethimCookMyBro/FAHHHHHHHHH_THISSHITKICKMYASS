import json
import tempfile
import unittest
from pathlib import Path

try:
    from app.plc.mapping import load_plc_mapping
except ModuleNotFoundError:
    load_plc_mapping = None


@unittest.skipIf(load_plc_mapping is None, "pydantic dependency is not installed in this test environment")
class PlcMappingTests(unittest.TestCase):
    def _write_mapping(self, payload: dict) -> str:
        tmp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(tmp_dir.cleanup)
        path = Path(tmp_dir.name) / "mapping.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return str(path)

    def test_load_valid_mapping(self):
        path = self._write_mapping(
            {
                "version": "1",
                "machines": [
                    {
                        "id": 1,
                        "name": "M1",
                        "registers": {
                            "status": {
                                "address": 0,
                                "function": "holding",
                                "data_type": "uint16",
                            }
                        },
                    }
                ],
            }
        )
        mapping = load_plc_mapping(path)
        self.assertEqual(1, len(mapping.machines))
        self.assertEqual("M1", mapping.machines[0].name)

    def test_status_register_is_required(self):
        path = self._write_mapping(
            {
                "version": "1",
                "machines": [
                    {
                        "id": 1,
                        "name": "M1",
                        "registers": {
                            "temperature": {
                                "address": 1,
                                "function": "holding",
                                "data_type": "int16",
                            }
                        },
                    }
                ],
            }
        )
        with self.assertRaises(RuntimeError):
            load_plc_mapping(path)


if __name__ == "__main__":
    unittest.main()
