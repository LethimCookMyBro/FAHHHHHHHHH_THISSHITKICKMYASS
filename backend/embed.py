"""
Incremental embedding CLI for PDF/JSON knowledge files.

Default behavior:
- Manual command mode
- Checksum-based skip/re-embed
- Persistent ingest state on disk (supports Railway volume)

Examples:
    python /app/backend/embed.py /data/Knowledge \
      --collection plcnext \
      --knowledge-root /data/Knowledge \
      --state-path /data/ingest/state.json \
      --skip-mode checksum \
      --bootstrap-from-db \
      --replace-updated
"""

import argparse
import gc
import glob
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Force Docling to use CPU if EMBED_USE_CPU is set (prevents OOM on small GPU instances)
FORCE_EMBED_CPU = os.getenv("EMBED_USE_CPU", "false").strip().lower() in {"1", "true", "yes", "on"}
if FORCE_EMBED_CPU:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    os.environ["DOCLING_DEVICE"] = "cpu"
    print("[embed] forcing Docling CPU mode (EMBED_USE_CPU=true)")

from dotenv import load_dotenv
from docling.datamodel.accelerator_options import AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import ThreadedPdfPipelineOptions
from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
from langchain_core.documents import Document
from langchain_docling import DoclingLoader
from langchain_docling.loader import ExportType
from psycopg2.extras import execute_values
from sentence_transformers import SentenceTransformer
import psycopg2
import torch
from tqdm import tqdm

from app.embed_logic import (
    create_json_qa_chunks,
    create_pdf_chunks,
    get_embedding_instruction,
)
from app.env_resolver import redact_database_url, resolve_database_url
from app.ingest_state import (
    bootstrap_state_from_db,
    build_lock_path,
    load_state,
    save_state,
    with_lock,
)


# ==== Config ==== 
load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-m3")
# --- Imported Refactored Components ---
from embed_cli import (
    parse_args,
    DEFAULT_COLLECTION,
    DEFAULT_KNOWLEDGE_DIR,
    DEFAULT_MODEL_CACHE,
    DEFAULT_INGEST_STATE_PATH,
    DEFAULT_EMBED_DEVICE,
    DEFAULT_EMBED_MAX_TOKENS,
    DEFAULT_EMBED_TOKEN_OVERLAP,
    DEFAULT_ENCODE_BATCH_SIZE,
    DEFAULT_DB_RETRIES,
    DEFAULT_DB_CONNECT_TIMEOUT,
    DEFAULT_DB_KEEPALIVES_IDLE,
    DEFAULT_DB_KEEPALIVES_INTERVAL,
    DEFAULT_DB_KEEPALIVES_COUNT,
    DEFAULT_FALLBACK_CPU_ON_CUDA_ERROR,
    DEFAULT_DOCLING_OCR,
    DEFAULT_DOCLING_TABLE_STRUCTURE,
    DEFAULT_DOCLING_FORCE_BACKEND_TEXT,
    DEFAULT_DOCLING_IMAGES_SCALE,
)

from embed_files import (
    FileRecord,
    discover_files,
    build_file_records,
    build_chunk_metadata,
    build_state_entry,
)

def utc_now_iso() -> str:
    from datetime import datetime
    import tzlocal
    return datetime.now(tzlocal.get_localzone()).isoformat()

def _normalize_device(device: str) -> str:
    requested = str(device or "auto").strip().lower()
    if requested in ("cuda", "gpu"):
        return "cuda:0"
    return requested


def _validate_cuda_device(requested: str) -> str:
    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA requested but torch.cuda.is_available() is False. "
            f"torch.version.cuda={torch.version.cuda!s}. "
            "Install CUDA-enabled torch and verify NVIDIA runtime."
        )

    if requested == "cuda":
        requested = "cuda:0"

    try:
        index = int(requested.split(":", 1)[1]) if ":" in requested else 0
    except Exception as e:
        raise RuntimeError(f"Invalid CUDA device '{requested}': {e}") from e

    count = torch.cuda.device_count()
    if index < 0 or index >= count:
        raise RuntimeError(f"CUDA device '{requested}' out of range. device_count={count}")

    gpu_name = torch.cuda.get_device_name(index)
    logging.info(
        "Using GPU device=%s name=%s torch=%s cuda=%s",
        requested,
        gpu_name,
        torch.__version__,
        torch.version.cuda,
    )
    return requested


