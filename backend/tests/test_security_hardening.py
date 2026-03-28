import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, Response
from starlette.requests import Request

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.auth import create_access_token, decode_token
from app.core.ws_ticket import consume_ws_ticket, issue_ws_ticket
from app.env_resolver import resolve_database_url
from app.file_processing import extract_text_from_file
from app.security import should_enforce_csrf, validate_csrf_or_raise
from app.plc_alarm_queries import build_alarm_where_clause
from app.routes_auth import LoginIn, login, refresh
from app.security import authenticate_websocket
from app.startup import ensure_development_auth_user
from app.utils import client_ip, get_app_env, is_weak_jwt_secret, validate_runtime_security_config


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


class SecurityHardeningTests(unittest.TestCase):
    def test_weak_jwt_secret_detection_catches_placeholders(self):
        self.assertTrue(is_weak_jwt_secret(""))
        self.assertTrue(is_weak_jwt_secret("dev-secret"))
        self.assertTrue(is_weak_jwt_secret("change-me-before-production"))
        self.assertTrue(is_weak_jwt_secret("short-secret"))
        self.assertFalse(
            is_weak_jwt_secret(
                "7a0d5a4d2e4a6f59d2f4d7bfb0d103df0a7318bb5ec62a2b1c59fffd011203ef"
            )
        )

    def test_runtime_security_config_rejects_weak_secret_in_production(self):
        with patch.dict(os.environ, {"JWT_SECRET": "change-me-before-production"}):
            with self.assertRaises(RuntimeError):
                validate_runtime_security_config("production")

    def test_token_creation_requires_runtime_secret_in_production(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "JWT_SECRET": ""}):
            with self.assertRaises(HTTPException) as ctx:
                create_access_token("123")
        self.assertEqual(ctx.exception.status_code, 503)

    def test_token_creation_defaults_to_fail_safe_when_app_env_missing(self):
        with patch.dict(os.environ, {"APP_ENV": "", "JWT_SECRET": ""}):
            with self.assertRaises(HTTPException) as ctx:
                create_access_token("123")
        self.assertEqual(ctx.exception.status_code, 503)

    def test_token_creation_uses_dev_fallback_secret_outside_production(self):
        with patch.dict(os.environ, {"APP_ENV": "development", "JWT_SECRET": ""}):
            token = create_access_token("123")
            payload = decode_token(token)

        self.assertEqual(payload["sub"], "123")
        self.assertEqual(payload["typ"], "access")

    def test_csrf_enforced_for_cookie_authenticated_mutation(self):
        request = _make_request(
            "/api/auth/preferences",
            headers={"cookie": "access_token=test-session"},
        )
        self.assertTrue(should_enforce_csrf(request))
        with self.assertRaises(HTTPException) as ctx:
            validate_csrf_or_raise(request)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_csrf_accepts_matching_cookie_and_header(self):
        request = _make_request(
            "/api/auth/preferences",
            headers={
                "cookie": "access_token=test-session; csrf_token=abc123",
                "x-csrf-token": "abc123",
            },
        )
        self.assertTrue(should_enforce_csrf(request))
        validate_csrf_or_raise(request)

    def test_app_env_defaults_to_production_when_missing(self):
        with patch.dict(os.environ, {"APP_ENV": ""}):
            self.assertEqual(get_app_env(), "production")

    def test_app_env_unknown_value_defaults_to_production(self):
        with patch.dict(os.environ, {"APP_ENV": "staging"}):
            self.assertEqual(get_app_env(), "production")

    def test_ws_tickets_are_single_use_without_redis(self):
        with patch("app.core.ws_ticket.get_redis_client", return_value=None):
            ticket_payload = issue_ws_ticket({"id": 9, "role": "viewer"}, ttl_seconds=30)
            first = consume_ws_ticket(ticket_payload["ticket"])
            second = consume_ws_ticket(ticket_payload["ticket"])

        self.assertIsNotNone(first)
        self.assertEqual(first["user_id"], 9)
        self.assertIsNone(second)

    def test_alarm_where_clause_keeps_user_input_in_params(self):
        clause, params = build_alarm_where_clause("active", "warning' OR 1=1 --")
        self.assertEqual(params[0], "active")
        self.assertEqual(params[1], "warning' or 1=1 --")
        self.assertNotIn("1=1", str(clause))

    def test_database_url_can_resolve_from_postgres_env(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "",
                "POSTGRES_HOST": "postgres",
                "POSTGRES_PORT": "5432",
                "POSTGRES_USER": "user",
                "POSTGRES_PASSWORD": "safe-password",
                "POSTGRES_DB": "plcnextdb",
            },
            clear=False,
        ):
            database_url, source = resolve_database_url()
        self.assertEqual(source, "POSTGRES_ENV")
        self.assertEqual(
            database_url,
            "postgresql://user:safe-password@postgres:5432/plcnextdb",
        )

    def test_websocket_cookie_fallback_disabled_by_default(self):
        websocket = SimpleNamespace(query_params={}, cookies={"access_token": "fake-token"})
        with patch("app.security.decode_token") as decode_token_mock:
            user = authenticate_websocket(websocket)
        self.assertIsNone(user)
        decode_token_mock.assert_not_called()

    def test_client_ip_ignores_forwarded_headers_unless_proxy_trust_enabled(self):
        request = _make_request(
            "/api/test",
            method="GET",
            headers={"x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10"},
        )
        self.assertEqual(client_ip(request), "127.0.0.1")

    def test_client_ip_accepts_forwarded_headers_when_proxy_trust_enabled(self):
        request = _make_request(
            "/api/test",
            method="GET",
            headers={"x-forwarded-for": "203.0.113.9, 10.0.0.1"},
        )
        with patch.dict(os.environ, {"TRUST_PROXY_HEADERS": "true"}):
            self.assertEqual(client_ip(request), "203.0.113.9")

    def test_development_bootstrap_user_requires_explicit_opt_in(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "DEV_BOOTSTRAP_AUTH": "",
                "DEV_BOOTSTRAP_EMAIL": "",
                "DEV_BOOTSTRAP_PASSWORD": "",
            },
            clear=False,
        ):
            with patch("app.startup.hash_password") as hash_mock, patch(
                "app.startup.ensure_user_credentials"
            ) as ensure_mock:
                ensure_development_auth_user()
        hash_mock.assert_not_called()
        ensure_mock.assert_not_called()

    def test_development_bootstrap_user_uses_explicit_credentials_only(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "DEV_BOOTSTRAP_AUTH": "true",
                "DEV_BOOTSTRAP_EMAIL": "demo@example.com",
                "DEV_BOOTSTRAP_PASSWORD": "S3cureDevPass!",
                "DEV_BOOTSTRAP_FULL_NAME": "Demo User",
            },
            clear=False,
        ):
            with patch("app.startup.hash_password", return_value="hashed-dev-pass") as hash_mock, patch(
                "app.startup.ensure_user_credentials",
                return_value={"id": 7, "email": "demo@example.com"},
            ) as ensure_mock:
                ensure_development_auth_user()
        hash_mock.assert_called_once_with("S3cureDevPass!")
        ensure_mock.assert_called_once_with(
            email="demo@example.com",
            password_hash="hashed-dev-pass",
            full_name="Demo User",
        )

    def test_file_processing_hides_internal_parser_errors(self):
        with patch("app.file_processing._extract_pdf", side_effect=RuntimeError("secret path /tmp/data.pdf")):
            result = extract_text_from_file(b"%PDF", "manual.pdf", "application/pdf")
        self.assertEqual(result, "[Error reading file]")
        self.assertNotIn("/tmp/data.pdf", result)

    def test_login_rejects_inactive_users(self):
        request = _make_request("/api/auth/login")
        response = Response()
        payload = LoginIn(email="inactive@example.com", password="CorrectHorseBatteryStaple")
        with patch(
            "app.routes_auth.get_user_by_email",
            return_value={
                "id": 8,
                "email": "inactive@example.com",
                "password_hash": "hashed",
                "is_active": False,
            },
        ), patch("app.routes_auth.verify_password", return_value=True):
            with self.assertRaises(HTTPException) as ctx:
                login(payload, response, request)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_refresh_rejects_inactive_users(self):
        request = _make_request(
            "/api/auth/refresh",
            headers={"cookie": "refresh_token=test-refresh-token"},
        )
        response = Response()
        with patch("app.routes_auth.decode_token", return_value={"typ": "refresh"}), patch(
            "app.routes_auth.find_refresh_token",
            return_value={
                "user_id": 8,
                "revoked": False,
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
            },
        ), patch(
            "app.routes_auth.get_user_by_id",
            return_value={"id": 8, "email": "inactive@example.com", "is_active": False},
        ), patch("app.routes_auth.revoke_refresh_token_by_hash") as revoke_mock:
            with self.assertRaises(HTTPException) as ctx:
                refresh(request, response)
        self.assertEqual(ctx.exception.status_code, 401)
        revoke_mock.assert_called_once_with("test-refresh-token")


if __name__ == "__main__":
    unittest.main()
