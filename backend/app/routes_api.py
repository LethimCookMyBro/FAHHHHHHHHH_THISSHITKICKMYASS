"""
Main API routes — info, health, agent-chat, transcribe, chat-image, stats.
"""

import os
import io
import json
import time
import mimetypes
import logging
import tempfile
from datetime import datetime, timezone
from typing import Any, Optional, List, Dict

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form, Depends, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from PIL import Image
import pytesseract

from app.security import get_current_user, require_roles
from app.core.metrics import render_prometheus_metrics
from app.core.upload_guard import validate_upload
from app.retriever import PostgresVectorRetriever, EnhancedFlashrankRerankRetriever, NoRerankRetriever
from app.chatbot import answer_question
from app.chat_db import get_user_chat_history
from app.utils import to_bool, sanitize_json
from app.web_search import web_search
from app.file_processing import extract_text_from_file
from app.llm import ask_llm_directly
from app.plc.connector import get_connector_state

logger = logging.getLogger("PLCAssistant")

router = APIRouter()


# ── Pydantic models ──

class ChatResponse(BaseModel):
    reply: str
    processing_time: Optional[float] = None
    retrieval_time: Optional[float] = None
    context_count: Optional[int] = None
    ragas: Optional[dict] = None
    sources: Optional[List[dict]] = None


class HealthResponse(BaseModel):
    status: str
    services: dict
    timestamp: str
    version: str = "3.0.0"


# ── Helpers ──

def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_ready(request: Request) -> bool:
    try:
        db_pool = getattr(request.app.state, "db_pool", None)
        if not db_pool:
            return False
        conn = db_pool.getconn()
        db_pool.putconn(conn)
        return True
    except Exception:
        return False


def _redis_ready(request: Request) -> bool:
    client = getattr(request.app.state, "redis_client", None)
    if client is None:
        app_env = str(getattr(request.app.state, "app_env", "development")).lower()
        return app_env != "production"
    try:
        client.ping()
        return True
    except Exception:
        return False


def _llm_ready(request: Request) -> bool:
    return getattr(request.app.state, "llm", None) is not None


def _plc_ready(request: Request) -> bool:
    connector_state = get_connector_state()
    if connector_state.get("connected"):
        return True
    startup_error = getattr(request.app.state, "plc_startup_error", None)
    if startup_error:
        return False
    return False


def _readiness_services(request: Request) -> Dict[str, Any]:
    connector_state = get_connector_state()
    return {
        "database": _database_ready(request),
        "redis": _redis_ready(request),
        "llm": _llm_ready(request),
        "plc_connector": _plc_ready(request),
        "plc_state": connector_state,
    }


# ── Info / Health endpoints ──

@router.get("/", tags=["Info"])
def root():
    return {
        "name": "PLC Assistant API",
        "version": "3.0.0",
        "description": "Universal PLC & Industrial Automation Assistant",
        "modes": {
            "fast": {
                "description": "Direct LLM response for general questions",
                "response_time": "~5-15 seconds",
                "use_for": ["General PLC concepts", "Quick troubleshooting", "Syntax help"],
            },
            "deep": {
                "description": "RAG-powered response using embedded documentation",
                "response_time": "~30-60 seconds",
                "use_for": ["Specific documentation lookups", "Detailed specifications", "Accuracy-critical queries"],
            },
        },
        "endpoints": {
            "health": "GET /health",
            "health_live": "GET /health/live",
            "health_ready": "GET /health/ready",
            "metrics": "GET /metrics",
            "chat": "POST /api/chat",
            "agent_chat": "POST /api/agent-chat",
            "stream": "POST /api/chat/stream",
            "transcribe": "POST /api/transcribe",
            "collections": "GET /api/collections",
            "stats": "GET /api/stats",
        },
    }


@router.get("/health", response_model=HealthResponse, tags=["Health"])
def health_check(request: Request):
    services = _readiness_services(request)
    status = "healthy" if all(
        [services["database"], services["redis"], services["llm"], services["plc_connector"]]
    ) else "degraded"
    return HealthResponse(status=status, services=services, timestamp=_iso_now())


