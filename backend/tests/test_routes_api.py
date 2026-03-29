import asyncio
import sys
import unittest
from pathlib import Path

from starlette.requests import Request

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.routes_api import IDEMPOTENCY_CACHE, agent_action, root


def _make_request(path: str, *, method: str = "POST", headers: dict | None = None):
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": [
            (key.lower().encode("utf-8"), value.encode("utf-8"))
            for key, value in (headers or {}).items()
        ],
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
    }
    return Request(scope)


async def _read_streaming_body(response):
    chunks = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, bytes):
            chunks.append(chunk.decode("utf-8"))
        else:
            chunks.append(str(chunk))
    return "".join(chunks)


class RoutesApiTests(unittest.TestCase):
    def setUp(self):
        IDEMPOTENCY_CACHE.clear()

    def test_root_endpoint_advertises_current_sse_path(self):
        payload = root()
        self.assertEqual(payload["endpoints"]["stream"], "POST /api/agent/action (SSE)")

    def test_optimize_kpi_stream_completes_and_caches_result(self):
        request = _make_request(
            "/api/agent/action",
            headers={"x-idempotency-key": "optimize-kpi-test"},
        )

        response = asyncio.run(
            agent_action(
                request=request,
                payload={"deviceId": "plc-001", "actionName": "optimize_kpi"},
                current_user={"id": 7, "role": "viewer", "email": "demo@example.com"},
            )
        )
        body = asyncio.run(_read_streaming_body(response))

        self.assertIn("event: completed", body)
        self.assertIn('"kpiId": "OEE-General"', body)
        self.assertIn("optimize-kpi-test", IDEMPOTENCY_CACHE)


if __name__ == "__main__":
    unittest.main()
