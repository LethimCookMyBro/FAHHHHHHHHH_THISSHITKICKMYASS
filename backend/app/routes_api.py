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

from app.security import get_current_user, require_roles
from app.core.metrics import render_prometheus_metrics
from app.core.upload_guard import validate_upload
from app.chat_db import get_user_chat_history
from app.utils import to_bool, sanitize_json
from app.web_search import web_search
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
        from app.file_processing import extract_text_from_file

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

    from app.retriever import EnhancedFlashrankRerankRetriever, NoRerankRetriever, PostgresVectorRetriever

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

    from app.chatbot import answer_question

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
    language: str = Form("en"),
    prompt: str = Form(""),
):
    """Transcribe audio file to text using Whisper (English-only)."""
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

    requested_lang = language.strip().lower()[:2] if language else "en"
    lang = "en"
    if requested_lang != "en":
        logger.info(
            "Transcribe language '%s' requested, forcing English-only STT.",
            requested_lang,
        )

    prompt_hint = " ".join(str(prompt or "").split())[:280]

    suffix = "." + file.filename.split('.')[-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        # 1. Try blazing-fast Groq Cloud STT first
        if api_key:
            preferred_model = (os.getenv("GROQ_STT_MODEL", "whisper-large-v3") or "whisper-large-v3").strip()
            model_candidates = []
            for candidate in (preferred_model, "whisper-large-v3-turbo"):
                if candidate and candidate not in model_candidates:
                    model_candidates.append(candidate)

            for stt_model in model_candidates:
                logger.info("⚡ Attempting transcription via Groq Audio API (model=%s)...", stt_model)
                with open(tmp_path, "rb") as audio_file:
                    request_data = {
                        "model": stt_model,
                        "language": lang,
                        "response_format": "json",
                    }
                    if prompt_hint:
                        request_data["prompt"] = prompt_hint

                    response = requests.post(
                        "https://api.groq.com/openai/v1/audio/transcriptions",
                        headers={"Authorization": f"Bearer {api_key}"},
                        files={"file": (file.filename, audio_file, file.content_type)},
                        data=request_data,
                        timeout=18
                    )

                if response.status_code == 200:
                    transcript = " ".join(str(response.json().get("text", "")).split())
                    logger.info("✅ Groq STT Success (model=%s).", stt_model)
                    return {"text": transcript.strip()}

                logger.warning(
                    "⚠️ Groq STT failed (model=%s, status=%s): %s",
                    stt_model,
                    response.status_code,
                    response.text,
                )

            logger.warning("⚠️ All Groq STT attempts failed. Falling back to local CPU.")

        # 2. Fallback to Local CPU Whisper
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise HTTPException(status_code=503, detail="Whisper not available. Install faster-whisper.")

        if not hasattr(request.app.state, 'whisper_model') or request.app.state.whisper_model is None:
            logger.info("Loading Local Whisper model (small, int8 cpu) as fallback...")
            request.app.state.whisper_model = WhisperModel("small", device="cpu", compute_type="int8")

        logger.info("💻 Running transcription on local CPU...")
        transcribe_kwargs = {
            "language": lang,
            "beam_size": 7,
            "best_of": 5,
            "vad_filter": True,
            "condition_on_previous_text": False,
        }
        if prompt_hint:
            transcribe_kwargs["initial_prompt"] = prompt_hint

        try:
            segments, _ = request.app.state.whisper_model.transcribe(tmp_path, **transcribe_kwargs)
        except TypeError:
            logger.warning("Local Whisper version does not support advanced kwargs. Falling back to baseline args.")
            segments, _ = request.app.state.whisper_model.transcribe(tmp_path, language=lang, beam_size=5)

        transcript = " ".join(
            segment.text.strip()
            for segment in segments
            if getattr(segment, "text", "").strip()
        )
        transcript = " ".join(transcript.split())
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
    from PIL import Image
    import pytesseract
    from app.retriever import EnhancedFlashrankRerankRetriever, PostgresVectorRetriever

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
    from app.chatbot import answer_question

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

# ── AI Agent Action Endpoint (Mock for MVP) ──

# Minimal in-memory store for idempotency and PLC state demo
IDEMPOTENCY_CACHE = {}
MOCK_PLC_STATE = {"plc-001": {"has_active_fault": True}}

@router.post("/api/agent/action", tags=["Ops"])
async def agent_action(
    request: Request,
    payload: dict,
    current_user=Depends(require_roles("viewer")),
):
    """
    Central gateway for AI Agent actions. 
    Accepts SSE streaming requests.
    Validates idempotency and handles strict schema generation.
    """
    from fastapi.responses import StreamingResponse
    import asyncio
    import uuid
    import json
    
    device_id = payload.get("deviceId")
    action_name = payload.get("actionName")
    mode = payload.get("mode", "execute")
    
    idempotency_key = request.headers.get("x-idempotency-key")
    if not idempotency_key:
        raise HTTPException(status_code=400, detail="Missing X-Idempotency-Key")

    # 1. Idempotency Lock Barrier
    if idempotency_key in IDEMPOTENCY_CACHE:
        # If cache hit, immediately return the completed result
        cached_result = IDEMPOTENCY_CACHE[idempotency_key]
        async def cached_stream():
            yield f"event: completed\ndata: {json.dumps({'result': cached_result, '_cached': True})}\n\n"
        return StreamingResponse(cached_stream(), media_type="text/event-stream")

    async def event_stream():
        # 1. Diagnose Action (AI Analysis Service)
        if action_name == "diagnose":
            yield f"event: status\ndata: {json.dumps({'message': 'Initializing diagnostics...', 'percent': 10})}\n\n"
            await asyncio.sleep(0.5)
            
            yield f"event: status\ndata: {json.dumps({'message': 'Analyzing recent telemetry...', 'percent': 30})}\n\n"
            await asyncio.sleep(0.5)
            
            reasoning_chunks = [
                f"I am analyzing the recent logs for device {device_id}. ",
                "Detected an anomaly in the R102 safety guard register. ",
                "The current spiked to 11.5 Amps 3 minutes prior to the fault. ",
                "Based on the PLC documentation, this indicates a mechanical jam."
            ]
            for chunk in reasoning_chunks:
                yield f"event: reasoning\ndata: {json.dumps({'text': chunk})}\n\n"
                await asyncio.sleep(0.4)
                
            yield f"event: status\ndata: {json.dumps({'message': 'Structuring output...', 'percent': 90})}\n\n"
            await asyncio.sleep(0.3)
            
            final_result = {
                "rootCause": "Mechanical jam detected in Axis 2 drive train causing safety guard interlock.",
                "confidence": 92,
                "severityLevel": "High",
                "estimatedTimeToRepair": "15 mins",
                "impactedSubsystem": "Axis 2 Power Supply",
                "evidence": [
                    {"timestamp": _iso_now(), "log": "R102 -> 0x800F (SAFETY_GATE_OPEN)", "weight": 0.8},
                    {"timestamp": _iso_now(), "log": "Motor Current > 11.0A for 30ms", "weight": 0.9}
                ],
                "remediationSteps": [
                    "Isolate power to Axis 2.",
                    "Inspect mechanical drive train for physical obstructions.",
                    "Clear debris and reset safety guard.",
                    "Execute 'Dry Run' reset before full power restore."
                ],
                "downtimeImpact": "High"
            }
            IDEMPOTENCY_CACHE[idempotency_key] = final_result
            yield f"event: completed\ndata: {json.dumps({'result': final_result})}\n\n"
            
        # 4. System Scan Action (Overview Phase 3)
        elif action_name == "system_scan":
            yield f"event: status\ndata: {json.dumps({'message': 'Initiating global system trace...', 'percent': 10})}\n\n"
            await asyncio.sleep(0.6)
            
            yield f"event: status\ndata: {json.dumps({'message': 'Analyzing inter-node latency & security logs...', 'percent': 45})}\n\n"
            await asyncio.sleep(0.8)
            
            reasoning_chunks = [
                "Scanning Core PLC registers and connected Edge Gateway inputs. ",
                "Detected standard operational metrics on Primary Processing Line. ",
                "However, Edge Gateway 1 has logged 43 dropped packets in the last hour. ",
                "This indicates a potential network degradation or switch failure. ",
                "Compiling vulnerability matrix and optimization insights."
            ]
            for chunk in reasoning_chunks:
                yield f"event: reasoning\ndata: {json.dumps({'text': chunk})}\n\n"
                await asyncio.sleep(0.4)
                
            yield f"event: status\ndata: {json.dumps({'message': 'Finalizing topology health score...', 'percent': 90})}\n\n"
            await asyncio.sleep(0.4)
            
            system_scan_result = {
                "scanId": f"scan-{uuid.uuid4().hex[:6]}",
                "overallHealthScore": 88,
                "systemStatus": "Degraded",
                "activeAnomalies": 1,
                "topVulnerabilities": [
                    {"node": "Edge Gateway 1", "issue": "High packet loss (4.2%) detected on uplink to Main Switch.", "severity": "High"},
                    {"node": "Database Sync", "issue": "Replication lag exceeded 500ms over 3 intervals.", "severity": "Medium"}
                ],
                "optimizationInsights": [
                    "Inspect Cat6 physical connection on Edge Gateway 1 (Port 2).",
                    "Consider expanding connection pool for historian database to reduce replication latency."
                ],
                "lastAuditLog": "Auth Failure: Admin login rejected from unknown IP (10.0.4.55) - 4 mins ago"
            }
            IDEMPOTENCY_CACHE[idempotency_key] = system_scan_result
            yield f"event: completed\ndata: {json.dumps({'result': system_scan_result})}\n\n"
        elif action_name == "summarize_zone":
            zone_id = payload.get("zoneId", "unknown-zone")
            yield f"event: status\ndata: {json.dumps({'message': f'Aggregating spatial telemetry for {zone_id}...', 'percent': 15})}\n\n"
            await asyncio.sleep(0.4)
            
            yield f"event: status\ndata: {json.dumps({'message': 'Correlating 24h alarm trends...', 'percent': 40})}\n\n"
            await asyncio.sleep(0.5)
            
            reasoning_chunks = [
                f"Scanning topology for {zone_id}. ",
                "Detected 3 active alarms in the packaging subsystem. ",
                "Temperature on Conveyor Belt C has risen 12% over the last 6 hours. ",
                "This correlates with increased vibration on drive motor M2."
            ]
            for chunk in reasoning_chunks:
                yield f"event: reasoning\ndata: {json.dumps({'text': chunk})}\n\n"
                await asyncio.sleep(0.4)
                
            yield f"event: status\ndata: {json.dumps({'message': 'Compiling inspection schema...', 'percent': 90})}\n\n"
            await asyncio.sleep(0.3)
            
            summary_result = {
                "zoneId": zone_id,
                "activeAlarmsSummary": "3 critical warnings related to motor vibration and component temperature.",
                "trend24h": "Heat generation has trended upward over 24h, indicating potential lubrication failure or mechanical binding.",
                "inspectionRecommendations": [
                    "Perform thermal/acoustic scan on Conveyor Belt C.",
                    "Check lubrication levels on Motor M2.",
                    "Verify alignment of drive belt on sorter sequence."
                ],
                "criticalityScore": 85,
                "affectedAssets": ["conveyor-c", "motor-m2", "sorter-axis"],
                "anomalyConfidence": 89
            }
            IDEMPOTENCY_CACHE[idempotency_key] = summary_result
            yield f"event: completed\ndata: {json.dumps({'result': summary_result})}\n\n"
            
        # 2. Reset Fault Action (PLC Command Executor Service)
        elif action_name == "reset_fault":
            yield f"event: status\ndata: {json.dumps({'message': f'Verifying safety prerequisites for {mode}...', 'percent': 20})}\n\n"
            await asyncio.sleep(0.8)
            
            # --- EXECUTION BARRIER ---
            # 1. Strict Role Validation
            user_role = str(current_user.get("role", "viewer")).strip().lower()
            if user_role not in {"operator", "admin"}:
                yield f"event: error\ndata: {json.dumps({'message': f'Execution Rejected: Role {user_role} implies insufficient physical override permissions.'})}\n\n"
                return
                
            # 2. Strict Device State Validation
            device_state = MOCK_PLC_STATE.get(device_id, {"has_active_fault": True}) # Defaulting to True for MVP testing
            if not device_state.get("has_active_fault"):
                err_msg = f"Execution Rejected: No active fault detected on {device_id}."
                yield f"event: error\ndata: {json.dumps({'message': err_msg})}\n\n"
                return
            
            # Backend Audit Logging (Mock)
            audit_msg = f"Audit Log: User {current_user.get('email', 'unknown')} initiated {mode} reset on {device_id}"
            yield f"event: status\ndata: {json.dumps({'message': 'Writing to secure audit log...', 'percent': 50})}\n\n"
            logger.info(audit_msg)
            await asyncio.sleep(0.5)
            
            if mode == "dry-run":
                yield f"event: reasoning\ndata: {json.dumps({'text': 'Simulating memory block clear... OK. Simulating register reset... OK.'})}\n\n"
                await asyncio.sleep(0.6)
                final_res = {'success': True, 'message': 'Dry run successful. Safe to execute.'}
                IDEMPOTENCY_CACHE[idempotency_key] = final_res
                yield f"event: completed\ndata: {json.dumps({'result': final_res})}\n\n"
            else:
                yield f"event: reasoning\ndata: {json.dumps({'text': 'Connecting to PLC interface... Clearing fault block... Resetting state...'})}\n\n"
                await asyncio.sleep(1.0)
                
                # Clear actual state
                if device_id in MOCK_PLC_STATE:
                    MOCK_PLC_STATE[device_id]["has_active_fault"] = False
                    
                final_res = {'success': True, 'message': 'Fault successfully cleared on PLC. Equipment is resuming normal operations.'}
                IDEMPOTENCY_CACHE[idempotency_key] = final_res
                yield f"event: completed\ndata: {json.dumps({'result': final_res})}\n\n"
            # 5. KPI Optimization Action (Phase 4)
        elif action_name == "optimize_kpi":
            kpi_target = payload.get("kpiId", "OEE-General")
            yield f"event: status\ndata: {json.dumps({'message': f'Analyzing historical parameters for {kpi_target}...', 'percent': 15})}\n\n"
            await asyncio.sleep(0.5)
            
            yield f"event: status\ndata: {json.dumps({'message': 'Correlating loss vectors...', 'percent': 35})}\n\n"
            await asyncio.sleep(0.7)
            
            reasoning_chunks = [
                f"Isolating root causes for performance loss in {kpi_target}. ",
                "Noticed a 5.2% quality defect drop during shift transitions. ",
                "Performance is suffering due to micro-stops on the main sorting belt. ",
                "Running simulated parameter adjustments against edge historian data. "
            ]
            for chunk in reasoning_chunks:
                yield f"event: reasoning\ndata: {json.dumps({'text': chunk})}\n\n"
                await asyncio.sleep(0.4)
                
            yield f"event: status\ndata: {json.dumps({'message': 'Generating actionable recommendations...', 'percent': 80})}\n\n"
            await asyncio.sleep(0.5)
            
            opt_result = {
                "kpiId": kpi_target,
                "currentOEE": 78.5,
                "targetOEE": 85.0,
                "lossAnalysis": { "availability": 5.2, "performance": 12.1, "quality": 4.2 },
                "aiRecommendations": [
                    "Adjust drive speed on Conveyor C downwards by 2% to synchronize feed rate and reduce micro-stops.", 
                    "Implement a 3-minute overlap during shift changes to maintain baseline temperature in curing ovens."
                ],
                "projectedGain": "+3.2%"
            }
        # 6. Predictive Analysis Action (Phase 5)
        elif action_name == "predictive_analysis":
            asset_target = payload.get("assetId", "Motor-M2")
            yield f"event: status\ndata: {json.dumps({'message': f'Ingesting 30-day historian data for {asset_target}...', 'percent': 20})}\n\n"
            await asyncio.sleep(0.6)
            
            yield f"event: status\ndata: {json.dumps({'message': 'Running Random Forest anomaly detection...', 'percent': 50})}\n\n"
            await asyncio.sleep(0.8)
            
            reasoning_chunks = [
                f"Analyzing harmonic vibration signatures on {asset_target}. ",
                "Detected a +5Hz frequency drift over the last 7 days. ",
                "Correlating with thermal sensors... Thermal overload present during peak load phases. ",
                "Comparing signatures with known failure models. "
            ]
            for chunk in reasoning_chunks:
                yield f"event: reasoning\ndata: {json.dumps({'text': chunk})}\n\n"
                await asyncio.sleep(0.4)
                
            yield f"event: status\ndata: {json.dumps({'message': 'Calculating Time-to-Failure (TTF) parameters...', 'percent': 85})}\n\n"
            await asyncio.sleep(0.5)
            
            pdm_result = {
                "assetId": asset_target,
                "forecast": "Critical Failure Imminent (Bearing Wear)",
                "timeToFailureHours": 114,
                "confidenceScore": 89,
                "anomalySignatures": [
                    "Vibration frequency drift detected (+5Hz over 7 days).", 
                    "Thermal overload during peak load phases (reaching target max 85C)."
                ],
                "recommendedIntervention": "Schedule bearing replacement during the upcoming weekend shutdown.",
                "maintenanceRisk": "High"
            }
            IDEMPOTENCY_CACHE[idempotency_key] = pdm_result
            yield f"event: completed\ndata: {json.dumps({'result': pdm_result})}\n\n"
            
        else:
             yield f"event: error\ndata: {json.dumps({'message': 'Unknown action'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