def get_device(requested_device: str = "auto") -> str:
    requested = _normalize_device(requested_device)

    if requested == "cpu":
        logging.info("Using CPU by explicit request (--device=cpu)")
        return "cpu"

    if FORCE_EMBED_CPU:
        if requested.startswith("cuda"):
            raise RuntimeError(
                "EMBED_USE_CPU=true conflicts with requested CUDA device. "
                "Unset EMBED_USE_CPU or use --device=cpu."
            )
        logging.info("Using CPU because EMBED_USE_CPU=true")
        return "cpu"

    if requested.startswith("cuda"):
        return _validate_cuda_device(requested)

    if torch.cuda.is_available():
        return _validate_cuda_device("cuda:0")

    logging.warning(
        "GPU not available, falling back to CPU. torch=%s torch.version.cuda=%s",
        torch.__version__,
        torch.version.cuda,
    )
    return "cpu"


def load_chunks_for_file(
    file_record: FileRecord,
    *,
    chunk_size: int,
    chunk_overlap: int,
    embedded_at: str,
    force_docling_cpu: bool = False,
    docling_do_ocr: bool = True,
    docling_do_table_structure: bool = True,
    docling_force_backend_text: bool = False,
    docling_images_scale: float = 1.0,
) -> List[Document]:
    extra_metadata = build_chunk_metadata(file_record, embedded_at)
    lower = file_record.path.lower()

    if lower.endswith(".json"):
        return create_json_qa_chunks(file_record.path, extra_metadata=extra_metadata)

    if lower.endswith(".pdf"):
        previous_docling_device = os.environ.get("DOCLING_DEVICE")
        if force_docling_cpu:
            os.environ["DOCLING_DEVICE"] = "cpu"
        try:
            docling_device = "cpu" if force_docling_cpu else "auto"
            accel = AcceleratorOptions(device=docling_device)
            pipeline = ThreadedPdfPipelineOptions(
                accelerator_options=accel,
                do_ocr=bool(docling_do_ocr),
                do_table_structure=bool(docling_do_table_structure),
                force_backend_text=bool(docling_force_backend_text),
                images_scale=max(0.1, float(docling_images_scale)),
            )
            converter = DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline),
                    InputFormat.IMAGE: ImageFormatOption(pipeline_options=pipeline),
                }
            )
            loader_kwargs: Dict[str, Any] = {
                "file_path": file_record.path,
                "export_type": ExportType.DOC_CHUNKS,
                "converter": converter,
            }

            loader = DoclingLoader(**loader_kwargs)
            pages = loader.load()
            return create_pdf_chunks(
                pages,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                extra_metadata=extra_metadata,
            )
        finally:
            if force_docling_cpu:
                if previous_docling_device is None:
                    os.environ.pop("DOCLING_DEVICE", None)
                else:
                    os.environ["DOCLING_DEVICE"] = previous_docling_device

    return []


def delete_source_rows(
    cur,
    collection: str,
    source_key: str,
    source_name: str,
    *,
    include_legacy_basename: bool = True,
) -> int:
    """
    Remove rows for one source.
    - Primary match: metadata->>'source_key'
    - Backward compatibility: legacy rows without source_key, matched by basename in metadata->>'source'
    """
    if include_legacy_basename:
        cur.execute(
            """
            DELETE FROM documents
            WHERE collection = %s
              AND (
                metadata->>'source_key' = %s
                OR (
                  COALESCE(metadata->>'source_key', '') = ''
                  AND metadata->>'source' = %s
                )
              )
            """,
            (collection, source_key, source_name),
        )
    else:
        cur.execute(
            """
            DELETE FROM documents
            WHERE collection = %s
              AND metadata->>'source_key' = %s
            """,
            (collection, source_key),
        )
    return int(cur.rowcount or 0)


def clear_torch_cache() -> None:
    gc.collect()
    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        # CUDA context may already be poisoned; cache clear should never crash ingest.
        pass


def is_connection_open(conn) -> bool:
    return conn is not None and getattr(conn, "closed", 1) == 0


def safe_rollback(conn) -> None:
    if not is_connection_open(conn):
        return
    try:
        conn.rollback()
    except Exception:
        pass


def close_connection(conn) -> None:
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass


