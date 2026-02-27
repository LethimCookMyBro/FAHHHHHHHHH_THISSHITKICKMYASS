import argparse
import os

DEFAULT_COLLECTION = os.getenv("DEFAULT_COLLECTION", "plcnext")
DEFAULT_KNOWLEDGE_DIR = os.getenv("KNOWLEDGE_DIR", "/data/Knowledge")
DEFAULT_MODEL_CACHE = os.getenv("MODEL_CACHE", "/data/models")
DEFAULT_INGEST_STATE_PATH = os.getenv("INGEST_STATE_PATH", "/data/ingest/state.json")
DEFAULT_EMBED_DEVICE = (os.getenv("EMBED_DEVICE", "auto") or "auto").strip()

def _env_int(key: str, default: int, minimum: int = 1) -> int:
    try:
        val = int(os.getenv(key, str(default)))
        return max(minimum, val)
    except Exception:
        return max(minimum, default)

def _env_bool(key: str, default: bool = False) -> bool:
    val = str(os.getenv(key, "")).strip().lower()
    if val in ("1", "true", "yes", "on"):
        return True
    if val in ("0", "false", "no", "off"):
        return False
    return default

def _env_float(key: str, default: float, minimum: float = 0.0) -> float:
    try:
        val = float(os.getenv(key, str(default)))
        return max(minimum, val)
    except Exception:
        return max(minimum, default)

