# ============================================================================
# backend/main.py v3.0 - Universal PLC Assistant (Bootstrap)
# ============================================================================

import os
import logging
import time
import asyncio
import threading
import warnings
from uuid import uuid4
from urllib.parse import urlparse, urlunparse

from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from langchain_groq import ChatGroq
from dotenv import load_dotenv

load_dotenv()  # Load backend/.env if exists
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))  # Load root .env

from app.db import init_db_pool, ensure_schema
from app.env_resolver import resolve_database_url, redact_database_url
from app.routes_auth import router as auth_router
from app.routes_chat import router as chat_router
from app.routes_plc import router as plc_router
from app.routes_api import router as api_router
from app.plc.connector import get_connector, get_connector_state
from app.security import should_enforce_csrf, validate_csrf_or_raise
from app.core.metrics import inc_counter
from app.core.plc_ingest import plc_alarm_ingestion_loop
from app.core.rate_limit import check_rate_limit
from app.core.redis_client import get_redis_client
from app.core.retention import start_retention_loop
from app.errors import ErrorCode, AppException, create_error_response
from app.utils import (
    client_ip,
    get_app_env,
    set_llm,
    to_bool,
    validate_runtime_security_config,
)
from app.startup import (
    verify_groq_connection,
    test_database_connection,
    run_background_startup_tasks,
)

warnings.filterwarnings("ignore", category=DeprecationWarning)


# ============================================================================
# CONFIGURATION
# ============================================================================

class Config:
    """Centralized configuration management"""

    APP_ENV: str = (os.getenv("APP_ENV", "development") or "development").strip().lower()

    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0"))
    LLM_TOP_P: float = float(os.getenv("LLM_TOP_P", "0.1"))
    LLM_TIMEOUT: int = int(os.getenv("LLM_TIMEOUT", "30"))
    LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "1024"))

    EMBED_MODEL_NAME: str = os.getenv("EMBED_MODEL", "BAAI/bge-m3")

    FAST_MODE_CHARS: int = int(os.getenv("FAST_MODE_CHARS", "8000"))
    DEEP_MODE_CHARS: int = int(os.getenv("DEEP_MODE_CHARS", "60000"))

    WEB_SEARCH_TIMEOUT: int = int(os.getenv("WEB_SEARCH_TIMEOUT", "10"))
    WEB_SEARCH_MAX_RESULTS: int = int(os.getenv("WEB_SEARCH_MAX_RESULTS", "5"))

    DB_POOL_MIN: int = int(os.getenv("DB_POOL_MIN", "1"))
    DB_POOL_MAX: int = int(os.getenv("DB_POOL_MAX", "10"))

    DEFAULT_COLLECTION: str = os.getenv("DEFAULT_COLLECTION", "plcnext")


config = Config()


# ============================================================================
# LOGGING
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("PLCAssistant")

logger.info("=" * 60)
logger.info("🤖 PLC Assistant v3.0 - Starting up (Groq)")
logger.info("=" * 60)
logger.info(f"  App Env: {config.APP_ENV}")
logger.info(f"  Groq Model: {config.GROQ_MODEL}")
logger.info(
    "  LLM sampling: temp=%s top_p=%s max_tokens=%s",
    config.LLM_TEMPERATURE,
    config.LLM_TOP_P,
    config.LLM_MAX_TOKENS,
)
logger.info(f"  Embed Model: {config.EMBED_MODEL_NAME}")
logger.info("=" * 60)