def connect_db(db_url: str):
    return psycopg2.connect(
        db_url,
        connect_timeout=DEFAULT_DB_CONNECT_TIMEOUT,
        keepalives=1,
        keepalives_idle=DEFAULT_DB_KEEPALIVES_IDLE,
        keepalives_interval=DEFAULT_DB_KEEPALIVES_INTERVAL,
        keepalives_count=DEFAULT_DB_KEEPALIVES_COUNT,
    )


def is_transient_db_error(exc: Exception) -> bool:
    if isinstance(exc, (psycopg2.OperationalError, psycopg2.InterfaceError)):
        return True
    msg = str(exc or "").lower()
    transient_signals = (
        "connection timed out",
        "ssl syscall error",
        "server closed the connection unexpectedly",
        "could not receive data from server",
        "connection already closed",
        "terminating connection",
    )
    return any(sig in msg for sig in transient_signals)


def reconnect_db(conn, db_url: Optional[str], reason: str):
    if not db_url:
        return conn
    close_connection(conn)
    logging.warning("Reconnecting DB due to: %s", reason)
    return connect_db(db_url)


def is_cuda_runtime_error(exc: Exception) -> bool:
    msg = str(exc or "").lower()
    signals = (
        "cuda error",
        "cudart",
        "device-side assertions",
        "cuda kernel errors might be asynchronously reported",
        "torch.use_cuda_dsa",
    )
    return any(sig in msg for sig in signals)


def load_sentence_embedder(
    model_name: str,
    cache_folder: str,
    device: str,
    max_embed_tokens: int,
) -> SentenceTransformer:
    logging.info("Loading embed model: %s", model_name)
    embedder = SentenceTransformer(model_name, device=device, cache_folder=cache_folder)
    try:
        embedder.max_seq_length = max(32, int(max_embed_tokens))
        logging.info("Embedder max_seq_length set to %d", embedder.max_seq_length)
    except Exception:
        logging.warning("Could not set embedder max_seq_length; relying on model defaults")
    logging.info("Embed model loaded on %s", device)
    return embedder


def _resolve_embedder_tokenizer(embedder: SentenceTransformer):
    tokenizer = getattr(embedder, "tokenizer", None)
    if tokenizer is not None:
        return tokenizer
    try:
        first = embedder._first_module()
        tokenizer = getattr(first, "tokenizer", None)
        if tokenizer is not None:
            return tokenizer
    except Exception:
        pass
    return None


def _token_ids(text: str, tokenizer) -> List[int]:
    encoded = tokenizer(
        text,
        add_special_tokens=False,
        truncation=False,
        return_attention_mask=False,
        return_token_type_ids=False,
    )
    input_ids = encoded.get("input_ids", [])
    if not input_ids:
        return []
    if isinstance(input_ids[0], list):
        return list(input_ids[0])
    return list(input_ids)


def enforce_chunk_token_limit(
    chunks: List[Document],
    embedder: SentenceTransformer,
    *,
    max_tokens: int,
    overlap_tokens: int,
) -> Tuple[List[Document], Dict[str, int]]:
    """
    Split oversized chunks by tokenizer window to avoid silent truncation.
    """
    tokenizer = _resolve_embedder_tokenizer(embedder)
    if tokenizer is None:
        return chunks, {"split_chunks": 0, "max_tokens_seen": 0, "expanded_chunks": len(chunks)}

    max_tokens = max(32, int(max_tokens))
    overlap_tokens = max(0, min(int(overlap_tokens), max_tokens - 1))
    stride = max(1, max_tokens - overlap_tokens)

    expanded: List[Document] = []
    split_chunks = 0
    max_tokens_seen = 0

    for chunk in chunks:
        text = chunk.page_content or ""
        ids = _token_ids(text, tokenizer)
        token_len = len(ids)
        if token_len <= max_tokens:
            expanded.append(chunk)
            max_tokens_seen = max(max_tokens_seen, token_len)
            continue

        split_chunks += 1
        max_tokens_seen = max(max_tokens_seen, token_len)

        windows: List[Tuple[int, int, str]] = []
        for start in range(0, token_len, stride):
            end = min(token_len, start + max_tokens)
            window_ids = ids[start:end]
            window_text = tokenizer.decode(
                window_ids,
                skip_special_tokens=True,
                clean_up_tokenization_spaces=True,
            ).strip()
            if window_text:
                windows.append((start, end, window_text))
            if end >= token_len:
                break

        parts = len(windows)
        if parts <= 1:
            expanded.append(chunk)
            continue

        base_meta = dict(chunk.metadata or {})
        for idx, (start, end, window_text) in enumerate(windows, start=1):
            meta = base_meta.copy()
            meta.update(
                {
                    "token_split": True,
                    "token_part": idx,
                    "token_parts": parts,
                    "token_start": start,
                    "token_end": end,
                    "token_total": token_len,
                }
            )
            expanded.append(Document(page_content=window_text, metadata=meta))

    return expanded, {
        "split_chunks": split_chunks,
        "max_tokens_seen": max_tokens_seen,
        "expanded_chunks": len(expanded),
    }


