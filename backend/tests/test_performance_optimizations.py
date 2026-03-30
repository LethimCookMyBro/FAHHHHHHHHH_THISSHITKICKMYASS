import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.chat_db import get_recent_chat_context
from app.core.plc_snapshot import get_plc_snapshot


class _CursorStub:
    def __init__(self, fetchall_results=None, fetchone_results=None):
        self.fetchall_results = list(fetchall_results or [])
        self.fetchone_results = list(fetchone_results or [])
        self.execute_calls = []

    def execute(self, query, params):
        self.execute_calls.append((" ".join(str(query).split()), tuple(params)))

    def fetchall(self):
        return self.fetchall_results.pop(0)

    def fetchone(self):
        if not self.fetchone_results:
            return None
        return self.fetchone_results.pop(0)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _ConnectionStub:
    def __init__(self, cursor_stub):
        self.cursor_stub = cursor_stub

    def cursor(self):
        return self.cursor_stub


class _PoolStub:
    def __init__(self, connection):
        self.connection = connection
        self.putconn_calls = 0

    def getconn(self):
        return self.connection

    def putconn(self, conn):
        self.putconn_calls += 1


class _ConnectorStub:
    def __init__(self):
        self.is_connected = False
        self.connect_calls = 0
        self.read_calls = 0

    async def connect(self):
        self.connect_calls += 1
        self.is_connected = True

    async def read_data(self):
        self.read_calls += 1
        await asyncio.sleep(0)
        return {"timestamp": f"snapshot-{self.read_calls}"}


class PerformanceOptimizationTests(unittest.TestCase):
    def test_recent_chat_context_uses_single_query_for_non_empty_sessions(self):
        cursor = _CursorStub(
            fetchall_results=[
                [
                    ("assistant", "latest reply"),
                    ("user", "older prompt"),
                ]
            ]
        )
        pool = _PoolStub(_ConnectionStub(cursor))

        result = get_recent_chat_context(pool, session_id=9, user_id=4, limit=10)

        self.assertEqual(
            result,
            [
                {"role": "user", "content": "older prompt"},
                {"role": "assistant", "content": "latest reply"},
            ],
        )
        self.assertEqual(len(cursor.execute_calls), 1)
        self.assertEqual(pool.putconn_calls, 1)

    def test_recent_chat_context_returns_none_for_missing_session(self):
        cursor = _CursorStub(fetchall_results=[[]], fetchone_results=[None])
        pool = _PoolStub(_ConnectionStub(cursor))

        result = get_recent_chat_context(pool, session_id=42, user_id=7, limit=10)

        self.assertIsNone(result)
        self.assertEqual(len(cursor.execute_calls), 2)

    def test_plc_snapshot_deduplicates_concurrent_reads(self):
        app_state = SimpleNamespace()
        connector = _ConnectorStub()

        async def _run():
            first, second = await asyncio.gather(
                get_plc_snapshot(app_state, connector, max_age_seconds=5.0),
                get_plc_snapshot(app_state, connector, max_age_seconds=5.0),
            )
            cached = await get_plc_snapshot(app_state, connector, max_age_seconds=5.0)
            return first, second, cached

        first, second, cached = asyncio.run(_run())

        self.assertEqual(first, {"timestamp": "snapshot-1"})
        self.assertEqual(second, {"timestamp": "snapshot-1"})
        self.assertEqual(cached, {"timestamp": "snapshot-1"})
        self.assertEqual(connector.connect_calls, 1)
        self.assertEqual(connector.read_calls, 1)

    def test_plc_snapshot_refreshes_after_cache_expiry(self):
        app_state = SimpleNamespace()
        connector = _ConnectorStub()

        async def _run():
            first = await get_plc_snapshot(app_state, connector, max_age_seconds=0.0)
            second = await get_plc_snapshot(app_state, connector, max_age_seconds=0.0)
            return first, second

        first, second = asyncio.run(_run())

        self.assertEqual(first, {"timestamp": "snapshot-1"})
        self.assertEqual(second, {"timestamp": "snapshot-2"})
        self.assertEqual(connector.read_calls, 2)


if __name__ == "__main__":
    unittest.main()