# ============================================================================
# APPLICATION LIFESPAN
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    app_env = get_app_env(config)
    validate_runtime_security_config(app_env)

    app.state.config = config
    app.state.llm = None
    app.state.db_pool = None
    app.state.embedder = None
    app.state.whisper_model = None
    app.state.plc_startup_error = None

    # Redis
    app.state.redis_client = get_redis_client()

    # Database
    try:
        database_url, db_source = resolve_database_url()
        logger.info("📦 Connecting to database (%s): %s", db_source, redact_database_url(database_url))
        app.state.db_pool = init_db_pool(database_url)
        if app.state.db_pool:
            ensure_schema(app.state.db_pool)
            test_database_connection(app.state.db_pool)
    except RuntimeError as e:
        logger.warning("⚠️ No database configured — running without database: %s", e)

    # LLM (Groq)
    if config.GROQ_API_KEY:
        try:
            app.state.llm = ChatGroq(
                api_key=config.GROQ_API_KEY,
                model=config.GROQ_MODEL,
                temperature=config.LLM_TEMPERATURE,
                max_tokens=config.LLM_MAX_TOKENS,
            )
            set_llm(app.state.llm)
            verify_groq_connection(app.state.llm, config.GROQ_MODEL)
            logger.info("✅ LLM initialized: %s (Groq)", config.GROQ_MODEL)
        except Exception as e:
            logger.error("❌ Failed to initialize Groq LLM: %s", e)
            app.state.llm = None
    else:
        logger.error("❌ GROQ_API_KEY not set — chat endpoints will fail")

    # Background tasks (embedder, auto-embed, golden QA)
    bg_thread = threading.Thread(
        target=run_background_startup_tasks,
        args=(app, config),
        daemon=True,
    )
    bg_thread.start()

    # Data retention
    retention_stop = threading.Event()
    app.state.retention_stop_event = retention_stop
    if app.state.db_pool:
        app.state.retention_thread = start_retention_loop(
            db_pool=app.state.db_pool,
            stop_event=retention_stop,
        )

    # PLC connector
    try:
        connector = get_connector()
        await connector.connect()
        app.state.plc_connector = connector

        plc_stop = asyncio.Event()
        app.state.plc_ingest_stop = plc_stop
        app.state.plc_ingest_task = asyncio.create_task(
            plc_alarm_ingestion_loop(
                connector=connector,
                db_pool=app.state.db_pool,
                stop_event=plc_stop,
                poll_interval_seconds=float(os.getenv("PLC_POLL_INTERVAL", "5")),
            )
        )
        connector_state = get_connector_state()
        logger.info(
            "🏭 PLC connector connected: configured=%s active=%s fallback=%s",
            connector_state.get("configured_type"),
            connector_state.get("active_mode"),
            connector_state.get("using_fallback"),
        )
    except Exception as e:
        app.state.plc_startup_error = str(e)
        logger.error("🔥 Failed to start PLC connector: %s", e)

    logger.info("🎉 Application startup complete")
    app.state.retriever = None

    yield

    # Shutdown
    logger.info("👋 Shutting down...")
    plc_ingest_stop = getattr(app.state, "plc_ingest_stop", None)
    if plc_ingest_stop is not None:
        plc_ingest_stop.set()
    plc_ingest_task = getattr(app.state, "plc_ingest_task", None)
    if plc_ingest_task is not None:
        try:
            await asyncio.wait_for(plc_ingest_task, timeout=5)
        except Exception:
            plc_ingest_task.cancel()

    retention_stop_event = getattr(app.state, "retention_stop_event", None)
    if retention_stop_event is not None:
        retention_stop_event.set()
    retention_thread = getattr(app.state, "retention_thread", None)
    if retention_thread is not None and retention_thread.is_alive():
        retention_thread.join(timeout=5)
    if hasattr(app.state, 'db_pool') and app.state.db_pool:
        app.state.db_pool.closeall()
        logger.info("Database pool closed")
    try:
        connector = getattr(app.state, "plc_connector", None)
        if connector is not None and connector.is_connected:
            await connector.disconnect()
            logger.info("PLC connector disconnected")
    except Exception as e:
        logger.error(f"🔥 Failed to disconnect PLC connector: {e}")


# ============================================================================
# CREATE APP & ROUTERS
# ============================================================================