@router.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "alive", "timestamp": _iso_now(), "version": "3.0.0"}


@router.get("/health/ready", tags=["Health"])
def health_ready(request: Request):
    services = _readiness_services(request)
    ready = all([services["database"], services["redis"], services["llm"], services["plc_connector"]])
    payload = {"status": "ready" if ready else "not_ready", "services": services, "timestamp": _iso_now(), "version": "3.0.0"}
    if not ready:
        return JSONResponse(status_code=503, content=payload)
    return payload


@router.get("/metrics", tags=["Observability"])
def metrics(current_user=Depends(require_roles("admin"))):
    _ = current_user
    return PlainTextResponse(render_prometheus_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")


# ── Chat endpoints ──

@router.post("/api/agent-chat", tags=["Chat"])
def agent_chat(
    request: Request,
    current_user=Depends(require_roles("viewer")),
    message: str = Form(""),
    file: UploadFile = File(None),
    mode: str = Form("fast"),
    chat_history: str = Form("[]"),
    log_eval: bool = Form(False),
    enable_ragas: bool = Form(False),
    fast_ragas: Optional[bool] = Form(None),
    ground_truth: str = Form(""),
    use_rerank: Any = Form(None),
    use_rank: Any = Form(None),
):
    """Advanced chat endpoint with mode selection and file support."""
    _ = current_user
    start_time = time.perf_counter()
    cfg = request.app.state.config

    try:
        history = json.loads(chat_history) if chat_history else []
    except json.JSONDecodeError:
        history = []

    if mode not in ["fast", "deep"]:
        mode = "fast"

    logger.info(f"🎯 Request received - Mode: {mode}, Message: {message[:50]}...")

    file_text = ""
    if file:
        validate_upload(
            file,
            allowed_mime_types={
                "text/plain", "text/csv", "application/json", "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "image/png", "image/jpeg", "image/jpg", "image/webp",
            },
            allowed_extensions={".txt", ".csv", ".json", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp"},
            max_size_mb_env="UPLOAD_MAX_SIZE_MB",
            default_max_size_mb=20,
        )
        file_content = file.file.read()
        mime_type, _ = mimetypes.guess_type(file.filename)

        if mime_type and mime_type.startswith("audio"):
            return JSONResponse(status_code=400, content={"error": "Please use /api/transcribe for audio files"})

        file_text = extract_text_from_file(file_content, file.filename, mime_type)
        logger.info(f"📄 Extracted {len(file_text)} chars from {file.filename}")

    if mode == "fast":
        web_context = ""
        search_triggers = ["latest", "current", "today", "news", "price", "2024", "2025", "update", "release", "announce"]

        if any(trigger in message.lower() for trigger in search_triggers):
            logger.info(f"🌐 Performing web search for: {message[:50]}...")
            web_context = web_search(message, max_results=cfg.WEB_SEARCH_MAX_RESULTS, timeout=cfg.WEB_SEARCH_TIMEOUT)

        result = ask_llm_directly(
            llm=request.app.state.llm,
            question=message,
            file_content=file_text,
            filename=file.filename if file else "",
            mode=mode,
            chat_history=history,
            web_context=web_context,
            fast_mode_chars=cfg.FAST_MODE_CHARS,
            deep_mode_chars=cfg.DEEP_MODE_CHARS,
        )

        response = {
            "reply": result.get("reply", ""),
            "processing_time": time.perf_counter() - start_time,
            "retrieval_time": 0,
            "context_count": 0,
            "contexts": [],
            "sources": [],
            "mode": mode,
            "web_searched": bool(web_context),
            "file_processed": file.filename if file else None,
        }
        return JSONResponse(content=sanitize_json(response))

    # Deep mode
    parsed_rerank = to_bool(use_rerank) or to_bool(use_rank)
    if parsed_rerank is None:
        parsed_rerank = os.getenv("USE_RERANK_DEFAULT", "true").lower() in ("1", "true", "yes")

    reranker_cls = EnhancedFlashrankRerankRetriever if parsed_rerank else NoRerankRetriever

    history_context = ""
    if history:
        for msg in history[-6:]:
            role = "User" if msg.get("sender") == "user" else "Assistant"
            history_context += f"{role}: {msg.get('text', '')[:200]}\n"

    retrieval_query = message
    if file_text:
        max_chars = cfg.DEEP_MODE_CHARS
        truncated = file_text[:max_chars] if len(file_text) > max_chars else file_text
        retrieval_query = f"{message}\n\n--- File Content ({file.filename}) ---\n{truncated}"

    result = answer_question(
        question=retrieval_query,
        db_pool=request.app.state.db_pool,
        llm=request.app.state.llm,
        embedder=request.app.state.embedder,
        collection=cfg.DEFAULT_COLLECTION,
        retriever_class=PostgresVectorRetriever,
        reranker_class=reranker_cls,
    )

    contexts = result.get("contexts_list") or result.get("contexts") or []
    reply_text = result.get("llm_answer", "") or result.get("reply", "")

    if "could not find relevant" in reply_text.lower() or not reply_text.strip():
        logger.info("⚠️ No relevant context in Deep mode, falling back to direct LLM")
        result = ask_llm_directly(
            llm=request.app.state.llm,
            question=message,
            file_content=file_text,
            filename=file.filename if file else "",
            mode=mode,
            chat_history=history,
            fast_mode_chars=cfg.FAST_MODE_CHARS,
            deep_mode_chars=cfg.DEEP_MODE_CHARS,
        )
        reply_text = result.get("reply", "")

    total_time = time.perf_counter() - start_time
    logger.info(f"📊 Deep mode completed in {total_time:.2f}s")

    response = {
        "reply": reply_text,
        "processing_time": total_time,
        "retrieval_time": result.get("retrieval_time"),
        "context_count": result.get("context_count"),
        "contexts": contexts,
        "sources": result.get("sources", []),
        "mode": mode,
        "use_rerank": parsed_rerank,
        "file_processed": file.filename if file else None,
    }
    return JSONResponse(content=sanitize_json(response))


# ── Transcribe endpoint ──

@router.post("/api/transcribe", tags=["Audio"])
def transcribe(
    request: Request,
    current_user=Depends(require_roles("viewer")),
    file: UploadFile = File(...),
    language: str = Form("th"),
):
    """Transcribe audio file to text using Whisper (multilingual)"""
    _ = current_user

    validate_upload(
        file,
        allowed_mime_types={
            "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
            "audio/mp4", "audio/m4a", "audio/webm", "audio/ogg", "audio/flac",
        },
        allowed_extensions={".wav", ".mp3", ".mp4", ".m4a", ".webm", ".ogg", ".flac"},
        max_size_mb_env="UPLOAD_AUDIO_MAX_SIZE_MB",
        default_max_size_mb=20,
    )

    import requests
    cfg = request.app.state.config
    api_key = getattr(cfg, "GROQ_API_KEY", None)

    lang = language.strip().lower()[:2] if language else "th"
    if lang not in ("th", "en", "ja", "zh", "ko", "de", "fr", "es"):
        lang = "th"

    suffix = "." + file.filename.split('.')[-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        # 1. Try blazing-fast Groq Cloud STT first
        if api_key:
            logger.info("⚡ Attempting transcription via Groq Audio API...")
            with open(tmp_path, "rb") as audio_file:
                response = requests.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": (file.filename, audio_file, file.content_type)},
                    data={"model": "whisper-large-v3-turbo", "language": lang, "response_format": "json"},
                    timeout=15
                )
            if response.status_code == 200:
                transcript = response.json().get("text", "")
                logger.info("✅ Groq STT Success.")
                return {"text": transcript.strip()}
            else:
                logger.warning(f"⚠️ Groq STT failed ({response.status_code}): {response.text}. Falling back to local CPU.")
        
        # 2. Fallback to Local CPU Whisper
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise HTTPException(status_code=503, detail="Whisper not available. Install faster-whisper.")

        if not hasattr(request.app.state, 'whisper_model') or request.app.state.whisper_model is None:
            logger.info("Loading Local Whisper model (small, int8 cpu) as fallback...")
            request.app.state.whisper_model = WhisperModel("small", device="cpu", compute_type="int8")

        logger.info("💻 Running transcription on local CPU...")
        segments, _ = request.app.state.whisper_model.transcribe(tmp_path, language=lang, beam_size=5)
        transcript = "".join(s.text for s in segments)
        return {"text": transcript.strip()}

    except Exception as e:
        logger.error(f"Failed to transcribe audio: {e}")
        raise HTTPException(status_code=400, detail="Invalid audio file format or transcription failed.")
    finally:
        os.unlink(tmp_path)


# ── Image / History / Collections / Stats ──

@router.post("/api/chat-image", response_model=ChatResponse, tags=["Chat"])
def chat_image(
    request: Request,
    current_user=Depends(require_roles("viewer")),
    file: UploadFile = File(...),
    message: str = Form(""),
):
    """Chat with an image using OCR"""
    _ = current_user
    validate_upload(
        file,
        allowed_mime_types={"image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp"},
        allowed_extensions={".png", ".jpg", ".jpeg", ".webp", ".bmp"},
        max_size_mb_env="UPLOAD_IMAGE_MAX_SIZE_MB",
        default_max_size_mb=10,
    )
    image_bytes = file.file.read()
    image = Image.open(io.BytesIO(image_bytes))
    ocr_text = pytesseract.image_to_string(image)

    combined_question = f"{message}\n\n[Image OCR Text]:\n{ocr_text}".strip()

    cfg = request.app.state.config
    result = answer_question(
        question=combined_question,
        db_pool=request.app.state.db_pool,
        llm=request.app.state.llm,
        embedder=request.app.state.embedder,
        collection=cfg.DEFAULT_COLLECTION,
        retriever_class=PostgresVectorRetriever,
        reranker_class=EnhancedFlashrankRerankRetriever,
    )
    return ChatResponse(**sanitize_json(result))


@router.get("/api/chat/history", tags=["Chat"])
def chat_history_endpoint(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_current_user),
):
    db_pool = request.app.state.db_pool
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database not available")

    history = get_user_chat_history(
        db_pool=db_pool,
        user_id=current_user["id"],
        limit=limit,
        offset=offset,
    )
    return {"user_id": current_user["id"], "count": len(history), "items": history}


@router.get("/api/collections", tags=["Data"])
def get_collections(
    request: Request,
    current_user=Depends(require_roles("viewer")),
):
    _ = current_user
    db_pool = request.app.state.db_pool
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database not available")

    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT collection FROM documents ORDER BY collection;")
            collections = [row[0] for row in cur.fetchall()]
        return {"collections": collections}
    finally:
        db_pool.putconn(conn)


@router.get("/api/stats", tags=["Data"])
def get_stats(
    request: Request,
    current_user=Depends(require_roles("viewer")),
):
    _ = current_user
    db_pool = request.app.state.db_pool
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database not available")

    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    collection,
                    COUNT(*) as document_count,
                    ROUND(AVG(LENGTH(content))::numeric, 2) as avg_content_length,
                    MIN(LENGTH(content)) as min_content_length,
                    MAX(LENGTH(content)) as max_content_length
                FROM documents
                GROUP BY collection
                ORDER BY collection;
            """)
            stats = []
            for row in cur.fetchall():
                stats.append({
                    "collection": row[0],
                    "document_count": row[1],
                    "avg_content_length": float(row[2]) if row[2] else 0,
                    "min_content_length": row[3],
                    "max_content_length": row[4],
                })
        return {"statistics": stats}
    finally:
        db_pool.putconn(conn)
