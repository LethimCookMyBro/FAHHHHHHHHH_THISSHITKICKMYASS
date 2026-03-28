import logging
import math
import os
import re
import time
from typing import Any, Dict, List, Optional

from langchain_core.prompts import PromptTemplate

logger = logging.getLogger(__name__)

# Re-use existing constants from where they will be stored or keep them here for now
RAGAS_MIN_THRESHOLD = 0.55
RAGAS_FAITHFULNESS_HARD_FAIL = 0.45
RAGAS_RELEVANCY_HARD_FAIL = 0.45
RAGAS_METRIC_WEIGHTS = {
    "answer_relevancy": 0.35,
    "faithfulness": 0.35,
    "context_precision": 0.15,
    "context_recall": 0.15,
}
SKIP_RAGAS_PATTERNS = (
    "your name",
    "who are you",
    "what are you",
    "introduce yourself",
    "hello",
    "hi",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "thank you",
    "thanks",
    "bye",
    "goodbye",
    "ok",
    "okay",
    "help",
    "what can you do",
)
THAI_CHAR_PATTERN = re.compile(r"[\u0E00-\u0E7F]")

def _env_bool(key: str, default: bool = False) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}

def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key)
    try:
        return int(str(raw)) if raw is not None else int(default)
    except Exception:
        return int(default)

def _env_float(key: str, default: float) -> float:
    raw = os.getenv(key)
    try:
        return float(str(raw)) if raw is not None else float(default)
    except Exception:
        return float(default)

def _clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(value, high))

def _normalize_intent_text(text: str) -> str:
    lowered = str(text or "").lower()
    lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
    lowered = re.sub(r"\s{2,}", " ", lowered)
    return lowered.strip()

def _should_skip_ragas(question: str) -> bool:
    normalized = _normalize_intent_text(question)
    if not normalized:
        return False
    return any(
        re.search(rf"\b{re.escape(pattern)}\b", normalized) is not None
        for pattern in SKIP_RAGAS_PATTERNS
    )

def _contains_thai_script(text: Any) -> bool:
    return bool(THAI_CHAR_PATTERN.search(str(text or "")))

def _force_english_rewrite(llm: Any, text: str) -> str:
    original = str(text or "").strip()
    if not original:
        return original
    prompt = (
        "Rewrite the following PLC assistant answer into clear professional English only.\n"
        "Keep the exact technical meaning, keep bullets/steps, do not add new facts.\n\n"
        "Answer:\n"
        f"{original}\n\n"
        "English rewrite:"
    )
    try:
        rewritten = invoke_llm_with_fallback(llm, prompt).strip()
        return rewritten or original
    except Exception as exc:
        logger.warning("English rewrite guard failed: %s", exc)
        return original

def _question_mode(question: str) -> str:
    from app.chatbot import _question_mode as q_mode
    return q_mode(question)

def _topk_for_mode(mode: str) -> int:
    from app.chatbot import _topk_for_mode as t_mode
    return t_mode(mode)

def _rerank_topn_for_mode(mode: str) -> int:
    from app.chatbot import _rerank_topn_for_mode as r_mode
    return r_mode(mode)

def _max_candidates_for_mode(mode: str) -> int:
    from app.chatbot import _max_candidates_for_mode as c_mode
    return c_mode(mode)

def _compact_context_text(text: str, max_chars: int) -> str:
    from app.chatbot import _compact_context_text as c_text
    return c_text(text, max_chars)

def _doc_source_page(doc, fallback_index: int = 0) -> Dict[str, Any]:
    from app.chatbot import _doc_source_page as d_sp
    return d_sp(doc, fallback_index)

def build_source_citations(selected_docs: List, max_items: int = 6) -> List[Dict[str, Any]]:
    from app.chatbot import build_source_citations as b_sc
    return b_sc(selected_docs, max_items)

def get_doc_score(doc) -> Optional[float]:
    from app.chatbot import get_doc_score as g_ds
    return g_ds(doc)

def _build_task_prompt(question: str, mode: str) -> str:
    from app.chatbot import _build_task_prompt as b_tp
    return b_tp(question, mode)

def build_enhanced_prompt() -> PromptTemplate:
    from app.chatbot import build_enhanced_prompt as b_ep
    return b_ep()