app = FastAPI(
    lifespan=lifespan,
    title="PLC Assistant API",
    description="""
    Universal PLC & Industrial Automation Assistant with RAG capabilities.

    ## Modes
    - **Fast**: Direct LLM response for general questions (~5-15s)
    - **Deep**: RAG-powered response using documentation (~30-60s)
    """,
    version="3.0.0",
)

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(plc_router)
app.include_router(api_router)

# CORS
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
).split(",")
CORS_ORIGINS = [origin.strip() for origin in CORS_ORIGINS if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)


# ============================================================================
# MIDDLEWARE
# ============================================================================

@app.middleware("http")
async def enforce_rate_limit(request: Request, call_next):
    if request.method == "OPTIONS" or not request.url.path.startswith("/api/"):
        return await call_next(request)

    allowed, retry_after = check_rate_limit(
        ip=client_ip(request),
        path=request.url.path,
        now=time.time(),
    )
    if not allowed:
        inc_counter("rate_limit.blocked_total")
        response = create_error_response(
            code="RATE_LIMIT_EXCEEDED",
            message="Too many requests. Please retry later.",
            status_code=429,
            request_id=getattr(request.state, "request_id", None),
            details={"retry_after_seconds": retry_after},
        )
        response.headers["Retry-After"] = str(retry_after)
        return response

    return await call_next(request)


@app.middleware("http")
async def enforce_csrf(request: Request, call_next):
    if should_enforce_csrf(request):
        try:
            validate_csrf_or_raise(request)
        except HTTPException as exc:
            return create_error_response(
                code=str(exc.detail or "CSRF_INVALID"),
                message="CSRF validation failed",
                status_code=exc.status_code,
                request_id=getattr(request.state, "request_id", None),
            )
    return await call_next(request)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()

    inc_counter("http_requests.total")
    inc_counter(f"http_requests.method.{request.method.lower()}")

    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    inc_counter(f"http_responses.status.{response.status_code}")
    inc_counter("http_latency_ms.total", int(elapsed_ms))

    logger.info(
        "[%s] method=%s path=%s status=%s latency_ms=%.2f user_id=%s role=%s",
        request_id[:8],
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        getattr(request.state, "user_id", None),
        getattr(request.state, "user_role", None),
    )

    response.headers["X-Request-ID"] = request_id
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=()",
    )
    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains; preload",
        )
    if request.url.path.startswith("/api/auth/"):
        response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault(
        "Content-Security-Policy",
        (
            "default-src 'self'; "
            "img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "script-src 'self'; "
            "connect-src 'self' ws: wss:;"
        ),
    )
    return response


# ============================================================================
# EXCEPTION HANDLERS
# ============================================================================

@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    request_id = getattr(request.state, 'request_id', None)
    logger.warning(f"[{request_id}] AppException: {exc.code} - {exc.message}")
    return create_error_response(
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
        request_id=request_id,
        details=exc.details,
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, 'request_id', None)
    detail = exc.detail
    details = None
    if isinstance(detail, dict):
        code = str(detail.get("code") or f"HTTP_{exc.status_code}")
        message = str(detail.get("message") or detail)
        details = detail.get("details")
    elif isinstance(detail, str):
        normalized = detail.strip()
        if normalized and normalized.upper() == normalized and "_" in normalized:
            code = normalized
        else:
            code = f"HTTP_{exc.status_code}"
        message = normalized or f"HTTP {exc.status_code}"
    else:
        code = f"HTTP_{exc.status_code}"
        message = str(detail)
    return create_error_response(
        code=code,
        message=message,
        status_code=exc.status_code,
        request_id=request_id,
        details=details,
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, 'request_id', None)
    logger.error(f"[{request_id}] Unhandled exception: {exc}", exc_info=True)
    return create_error_response(
        code=ErrorCode.INTERNAL_ERROR,
        message="An unexpected error occurred. Please try again.",
        status_code=500,
        request_id=request_id,
    )


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "5000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, workers=1)