DEFAULT_EMBED_MAX_TOKENS = _env_int("EMBED_MAX_TOKENS", 480, minimum=32)
DEFAULT_EMBED_TOKEN_OVERLAP = _env_int("EMBED_TOKEN_OVERLAP", 64, minimum=0)
DEFAULT_ENCODE_BATCH_SIZE = _env_int("EMBED_ENCODE_BATCH_SIZE", 8, minimum=1)
DEFAULT_DB_RETRIES = _env_int("EMBED_DB_RETRIES", 3, minimum=0)
DEFAULT_DB_CONNECT_TIMEOUT = _env_int("EMBED_DB_CONNECT_TIMEOUT", 10, minimum=1)
DEFAULT_DB_KEEPALIVES_IDLE = _env_int("EMBED_DB_KEEPALIVES_IDLE", 30, minimum=1)
DEFAULT_DB_KEEPALIVES_INTERVAL = _env_int("EMBED_DB_KEEPALIVES_INTERVAL", 10, minimum=1)
DEFAULT_DB_KEEPALIVES_COUNT = _env_int("EMBED_DB_KEEPALIVES_COUNT", 3, minimum=1)
DEFAULT_FALLBACK_CPU_ON_CUDA_ERROR = _env_bool("EMBED_FALLBACK_TO_CPU_ON_CUDA_ERROR", True)
DEFAULT_DOCLING_OCR = _env_bool("EMBED_DOCLING_OCR", True)
DEFAULT_DOCLING_TABLE_STRUCTURE = _env_bool("EMBED_DOCLING_TABLE_STRUCTURE", True)
DEFAULT_DOCLING_FORCE_BACKEND_TEXT = _env_bool("EMBED_DOCLING_FORCE_BACKEND_TEXT", False)
DEFAULT_DOCLING_IMAGES_SCALE = _env_float("EMBED_DOCLING_IMAGES_SCALE", 1.0, minimum=0.1)

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Incremental embedding into PostgreSQL pgvector with persistent ingest state.",
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="Path(s) to PDF/JSON file(s) or folder(s). If omitted, --knowledge-root is used.",
    )
    parser.add_argument("--collection", default=DEFAULT_COLLECTION, help="Collection name")
    parser.add_argument("--batch-size", type=int, default=1000, help="Chunks per DB insert batch")
    parser.add_argument("--chunk-size", type=int, default=800, help="Max chars per chunk")
    parser.add_argument("--chunk-overlap", type=int, default=150, help="Chunk overlap chars")
    parser.add_argument("--model-cache", default=DEFAULT_MODEL_CACHE, help="Model cache directory")
    parser.add_argument(
        "--device",
        default=DEFAULT_EMBED_DEVICE,
        help="Embedding device: auto|cpu|cuda|cuda:N (default from EMBED_DEVICE or auto)",
    )
    parser.add_argument(
        "--max-embed-tokens",
        type=int,
        default=DEFAULT_EMBED_MAX_TOKENS,
        help="Hard token limit per chunk before embedding (default from EMBED_MAX_TOKENS)",
    )
    parser.add_argument(
        "--embed-token-overlap",
        type=int,
        default=DEFAULT_EMBED_TOKEN_OVERLAP,
        help="Token overlap used when splitting oversized chunks",
    )
    parser.add_argument(
        "--docling-do-ocr",
        dest="docling_do_ocr",
        action="store_true",
        help="Enable OCR in Docling parse pipeline (slower, needed for scanned PDFs)",
    )
    parser.add_argument(
        "--no-docling-do-ocr",
        dest="docling_do_ocr",
        action="store_false",
        help="Disable OCR in Docling parse pipeline for faster processing on text PDFs",
    )
    parser.set_defaults(docling_do_ocr=DEFAULT_DOCLING_OCR)
    parser.add_argument(
        "--docling-do-table-structure",
        dest="docling_do_table_structure",
        action="store_true",
        help="Enable Docling table-structure model (more accurate tables, slower)",
    )
    parser.add_argument(
        "--no-docling-do-table-structure",
        dest="docling_do_table_structure",
        action="store_false",
        help="Disable Docling table-structure model for faster parsing",
    )
    parser.set_defaults(docling_do_table_structure=DEFAULT_DOCLING_TABLE_STRUCTURE)
    parser.add_argument(
        "--docling-force-backend-text",
        dest="docling_force_backend_text",
        action="store_true",
        help="Prefer PDF backend text layer instead of layout text extraction (faster for text PDFs)",
    )
    parser.add_argument(
        "--no-docling-force-backend-text",
        dest="docling_force_backend_text",
        action="store_false",
        help="Use default Docling text extraction flow",
    )
    parser.set_defaults(docling_force_backend_text=DEFAULT_DOCLING_FORCE_BACKEND_TEXT)
    parser.add_argument(
        "--docling-images-scale",
        type=float,
        default=DEFAULT_DOCLING_IMAGES_SCALE,
        help="Docling image scale; lower is faster (default 1.0)",
    )
    parser.add_argument(
        "--encode-batch-size",
        type=int,
        default=DEFAULT_ENCODE_BATCH_SIZE,
        help="SentenceTransformer encode batch size (lower if CUDA OOM/unknown errors)",
    )
    parser.add_argument("--knowledge-root", default=DEFAULT_KNOWLEDGE_DIR, help="Knowledge root for source_key")
    parser.add_argument("--state-path", default=DEFAULT_INGEST_STATE_PATH, help="State JSON path")
    parser.add_argument(
        "--skip-mode",
        choices=["checksum", "filename"],
        default="checksum",
        help="Skip policy for already processed files",
    )

    parser.add_argument(
        "--bootstrap-from-db",
        dest="bootstrap_from_db",
        action="store_true",
        help="Bootstrap state from existing DB rows when state file is missing",
    )
    parser.add_argument(
        "--no-bootstrap-from-db",
        dest="bootstrap_from_db",
        action="store_false",
        help="Disable bootstrap from DB",
    )
    parser.set_defaults(bootstrap_from_db=True)

    parser.add_argument(
        "--replace-updated",
        dest="replace_updated",
        action="store_true",
        help="Delete old rows and re-embed when checksum changes",
    )
    parser.add_argument(
        "--no-replace-updated",
        dest="replace_updated",
        action="store_false",
        help="Skip changed files instead of replacing",
    )
    parser.set_defaults(replace_updated=True)
    parser.add_argument(
        "--replace-all",
        action="store_true",
        help="Force delete+re-embed every discovered file, even if unchanged",
    )

    parser.add_argument(
        "--prune-missing",
        action="store_true",
        help="Delete DB rows/state entries for files missing from knowledge root",
    )
    parser.add_argument(
        "--db-retries",
        type=int,
        default=DEFAULT_DB_RETRIES,
        help="Retries for transient DB failures per file",
    )
    parser.add_argument("--dry-run", action="store_true", help="Scan and chunk, but do not write DB/state")

    return parser.parse_args()