def build_no_context_prompt() -> PromptTemplate:
    from app.chatbot import build_no_context_prompt as b_np
    return b_np()

def invoke_llm_with_fallback(llm: Any, prompt: str) -> str:
    from app.chatbot import invoke_llm_with_fallback as i_llm
    return i_llm(llm, prompt)

def fix_markdown_tables(text: str) -> str:
    from app.chatbot import fix_markdown_tables as f_mt
    return f_mt(text)

def _sanitize_prompt_leakage(text: Any) -> str:
    from app.chatbot import _sanitize_prompt_leakage as s_pl
    return s_pl(text)


def sanitize_prompt_input(text: Any, max_chars: int = 2000) -> str:
    from app.chatbot import sanitize_prompt_input as s_pi
    return s_pi(text, max_chars)

def _normalize_engineering_steps(raw: str, mode: str) -> str:
    from app.chatbot import _normalize_engineering_steps as n_es
    return n_es(raw, mode)

def _enforce_numeric_guardrail(text: str, context_texts: List[str], mode: str) -> str:
    from app.chatbot import _enforce_numeric_guardrail as e_ng
    return e_ng(text, context_texts, mode)

def _looks_broken_reply(text: Any) -> bool:
    from app.chatbot import _looks_broken_reply as l_br
    return l_br(text)

def build_citations_from_docs(docs):
    from app.chatbot import build_citations_from_docs as c_f_d
    return c_f_d(docs)

def log_chat_request(
    question: str,
    answer: str,
    retrieval_time: float,
    rerank_time: float,
    llm_time: float,
    total_time: float,
    retrieved_docs: List,
    reranked_docs: List,
    selected_docs: List,
    max_score: Optional[float],
    ragas_scores: Optional[Dict[str, Any]] = None,
):
    from app.chatbot import log_chat_request as l_cr
    return l_cr(
        question, answer, retrieval_time, rerank_time, llm_time,
        total_time, retrieved_docs, reranked_docs, selected_docs, max_score, ragas_scores
    )

def format_chat_history(chat_history: List[dict], max_messages: int = 6) -> str:
    from app.chatbot import format_chat_history as f_ch
    return f_ch(chat_history, max_messages)

def preprocess_query(query: str) -> str:
    from app.chatbot import preprocess_query as p_q
    return p_q(query)

def select_context_docs(
    retrieved_docs: List,
    question: str = "",
    question_mode: str = "qa",
    top_k: Optional[int] = None,
    max_candidates: Optional[int] = None,
) -> List:
    from app.chatbot import select_context_docs as s_cd
    return s_cd(retrieved_docs, question, question_mode, top_k, max_candidates)