def insert_chunks_for_file(
    conn,
    embedder: SentenceTransformer,
    chunks: List[Document],
    collection: str,
    *,
    batch_size: int,
    encode_batch_size: int,
    replace_source: Optional[Tuple[str, str, bool]] = None,
) -> Tuple[int, int]:
    """
    Insert chunks for one file in a single DB transaction.

    Returns:
      (inserted_rows, deleted_rows)
    """
    inserted_total = 0
    deleted_rows = 0

    encode_batch_size = max(1, int(encode_batch_size))

    with conn.cursor() as cur:
        if replace_source is not None:
            source_key, source_name, include_legacy_basename = replace_source
            deleted_rows = delete_source_rows(
                cur,
                collection,
                source_key,
                source_name,
                include_legacy_basename=include_legacy_basename,
            )

        for idx in range(0, len(chunks), batch_size):
            batch = chunks[idx : idx + batch_size]
            texts: List[str] = []
            for chunk in batch:
                chunk_type = (chunk.metadata or {}).get("chunk_type", "prose")
                instruction = get_embedding_instruction(str(chunk_type))
                texts.append(instruction + chunk.page_content)

            embeddings = embedder.encode(
                texts,
                show_progress_bar=False,
                batch_size=encode_batch_size,
                normalize_embeddings=True,
            )

            batch_data = []
            for chunk, emb in zip(batch, embeddings):
                content = chunk.page_content
                chunk_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                metadata_json = json.dumps(chunk.metadata or {}, ensure_ascii=False)
                batch_data.append((content, emb.tolist(), collection, chunk_hash, metadata_json))

            execute_values(
                cur,
                """
                INSERT INTO documents (content, embedding, collection, hash, metadata)
                VALUES %s
                ON CONFLICT (hash) DO NOTHING
                """,
                batch_data,
                template="(%s, %s, %s, %s, %s)",
            )
            inserted_total += int(cur.rowcount or 0)
            clear_torch_cache()

    conn.commit()
    return inserted_total, deleted_rows





