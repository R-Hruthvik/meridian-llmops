"""Bounded, local-first OCR helpers for PDF pages."""

import io
import os
import re
import time
from typing import cast

OCR_API_URL = "https://api.ocr.space/parse/image"
OCR_MAX_IMAGE_BYTES = 1024 * 1024
OCR_MAX_PAGE_DIMENSION = 1200
OCR_RENDER_DPI = 120
OCR_PAGE_TIMEOUT_SECONDS = 15


def is_usable_ocr_text(text: str) -> bool:
    """Apply the PDF parser's minimum text-quality rule to OCR output."""
    content = re.sub(r"\s", "", text)
    if len(content) < 20 or "\ufffd" in text:
        return False
    non_alnum = sum(1 for char in content if not char.isalnum())
    return non_alnum / max(1, len(content)) <= 0.35


def ocr_page_text(
    data: bytes,
    page_number: int,
    page_width: float,
    page_height: float,
    *,
    deadline: float,
) -> str | None:
    """OCR one PDF page locally, then use OCR.space if a key is configured."""
    remaining = deadline - time.monotonic()
    if remaining <= 0 or page_width <= 0 or page_height <= 0:
        return None

    # Bound the output surface before Poppler allocates a raster image.
    longest_side = max(page_width, page_height)
    if longest_side > 14400:
        return None
    dpi = max(1, int(min(OCR_RENDER_DPI, OCR_MAX_PAGE_DIMENSION * 72 / longest_side)))
    timeout = max(1, int(min(OCR_PAGE_TIMEOUT_SECONDS, remaining)))

    try:
        from pdf2image import convert_from_bytes

        images = convert_from_bytes(
            data,
            dpi=dpi,
            first_page=page_number,
            last_page=page_number,
            thread_count=1,
            size=OCR_MAX_PAGE_DIMENSION,
            timeout=timeout,
            fmt="jpeg",
        )
        if len(images) != 1:
            return None
        image = images[0]
    except Exception:  # noqa: BLE001 - rendering failure must leave the page warning path intact
        return None

    if image.width > OCR_MAX_PAGE_DIMENSION or image.height > OCR_MAX_PAGE_DIMENSION:
        return None

    try:
        import pytesseract

        # Tesseract uses OpenMP by default; cap its subprocess at one worker.
        os.environ["OMP_THREAD_LIMIT"] = "1"
        local_text = cast(
            str,
            pytesseract.image_to_string(
                image,
                lang="eng",
                timeout=min(OCR_PAGE_TIMEOUT_SECONDS, max(0.1, deadline - time.monotonic())),
            ),
        )
        if is_usable_ocr_text(local_text):
            return local_text
    except Exception:  # noqa: BLE001, S110 - local OCR failure intentionally enables configured fallback
        pass

    from packages.core.settings import get_settings

    api_key = get_settings().ocr_api_key.get_secret_value().strip()
    remaining = deadline - time.monotonic()
    if not api_key or remaining <= 0:
        return None

    image_bytes = io.BytesIO()
    converted = None
    try:
        converted = image.convert("RGB")
        converted.save(image_bytes, format="JPEG", quality=75, optimize=True)
    except Exception:  # noqa: BLE001 - image encoding failure should not reject document ingestion
        return None
    finally:
        if converted is not None:
            converted.close()
    payload = image_bytes.getvalue()
    if len(payload) > OCR_MAX_IMAGE_BYTES:
        return None

    try:
        import httpx

        with httpx.Client(timeout=min(OCR_PAGE_TIMEOUT_SECONDS, remaining), follow_redirects=False) as client:
            response = client.post(
                OCR_API_URL,
                headers={"apikey": api_key},
                data={"language": "eng", "isOverlayRequired": "false", "OCREngine": "2"},
                files={"file": (f"page-{page_number}.jpg", payload, "image/jpeg")},
            )
            response.raise_for_status()
            result = response.json()
        if result.get("OCRExitCode") != 1 or result.get("IsErroredOnProcessing"):
            return None
        parsed_results = result.get("ParsedResults") or []
        if not parsed_results:
            return None
        text = parsed_results[0].get("ParsedText", "")
        return text if is_usable_ocr_text(text) else None
    except Exception:  # noqa: BLE001 - provider/network/response failures degrade to parser warnings
        # Provider errors can include request details; never propagate them to logs/results.
        return None