def answer_question(
    question: str,
    db_pool,
    llm,
    embedder,
    collection: str,
    retriever_class,
    reranker_class,
    chat_history: List[dict] = None,
) -> dict:

    processed_msg = preprocess_query(
        sanitize_prompt_input((question or "").strip(), max_chars=1600)
    )
    if not processed_msg:
        return {"reply": "Please enter a question."}

    t0 = time.perf_counter()
    question_mode = _question_mode(processed_msg)
    # Keep procedure/troubleshoot prompts lean to reduce latency and leakage.
    history_section = (
        ""
        if question_mode in {"procedure", "troubleshoot", "root_cause"}
        else format_chat_history(chat_history or [], max_messages=5)
    )

    # ============ RETRIEVAL PHASE ============
    t_retrieval_start = time.perf_counter()
    rerank_top_n = _rerank_topn_for_mode(question_mode)
    selected_top_k = _topk_for_mode(question_mode)
    max_candidates = _max_candidates_for_mode(question_mode)
    
    base_retriever = retriever_class(
        connection_pool=db_pool,
        embedder=embedder,
        collection=collection,
    )
    
    # Get raw retrieved docs from base retriever
    raw_retrieved_docs = base_retriever.invoke(processed_msg) or []
    t_retrieval_end = time.perf_counter()
    retrieval_time = t_retrieval_end - t_retrieval_start

    # ============ RERANKING PHASE ============
    t_rerank_start = time.perf_counter()

    # Two-stage pipeline: if CrossEncoder is selected, run Flashrank first
    from app.retriever import CrossEncoderRerankRetriever, EnhancedFlashrankRerankRetriever

    if reranker_class is CrossEncoderRerankRetriever:
        # Stage 1: Flashrank narrows candidates with domain boosts
        try:
            flashrank_stage = EnhancedFlashrankRerankRetriever(
                base_retriever=base_retriever,
                prefetched_docs=raw_retrieved_docs,
                top_n=rerank_top_n,
            )
        except TypeError:
            flashrank_stage = EnhancedFlashrankRerankRetriever(
                base_retriever=base_retriever,
            )
        stage1_docs = flashrank_stage.invoke(processed_msg) or []

        # Stage 2: Cross-encoder re-scores for maximum accuracy
        try:
            reranker = CrossEncoderRerankRetriever(
                base_retriever=base_retriever,
                prefetched_docs=stage1_docs,
                top_n=rerank_top_n,
            )
        except TypeError:
            reranker = CrossEncoderRerankRetriever(
                base_retriever=base_retriever,
                prefetched_docs=stage1_docs,
            )
        reranked_docs = reranker.invoke(processed_msg) or []
    else:
        # Single-stage reranking (Flashrank or NoRerank)
        reranker = None
        for kwargs in (
            {"base_retriever": base_retriever, "prefetched_docs": raw_retrieved_docs, "top_n": rerank_top_n},
            {"base_retriever": base_retriever, "prefetched_docs": raw_retrieved_docs},
            {"base_retriever": base_retriever, "top_n": rerank_top_n},
            {"base_retriever": base_retriever},
        ):
            try:
                reranker = reranker_class(**kwargs)
                break
            except TypeError:
                continue
        if reranker is None:
            raise RuntimeError("Failed to initialize reranker with compatible arguments")
        reranked_docs = reranker.invoke(processed_msg) or []
    selected_docs = select_context_docs(
        reranked_docs,
        question=processed_msg,
        question_mode=question_mode,
        top_k=selected_top_k,
        max_candidates=max_candidates,
    )
    
    t_rerank_end = time.perf_counter()
    rerank_time = t_rerank_end - t_rerank_start

    context_chars = (
        _env_int("CHAT_CONTEXT_MAX_CHARS_PROCEDURE", 600)
        if question_mode in {"procedure", "troubleshoot", "root_cause"}
        else _env_int("CHAT_CONTEXT_MAX_CHARS_QA", 420)
    )
    context_texts = [
        sanitize_prompt_input(
            _compact_context_text(getattr(d, "page_content", "") or "", context_chars),
            max_chars=context_chars,
        )
        for d in selected_docs
    ]
    citation_items = build_source_citations(selected_docs)
    max_score = get_doc_score(reranked_docs[0]) if reranked_docs else None
    task_prompt = _build_task_prompt(processed_msg, question_mode)

    # ============ CONFIDENCE GATE (Pre-LLM) ============
    enable_confidence_gate = _env_bool("ENABLE_CONFIDENCE_GATE", True)
    confidence_threshold = _env_float("CONFIDENCE_MIN_SCORE", 0.25)

    if enable_confidence_gate and not selected_docs:
        logger.warning(
            "\u26a0\ufe0f Confidence gate: No relevant documents found for query: %s",
            processed_msg[:100],
        )
        total_time = time.perf_counter() - t0
        return {
            "reply": (
                "I could not find any relevant information in the documentation to answer "
                "this question accurately.\n\n"
                "**Suggestions:**\n"
                "\u2022 Rephrase the question with specific terms (model number, error code, protocol)\n"
                "\u2022 Check if the topic is covered in the uploaded manuals\n"
                "\u2022 Ask about a related but more specific topic"
            ),
            "processing_time": total_time,
            "retrieval_time": retrieval_time,
            "context_count": 0,
            "sources": [],
            "ragas": None,
            "timing": {
                "retrieval_s": round(retrieval_time, 3),
                "rerank_s": round(rerank_time, 3),
                "llm_s": 0.0,
                "total_s": round(total_time, 3),
            },
            "citations": [],
            "max_score": round(max_score, 4) if max_score is not None else None,
            "confidence_gate": "no_docs",
        }

    if enable_confidence_gate and max_score is not None and max_score < confidence_threshold:
        logger.warning(
            "\u26a0\ufe0f Confidence gate triggered: max_score=%.4f < threshold=%.4f for query: %s",
            max_score, confidence_threshold, processed_msg[:100],
        )
        total_time = time.perf_counter() - t0
        return {
            "reply": (
                "I found some documents, but none are confident enough to provide an accurate answer.\n\n"
                f"**Confidence score: {max_score:.1%}** (minimum required: {confidence_threshold:.0%})\n\n"
                "**Suggestions:**\n"
                "\u2022 Try using exact model numbers or error codes in your question\n"
                "\u2022 Check if the relevant manual has been uploaded to the knowledge base\n"
                "\u2022 Ask about a more specific topic covered in the documentation"
            ),
            "processing_time": total_time,
            "retrieval_time": retrieval_time,
            "context_count": len(selected_docs),
            "sources": citation_items,
            "ragas": None,
            "timing": {
                "retrieval_s": round(retrieval_time, 3),
                "rerank_s": round(rerank_time, 3),
                "llm_s": 0.0,
                "total_s": round(total_time, 3),
            },
            "citations": citation_items,
            "max_score": round(max_score, 4),
            "confidence_gate": "low_score",
        }

    # ============ LLM PHASE ============
    t_llm_start = time.perf_counter()
    reply = None

    if reply is None and context_texts:
        context_headers = []
        for i, doc in enumerate(selected_docs):
            source_page = _doc_source_page(doc, fallback_index=i)
            page = source_page["page"]
            page_label = str(page) if page > 0 else "unknown"
            source_label = str(source_page["source"]).replace("\n", " ").strip()
            context_headers.append(
                f"<<<DOC {i + 1} source={source_label} page={page_label}>>>"
            )

        context_str = "\n\n---\n\n".join(
            f"{header}\n{content}" for header, content in zip(context_headers, context_texts)
        )
        prompt_template = build_enhanced_prompt()
        prompt_inputs = {
            "history_section": history_section,
            "context": context_str,
            "task_prompt": task_prompt,
            "question_mode": question_mode,
            "question": processed_msg,
        }
    elif reply is None:
        prompt_template = build_no_context_prompt()
        prompt_inputs = {
            "question": processed_msg,
        }
    if reply is None:
        rendered_prompt = prompt_template.format(**prompt_inputs)

    # LLM call with retry logic (exponential backoff)
    if reply is None:
        max_retries = max(1, _env_int("LLM_MAX_RETRIES", 1))
        for attempt in range(max_retries):
            try:
                reply = invoke_llm_with_fallback(llm, rendered_prompt)
                break  # Success, exit retry loop
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt  # 1s, 2s, 4s
                    logger.warning(f"LLM call failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s: {e}")
                    time.sleep(wait_time)
                else:
                    logger.error(f"LLM call failed after {max_retries} attempts: {e}")
                    raise

    reply = fix_markdown_tables(str(reply))  # Fix malformed markdown tables
    reply = _sanitize_prompt_leakage(reply)
    reply = _normalize_engineering_steps(reply, question_mode)
    reply = _enforce_numeric_guardrail(reply, context_texts, question_mode)
    if _contains_thai_script(reply):
        logger.info("Detected Thai script in assistant reply; enforcing English rewrite.")
        reply = _force_english_rewrite(llm, reply)
    if _looks_broken_reply(reply):
        logger.warning("⚠️ Broken/empty LLM reply detected. Replacing with safe fallback.")
        reply = (
            "I couldn't generate a usable answer right now.\n\n"
            "Please try:\n"
            "1. Rephrase the question in one clear sentence\n"
            "2. Ask a specific topic (for example: model, error code, or protocol)\n"
            "3. Try again in a few seconds"
        )

    # If we already have context-backed content, avoid a contradictory trailing fallback sentence.
    if context_texts:
        reply = re.sub(
            r"\n*\s*I couldn't find specific information about this\.?\s*$",
            "",
            reply,
            flags=re.IGNORECASE,
        ).strip()
    
    t_llm_end = time.perf_counter()
    llm_time = t_llm_end - t_llm_start

    # ============ RAGAS EVALUATION ============
    ragas_scores = None
    weighted_quality = None
    enable_chat_ragas = _env_bool("ENABLE_CHAT_RAGAS", False)
    allow_source_citations = True

    if enable_chat_ragas and context_texts:
        skip_ragas_check = _should_skip_ragas(processed_msg)

        try:
            from app.ragas_eval import simple_ragas_eval

            ragas_scores = simple_ragas_eval(
                question=processed_msg,
                answer=reply,
                contexts=context_texts,
            )

            # Check if quality is too low (but skip for identity/greeting questions)
            if not skip_ragas_check and ragas_scores and ragas_scores.get("scores"):
                scores = ragas_scores["scores"]
                threshold = _env_float("RAGAS_MIN_THRESHOLD", RAGAS_MIN_THRESHOLD)
                faith_hard_fail = _env_float(
                    "RAGAS_FAITHFULNESS_HARD_FAIL",
                    RAGAS_FAITHFULNESS_HARD_FAIL,
                )
                relevancy_hard_fail = _env_float(
                    "RAGAS_RELEVANCY_HARD_FAIL",
                    RAGAS_RELEVANCY_HARD_FAIL,
                )

                weighted_sum = 0.0
                weight_total = 0.0
                for metric, weight in RAGAS_METRIC_WEIGHTS.items():
                    val = scores.get(metric)
                    if val is None:
                        continue
                    weighted_sum += float(val) * float(weight)
                    weight_total += float(weight)
                weighted_quality = (weighted_sum / weight_total) if weight_total > 0 else None

                faithfulness = scores.get("faithfulness")
                relevancy = scores.get("answer_relevancy")
                hard_fail = (
                    (faithfulness is not None and float(faithfulness) < faith_hard_fail)
                    or (relevancy is not None and float(relevancy) < relevancy_hard_fail)
                )
                low_quality = (
                    weighted_quality is not None and weighted_quality < threshold
                )

                if hard_fail or low_quality:
                    reply = (
                        "I'm sorry, but I don't have enough reliable information in my documents "
                        "to answer this question accurately. The context I found may not be "
                        "relevant or sufficient.\n\n"
                        "**Please try:**\n"
                        "• Rephrasing your question\n"
                        "• Asking about a more specific topic\n"
                        "• Checking if the topic is covered in the documentation"
                    )
                    logger.warning(
                        "⚠️ RAGAS quality gate triggered "
                        f"(weighted={weighted_quality if weighted_quality is not None else 'N/A'}, "
                        f"faithfulness={faithfulness}, relevancy={relevancy}, "
                        f"threshold={threshold}, hard_fail={hard_fail}). "
                        "Replacing with fallback response."
                    )
                    allow_source_citations = False
        except Exception as e:
            logger.warning(f"RAGAS evaluation failed: {e}")
            ragas_scores = None

    force_all_modes = _env_bool("FORCE_CITATIONS_ALL_MODES", True)
    should_cite = allow_source_citations and (
        force_all_modes or question_mode == "qa"
    ) and _env_bool("APPEND_SOURCE_CITATIONS", True)
    if should_cite:
        citations = build_citations_from_docs(selected_docs)
        if citations:
            reply += "\n\nSources:\n- " + "\n- ".join(citations)

    total_time = time.perf_counter() - t0

    # ============ LOG THE REQUEST ============
    log_chat_request(
        question=question,
        answer=reply,
        retrieval_time=retrieval_time,
        rerank_time=rerank_time,
        llm_time=llm_time,
        total_time=total_time,
        retrieved_docs=raw_retrieved_docs,
        reranked_docs=reranked_docs,
        selected_docs=selected_docs,
        max_score=max_score,
        ragas_scores=ragas_scores,
    )
    ragas_payload = None
    if ragas_scores:
        ragas_payload = dict(ragas_scores)
        if weighted_quality is not None:
            ragas_payload["quality_score"] = weighted_quality

    return {
        "reply": reply,
        "processing_time": total_time,
        "retrieval_time": retrieval_time,
        "context_count": len(selected_docs),
        "sources": citation_items,
        "ragas": ragas_payload,
        "timing": {
            "retrieval_s": round(retrieval_time, 3),
            "rerank_s": round(rerank_time, 3),
            "llm_s": round(llm_time, 3),
            "total_s": round(total_time, 3),
        },
        "citations": citation_items,
        "max_score": round(max_score, 4) if max_score is not None else None,
    }
