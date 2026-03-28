"""
Service initialization helpers — Groq LLM readiness, DB check, background tasks.
"""

import os
import time
import logging

import requests
from fastapi import FastAPI

from app.auth import hash_password
from app.db_helpers import ensure_user_credentials
from app.utils import get_app_env, set_llm, to_bool
from app.embed_logic import get_embedder
from app.seed import (
    auto_embed_knowledge_if_empty,
    get_auto_embed_batch_size,
    get_auto_embed_chunk_overlap,
    get_auto_embed_chunk_size,
    get_auto_embed_knowledge_dir,
    get_default_golden_qa_path,
    seed_golden_qa_if_empty,
    should_allow_startup_ingest_in_production,
    should_auto_embed_force_rescan,
    should_auto_embed_sync_if_not_empty,
    should_auto_embed_knowledge,
    should_auto_seed,
)

logger = logging.getLogger("PLCAssistant")


def verify_groq_connection(llm, model_name: str) -> bool:
    """Quick test to verify Groq API key and model work."""
    try:
        logger.info("🔄 Verifying Groq connection (model: %s)...", model_name)
        response = llm.invoke("Say 'OK' in one word.")
        content = getattr(response, "content", str(response))
        if content and len(content.strip()) > 0:
            logger.info("✅ Groq API verified — model responsive")
            return True
        logger.warning("⚠️ Groq responded but with empty content")
        return False
    except Exception as e:
        logger.error("❌ Groq verification failed: %s", e)
        return False


def test_database_connection(db_pool) -> bool:
    """Test database connectivity and core schema availability."""
    conn = None
    try:
        conn = db_pool.getconn()

        with conn.cursor() as cur:
            cur.execute("SELECT extname FROM pg_extension WHERE extname = 'vector';")
            if not cur.fetchone():
                logger.error("❌ pgvector extension not found!")
                return False

            cur.execute("SELECT to_regclass('public.documents');")
            has_documents = cur.fetchone()[0] is not None

            doc_count = 0
            if has_documents:
                cur.execute("SELECT COUNT(*) FROM documents;")
                doc_count = cur.fetchone()[0]

        logger.info(f"✅ Database connected. Documents: {doc_count}")
        return True

    except Exception as e:
        logger.error(f"🔥 Database connection failed: {e}")
        return False
    finally:
        if conn is not None:
            db_pool.putconn(conn)


def ensure_development_auth_user() -> None:
    """Provision an opt-in local login for development-only environments."""
    if get_app_env() != "development":
        return

    bootstrap_enabled = to_bool(os.getenv("DEV_BOOTSTRAP_AUTH"))
    if bootstrap_enabled is not True:
        return

    email = (os.getenv("DEV_BOOTSTRAP_EMAIL") or "").strip().lower()
    password = (os.getenv("DEV_BOOTSTRAP_PASSWORD") or "").strip()
    full_name = (os.getenv("DEV_BOOTSTRAP_FULL_NAME") or "").strip() or None

    if not email or not password:
        logger.warning(
            "Skipping development auth bootstrap because DEV_BOOTSTRAP_AUTH=true but credentials are incomplete."
        )
        return

    user = ensure_user_credentials(
        email=email,
        password_hash=hash_password(password),
        full_name=full_name,
    )
    logger.info("Development auth user ready: email=%s id=%s", user.get("email"), user.get("id"))


def run_background_startup_tasks(app: FastAPI, config) -> None:
    """Load heavy optional services without blocking API startup."""
    try:
        # LLM bootstrap is intentionally deferred to background startup
        # so API liveness can become available without waiting for heavy imports.
        if config.GROQ_API_KEY:
            try:
                from langchain_groq import ChatGroq

                llm = ChatGroq(
                    api_key=config.GROQ_API_KEY,
                    model=config.GROQ_MODEL,
                    temperature=config.LLM_TEMPERATURE,
                    max_tokens=config.LLM_MAX_TOKENS,
                )
                app.state.llm = llm
                set_llm(llm)
                verify_groq_connection(llm, config.GROQ_MODEL)
                logger.info("✅ LLM initialized: %s (Groq)", config.GROQ_MODEL)
            except Exception as e:
                logger.error("❌ Failed to initialize Groq LLM: %s", e)
                app.state.llm = None
        else:
            logger.error("❌ GROQ_API_KEY not set — chat endpoints will fail")

        load_embedder_on_demand = to_bool(os.getenv("LOAD_EMBEDDER_ON_DEMAND"))
        if load_embedder_on_demand is None:
            load_embedder_on_demand = False

        auto_embed_enabled = should_auto_embed_knowledge()
        auto_seed_enabled = should_auto_seed()
        auto_embed_sync_if_not_empty = should_auto_embed_sync_if_not_empty()
        auto_embed_force_rescan = should_auto_embed_force_rescan()
        knowledge_dir = get_auto_embed_knowledge_dir()
        logger.info(
            "Bootstrap config: auto_embed=%s sync_if_not_empty=%s force_rescan=%s auto_seed=%s knowledge_dir=%s allow_startup_ingest_in_prod=%s",
            auto_embed_enabled,
            auto_embed_sync_if_not_empty,
            auto_embed_force_rescan,
            auto_seed_enabled,
            knowledge_dir or "<auto>",
            should_allow_startup_ingest_in_production(),
        )

        app.state.embedder = None
        if load_embedder_on_demand:
            logger.info("✅ Startup embedder load disabled (LOAD_EMBEDDER_ON_DEMAND=true)")
            logger.info("📚 Startup auto-embed skipped (embedder will load on first chat request)")
            logger.info("🌱 Startup auto-seed skipped (embedder will load on first chat request)")
            return

        try:
            app.state.embedder = get_embedder()
            logger.info(f"✅ Embedder loaded: {config.EMBED_MODEL_NAME}")
        except Exception as e:
            logger.error(f"🔥 Failed to load embedder: {e}")
            return

        if auto_embed_enabled:
            try:
                auto_embed_result = auto_embed_knowledge_if_empty(
                    db_pool=app.state.db_pool,
                    embedder=app.state.embedder,
                    collection=config.DEFAULT_COLLECTION,
                    knowledge_dir=knowledge_dir,
                    batch_size=get_auto_embed_batch_size(),
                    chunk_size=get_auto_embed_chunk_size(),
                    chunk_overlap=get_auto_embed_chunk_overlap(),
                    sync_if_not_empty=auto_embed_sync_if_not_empty,
                    skip_known_sources=not auto_embed_force_rescan,
                )
                logger.info("📚 Knowledge auto-embed result: %s", auto_embed_result)
            except Exception as e:
                logger.error(f"🔥 Knowledge auto-embed failed: {e}", exc_info=True)
        else:
            logger.info("📚 Startup auto-embed disabled")

        if auto_seed_enabled:
            try:
                seed_result = seed_golden_qa_if_empty(
                    db_pool=app.state.db_pool,
                    embedder=app.state.embedder,
                    collection=config.DEFAULT_COLLECTION,
                    json_path=get_default_golden_qa_path(
                        (os.getenv("GOLDEN_QA_PATH", "") or "").strip()
                    ),
                )
                logger.info(f"🌱 Golden QA seed result: {seed_result}")
            except Exception as e:
                logger.error(f"🔥 Golden QA auto-seed failed: {e}", exc_info=True)
        else:
            logger.info("🌱 Startup auto-seed disabled")
    except Exception as e:
        logger.error("🔥 Background startup tasks failed: %s", e, exc_info=True)
