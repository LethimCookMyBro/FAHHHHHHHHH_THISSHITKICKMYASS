import os
import glob
import hashlib
from typing import List, Iterable, Dict, Any
from tqdm import tqdm

class FileRecord:
    def __init__(self, path: str, source: str, source_key: str, sha256: str, size: int, mtime: float):
        self.path = path
        self.source = source
        self.source_key = source_key
        self.sha256 = sha256
        self.size = size
        self.mtime = mtime

def discover_files(paths: List[str]) -> List[str]:
    """Collect PDF/JSON files from file and directory paths."""
    found: set[str] = set()
    for raw in paths:
        path = os.path.abspath(raw)
        if os.path.isfile(path):
            if path.lower().endswith((".pdf", ".json")):
                found.add(path)
            continue

        if os.path.isdir(path):
            for ext in ("*.json", "*.pdf"):
                pattern = os.path.join(path, "**", ext)
                for hit in glob.glob(pattern, recursive=True):
                    if os.path.isfile(hit):
                        found.add(os.path.abspath(hit))

    files = sorted(
        found,
        key=lambda p: (0 if p.lower().endswith(".json") else 1, p.lower()),
    )
    return files

def file_sha256(file_path: str, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as f:
        for data in iter(lambda: f.read(chunk_size), b""):
            digest.update(data)
    return digest.hexdigest()

def build_source_key(file_path: str, knowledge_root: str) -> str:
    abs_file = os.path.abspath(file_path)
    abs_root = os.path.abspath(knowledge_root)

    try:
        rel = os.path.relpath(abs_file, abs_root)
    except Exception:
        rel = os.path.basename(abs_file)

    if rel.startswith(".."):
        rel = os.path.basename(abs_file)

    return rel.replace("\\", "/")

def build_file_records(files: Iterable[str], knowledge_root: str) -> List[FileRecord]:
    records: List[FileRecord] = []
    for file_path in tqdm(list(files), desc="Fingerprinting", unit="file"):
        stat = os.stat(file_path)
        records.append(
            FileRecord(
                path=file_path,
                source=os.path.basename(file_path),
                source_key=build_source_key(file_path, knowledge_root),
                sha256=file_sha256(file_path),
                size=int(stat.st_size),
                mtime=float(stat.st_mtime),
            )
        )
    return records

def build_chunk_metadata(file_record: FileRecord, embedded_at: str) -> Dict[str, Any]:
    return {
        "source_key": file_record.source_key,
        "source_checksum": file_record.sha256,
        "source_size": file_record.size,
        "embedded_at": embedded_at,
    }

def build_state_entry(
    file_record: FileRecord,
    *,
    chunk_count: int,
    embedded_at: str,
    bootstrapped: bool,
) -> Dict[str, Any]:
    return {
        "sha256": file_record.sha256,
        "size": file_record.size,
        "mtime": file_record.mtime,
        "source": file_record.source,
        "chunk_count": int(chunk_count),
        "last_embedded_at": embedded_at,
        "bootstrapped": bool(bootstrapped),
    }
