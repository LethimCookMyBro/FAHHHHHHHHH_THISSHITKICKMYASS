"""
Service initialization helpers — Groq LLM readiness, DB check, background tasks.
"""

import os
import time
import logging

import requests
from fastapi import FastAPI

from app.utils import to_bool
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


def run_background_startup_tasks(app: FastAPI, config) -> None:
    """Load heavy optional services without blocking API startup."""
    try:
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
