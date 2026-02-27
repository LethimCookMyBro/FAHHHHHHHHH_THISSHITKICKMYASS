"""
Text extraction from various file types (PDF, DOCX, images, etc.).
"""

import io
import json
import logging

import pytesseract
from PIL import Image

logger = logging.getLogger("PLCAssistant")


def extract_text_from_file(file_content: bytes, filename: str, mime_type: str) -> str:
    """
    Extract text content from various file types.

    Supported: .txt, .csv, .json, .pdf, .docx, images (OCR).
    """
    filename_lower = filename.lower()

    try:
        if mime_type == "text/plain" or filename_lower.endswith(".txt"):
            return file_content.decode("utf-8", errors="ignore")

        if mime_type == "text/csv" or filename_lower.endswith(".csv"):
            return file_content.decode("utf-8", errors="ignore")

        if mime_type == "application/json" or filename_lower.endswith(".json"):
            try:
                data = json.loads(file_content.decode("utf-8"))
                return json.dumps(data, indent=2, ensure_ascii=False)
            except json.JSONDecodeError:
                return file_content.decode("utf-8", errors="ignore")

        if mime_type == "application/pdf" or filename_lower.endswith(".pdf"):
            return _extract_pdf(file_content)

        if filename_lower.endswith((".docx", ".doc")):
            return _extract_docx(file_content)

        if mime_type and mime_type.startswith("image"):
            return _extract_image_ocr(file_content)

        return f"[Unsupported file type: {mime_type or filename}]"

    except Exception as e:
        logger.error(f"🔥 Error extracting text from {filename}: {e}")
        return f"[Error reading file: {e}]"


def _extract_pdf(file_content: bytes) -> str:
    try:
        import fitz
        pdf_doc = fitz.open(stream=file_content, filetype="pdf")
        text = "\n".join(page.get_text() for page in pdf_doc)
        pdf_doc.close()
        return text.strip()
    except ImportError:
        pass

    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(file_content)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        return text.strip()
    except ImportError:
        return "[Error: No PDF reader available. Install PyMuPDF or pdfplumber]"


def _extract_docx(file_content: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(file_content))
        text = "\n".join(para.text for para in doc.paragraphs)
        return text.strip()
    except ImportError:
        return "[Error: python-docx not installed]"


def _extract_image_ocr(file_content: bytes) -> str:
    try:
        image = Image.open(io.BytesIO(file_content))
        text = pytesseract.image_to_string(image)
        return text.strip()
    except Exception as e:
        return f"[Error reading image: {e}]"
