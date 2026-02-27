import os
from typing import Iterable, Optional

from fastapi import HTTPException, UploadFile


def _env_mb(name: str, default_mb: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default_mb
    try:
        value = int(str(raw).strip())
        return max(1, value)
    except Exception:
        return default_mb


def _peek_size(file: UploadFile) -> int:
    current_pos = file.file.tell()
    file.file.seek(0, os.SEEK_END)
    size = int(file.file.tell())
    file.file.seek(current_pos)
    return size


def validate_upload(
    file: Optional[UploadFile],
    *,
    allowed_mime_types: Iterable[str],
    allowed_extensions: Iterable[str],
    max_size_mb_env: str,
    default_max_size_mb: int,
) -> None:
    if file is None:
        return

    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    ext = ""
    if "." in filename:
        ext = "." + filename.split(".")[-1].lower()
    allowed_ext_set = {str(item).lower().strip() for item in allowed_extensions}
    if ext not in allowed_ext_set:
        raise HTTPException(status_code=415, detail=f"Unsupported file extension: {ext or '<none>'}")

    content_type = (file.content_type or "").strip().lower()
    allowed_type_set = {str(item).lower().strip() for item in allowed_mime_types}
    if content_type not in allowed_type_set:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {content_type or '<none>'}")

    max_size_mb = _env_mb(max_size_mb_env, default_max_size_mb)
    max_size_bytes = max_size_mb * 1024 * 1024
    file_size = _peek_size(file)
    if file_size > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({file_size} bytes). Max allowed is {max_size_mb} MB.",
        )