def main() -> None:
    args = parse_args()

    knowledge_root = os.path.abspath(args.knowledge_root)
    input_paths = args.files if args.files else [knowledge_root]
    state_path = os.path.abspath(args.state_path)
    lock_path = build_lock_path(state_path)

    all_files = discover_files(input_paths)
    if not all_files:
        logging.error("No PDF/JSON files found for paths: %s", input_paths)
        raise SystemExit(1)

    logging.info("Discovered %d files", len(all_files))
    logging.info("Knowledge root: %s", knowledge_root)
    logging.info("Ingest state: %s", state_path)
    logging.info("Skip mode: %s | replace_updated=%s | bootstrap_from_db=%s", args.skip_mode, args.replace_updated, args.bootstrap_from_db)
    logging.info("Requested embed device: %s", args.device)
    logging.info(
        "DB resilience: retries=%d connect_timeout=%ds keepalives_idle=%ds interval=%ds count=%d",
        max(0, int(args.db_retries)),
        DEFAULT_DB_CONNECT_TIMEOUT,
        DEFAULT_DB_KEEPALIVES_IDLE,
        DEFAULT_DB_KEEPALIVES_INTERVAL,
        DEFAULT_DB_KEEPALIVES_COUNT,
    )
    logging.info(
        "CUDA fallback: enabled=%s",
        DEFAULT_FALLBACK_CPU_ON_CUDA_ERROR,
    )
    logging.info(
        "Token guard: max_embed_tokens=%d embed_token_overlap=%d encode_batch_size=%d",
        max(32, int(args.max_embed_tokens)),
        max(0, int(args.embed_token_overlap)),
        max(1, int(args.encode_batch_size)),
    )
    logging.info(
        "Docling options: do_ocr=%s do_table_structure=%s force_backend_text=%s images_scale=%.2f",
        bool(args.docling_do_ocr),
        bool(args.docling_do_table_structure),
        bool(args.docling_force_backend_text),
        max(0.1, float(args.docling_images_scale)),
    )

    file_records = build_file_records(all_files, knowledge_root)
    source_name_counts: Dict[str, int] = {}
    for rec in file_records:
        source_name_counts[rec.source] = source_name_counts.get(rec.source, 0) + 1

    # Load embedder only when writing embeddings.
    embedder = None
    device = get_device(args.device)
    active_embed_device = device
    active_encode_batch_size = max(1, int(args.encode_batch_size))

    docling_env = (os.getenv("DOCLING_DEVICE", "") or "").strip().lower()
    docling_force_cpu = docling_env == "cpu"
    if not docling_env and active_embed_device.startswith("cuda"):
        # Keep VRAM for embeddings; Docling GPU + embed GPU is unstable on small GPUs.
        docling_force_cpu = True
        os.environ["DOCLING_DEVICE"] = "cpu"
        logging.info(
            "Docling device auto-set to CPU while embeddings use %s (set DOCLING_DEVICE=cuda to override)",
            active_embed_device,
        )
    if not args.dry_run:
        Path(args.model_cache).mkdir(parents=True, exist_ok=True)
        embedder = load_sentence_embedder(
            EMBED_MODEL,
            args.model_cache,
            active_embed_device,
            int(args.max_embed_tokens),
        )

    # DB connection (required for non-dry run; optional in dry-run).
    conn = None
    db_url = None
    needs_db = (not args.dry_run) or args.bootstrap_from_db or args.prune_missing
    if needs_db:
        try:
            db_url, source = resolve_database_url()
            logging.info("Database URL source: %s", source)
            logging.info("DB target: %s", redact_database_url(db_url))
            conn = connect_db(db_url)
        except Exception as e:
            if args.dry_run:
                logging.warning("DB unavailable in dry-run. bootstrap/prune disabled. error=%s", e)
                args.bootstrap_from_db = False
                args.prune_missing = False
            else:
                logging.error("Failed to connect DB: %s", e)
                raise

    total_inserted = 0
    files_embedded = 0
    files_skipped = 0
    files_replaced = 0
    files_failed = 0
    files_bootstrapped = 0

    try:
        with with_lock(lock_path):
            logging.info("Acquired ingest lock: %s", lock_path)
            state, is_new_state = load_state(state_path, collection=args.collection, knowledge_root=knowledge_root)
            state_files: Dict[str, Dict[str, Any]] = state.setdefault("files", {})

            bootstrapped_recent: set[str] = set()
            if (
                is_new_state
                and args.bootstrap_from_db
                and conn is not None
            ):
                bootstrap_payload = [
                    {
                        "source_key": rec.source_key,
                        "source": rec.source,
                        "sha256": rec.sha256,
                        "size": rec.size,
                        "mtime": rec.mtime,
                    }
                    for rec in file_records
                ]
                result = bootstrap_state_from_db(
                    conn,
                    state=state,
                    collection=args.collection,
                    file_records=bootstrap_payload,
                )
                files_bootstrapped = int(result.get("bootstrapped", 0))
                bootstrapped_recent = set(result.get("keys", []))
                for key in sorted(bootstrapped_recent):
                    logging.info("BOOTSTRAP_SKIP source_key=%s", key)

                if files_bootstrapped > 0 and not args.dry_run:
                    save_state(state_path, state)

            if args.prune_missing:
                discovered = {rec.source_key for rec in file_records}
                missing_keys = sorted(set(state_files.keys()) - discovered)
                if missing_keys:
                    if args.dry_run:
                        for key in missing_keys:
                            logging.info("PRUNE_MISSING (dry-run) source_key=%s", key)
                    elif conn is None:
                        logging.warning("Skipping prune-missing: DB connection unavailable")
                    else:
                        deleted_total = 0
                        try:
                            if not is_connection_open(conn):
                                conn = reconnect_db(conn, db_url, "prune-missing on closed connection")
                            state_source_counts: Dict[str, int] = {}
                            for entry in state_files.values():
                                src = str(entry.get("source") or "")
                                if src:
                                    state_source_counts[src] = state_source_counts.get(src, 0) + 1
                            with conn.cursor() as cur:
                                for key in missing_keys:
                                    source_name = str(state_files.get(key, {}).get("source") or os.path.basename(key))
                                    deleted_total += delete_source_rows(
                                        cur,
                                        args.collection,
                                        key,
                                        source_name,
                                        include_legacy_basename=state_source_counts.get(source_name, 0) == 1,
                                    )
                                    state_files.pop(key, None)
                                    logging.info("PRUNE_MISSING source_key=%s", key)
                            conn.commit()
                            save_state(state_path, state)
                            logging.info(
                                "Pruned %d missing file(s), deleted %d DB rows",
                                len(missing_keys),
                                deleted_total,
                            )
                        except Exception:
                            safe_rollback(conn)
                            raise

            for rec in tqdm(file_records, desc="Processing", unit="file"):
                source_key = rec.source_key
                entry = state_files.get(source_key)

                if source_key in bootstrapped_recent and not args.replace_all:
                    files_skipped += 1
                    continue

                should_embed = False
                replace_old = False

                if args.replace_all:
                    logging.info("REPLACE_ALL source_key=%s", source_key)
                    should_embed = True
                    replace_old = True
                elif entry is None:
                    logging.info("EMBED_NEW source_key=%s", source_key)
                    should_embed = True
                else:
                    if args.skip_mode == "filename":
                        logging.info("SKIP_UNCHANGED source_key=%s reason=filename", source_key)
                        files_skipped += 1
                        continue

                    prev_sha = str(entry.get("sha256") or "")
                    if prev_sha == rec.sha256:
                        logging.info("SKIP_UNCHANGED source_key=%s reason=checksum", source_key)
                        files_skipped += 1
                        continue

                    if not args.replace_updated:
                        logging.info("SKIP_UNCHANGED source_key=%s reason=updated_no_replace", source_key)
                        files_skipped += 1
                        continue

                    logging.info(
                        "REPLACE_UPDATED source_key=%s old_sha=%s new_sha=%s",
                        source_key,
                        prev_sha[:12],
                        rec.sha256[:12],
                    )
                    should_embed = True
                    replace_old = True

                if not should_embed:
                    continue

                embedded_at = utc_now_iso()

                chunks = []
                parse_ok = False
                for parse_attempt in range(2):
                    try:
                        chunks = load_chunks_for_file(
                            rec,
                            chunk_size=args.chunk_size,
                            chunk_overlap=args.chunk_overlap,
                            embedded_at=embedded_at,
                            force_docling_cpu=docling_force_cpu,
                            docling_do_ocr=bool(args.docling_do_ocr),
                            docling_do_table_structure=bool(args.docling_do_table_structure),
                            docling_force_backend_text=bool(args.docling_force_backend_text),
                            docling_images_scale=max(0.1, float(args.docling_images_scale)),
                        )
                        parse_ok = True
                        break
                    except Exception as e:
                        can_retry_cpu = (
                            DEFAULT_FALLBACK_CPU_ON_CUDA_ERROR
                            and parse_attempt == 0
                            and not docling_force_cpu
                            and is_cuda_runtime_error(e)
                        )
                        if can_retry_cpu:
                            logging.warning(
                                "CUDA parse error on %s. Switching Docling to CPU and retrying once.",
                                source_key,
                            )
                            docling_force_cpu = True
                            os.environ["DOCLING_DEVICE"] = "cpu"
                            continue
                        files_failed += 1
                        logging.error("Failed to parse %s: %s", rec.path, e, exc_info=True)
                        break

                if not parse_ok:
                    continue

                final_chunks = chunks
                if not args.dry_run and embedder is not None:
                    final_chunks, split_stats = enforce_chunk_token_limit(
                        chunks,
                        embedder,
                        max_tokens=int(args.max_embed_tokens),
                        overlap_tokens=int(args.embed_token_overlap),
                    )
                    if split_stats.get("split_chunks", 0) > 0:
                        logging.warning(
                            "TOKEN_SPLIT source_key=%s split_chunks=%d original_chunks=%d final_chunks=%d max_tokens_seen=%d",
                            source_key,
                            split_stats.get("split_chunks", 0),
                            len(chunks),
                            split_stats.get("expanded_chunks", len(final_chunks)),
                            split_stats.get("max_tokens_seen", 0),
                        )

                if args.dry_run:
                    logging.info(
                        "DRY_RUN source_key=%s action=%s chunks=%d",
                        source_key,
                        "replace" if replace_old else "embed",
                        len(final_chunks),
                    )
                    continue

                if conn is None or embedder is None:
                    files_failed += 1
                    logging.error("Cannot embed %s: DB connection or embedder unavailable", source_key)
                    continue

                inserted = 0
                deleted = 0
                file_embedded = False
                max_db_retries = max(0, int(args.db_retries))
                for attempt in range(max_db_retries + 1):
                    try:
                        if not is_connection_open(conn):
                            conn = reconnect_db(conn, db_url, f"closed connection before embed {source_key}")

                        inserted, deleted = insert_chunks_for_file(
                            conn,
                            embedder,
                            final_chunks,
                            args.collection,
                            batch_size=max(1, int(args.batch_size)),
                            encode_batch_size=active_encode_batch_size,
                            replace_source=(
                                source_key,
                                rec.source,
                                source_name_counts.get(rec.source, 0) == 1,
                            ) if replace_old else None,
                        )
                        file_embedded = True
                        break
                    except Exception as e:
                        safe_rollback(conn)
                        cuda_error = is_cuda_runtime_error(e)
                        if cuda_error and active_embed_device.startswith("cuda"):
                            if active_encode_batch_size > 1:
                                reduced_batch_size = max(1, active_encode_batch_size // 2)
                                if reduced_batch_size < active_encode_batch_size:
                                    logging.warning(
                                        "CUDA embedding error on %s. Reducing encode_batch_size %d -> %d and retrying.",
                                        source_key,
                                        active_encode_batch_size,
                                        reduced_batch_size,
                                    )
                                    active_encode_batch_size = reduced_batch_size
                                    clear_torch_cache()
                                    continue

                        if (
                            DEFAULT_FALLBACK_CPU_ON_CUDA_ERROR
                            and cuda_error
                            and active_embed_device.startswith("cuda")
                        ):
                            logging.warning(
                                "CUDA embedding error on %s. Switching embedder to CPU and retrying.",
                                source_key,
                            )
                            try:
                                active_embed_device = "cpu"
                                embedder = load_sentence_embedder(
                                    EMBED_MODEL,
                                    args.model_cache,
                                    active_embed_device,
                                    int(args.max_embed_tokens),
                                )
                                docling_force_cpu = True
                                os.environ["DOCLING_DEVICE"] = "cpu"
                                continue
                            except Exception as load_e:
                                files_failed += 1
                                logging.error(
                                    "Failed to switch embedder to CPU for %s: %s",
                                    source_key,
                                    load_e,
                                    exc_info=True,
                                )
                                break

                        transient = is_transient_db_error(e)
                        if transient and attempt < max_db_retries:
                            logging.warning(
                                "Transient DB error while embedding %s (attempt %d/%d): %s",
                                source_key,
                                attempt + 1,
                                max_db_retries + 1,
                                e,
                            )
                            conn = reconnect_db(conn, db_url, f"embed retry for {source_key}")
                            continue
                        files_failed += 1
                        logging.error("Failed to embed %s: %s", source_key, e, exc_info=True)
                        break

                if not file_embedded:
                    continue

                state_files[source_key] = build_state_entry(
                    rec,
                    chunk_count=len(final_chunks),
                    embedded_at=embedded_at,
                    bootstrapped=False,
                )
                save_state(state_path, state)

                total_inserted += inserted
                files_embedded += 1
                if replace_old:
                    files_replaced += 1

                logging.info(
                    "Embedded %s | chunks=%d inserted=%d deleted_old=%d",
                    source_key,
                    len(final_chunks),
                    inserted,
                    deleted,
                )

    finally:
        close_connection(conn)

    logging.info("=" * 64)
    logging.info("Ingest complete")
    logging.info(
        "files=%d embedded=%d replaced=%d skipped=%d bootstrapped=%d failed=%d inserted_chunks=%d",
        len(file_records),
        files_embedded,
        files_replaced,
        files_skipped,
        files_bootstrapped,
        files_failed,
        total_inserted,
    )
    logging.info("=" * 64)


if __name__ == "__main__":
    main()
