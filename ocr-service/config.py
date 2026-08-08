"""Environment-driven settings for the OCR sidecar."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # "unlimited-ocr" runs the real model and needs a CUDA GPU. "embedded-text"
    # pulls the PDF's existing text layer with PyMuPDF -- no model, no GPU, and
    # nothing for scanned pages. It exists so the web app can be developed and
    # tested end to end on a laptop; never point production at it.
    backend: str = field(default_factory=lambda: os.environ.get("OCR_BACKEND", "unlimited-ocr"))

    model_id: str = field(default_factory=lambda: os.environ.get("OCR_MODEL_ID", "baidu/Unlimited-OCR"))
    device: str = field(default_factory=lambda: os.environ.get("OCR_DEVICE", "cuda"))

    # Render resolution for page images. The model's own preprocessing resizes
    # to base_size/image_size, so going far above 200 mostly costs time.
    render_dpi: int = field(default_factory=lambda: _int("OCR_RENDER_DPI", 144))

    # Model sampling knobs, defaulted to the values in the upstream README.
    max_length: int = field(default_factory=lambda: _int("OCR_MAX_LENGTH", 32768))
    no_repeat_ngram_size: int = field(default_factory=lambda: _int("OCR_NO_REPEAT_NGRAM_SIZE", 35))
    page_ngram_window: int = field(default_factory=lambda: _int("OCR_PAGE_NGRAM_WINDOW", 128))
    document_ngram_window: int = field(default_factory=lambda: _int("OCR_DOCUMENT_NGRAM_WINDOW", 1024))
    base_size: int = field(default_factory=lambda: _int("OCR_BASE_SIZE", 1024))
    image_size: int = field(default_factory=lambda: _int("OCR_IMAGE_SIZE", 640))
    document_image_size: int = field(default_factory=lambda: _int("OCR_DOCUMENT_IMAGE_SIZE", 1024))

    max_pages: int = field(default_factory=lambda: _int("OCR_MAX_PAGES", 200))
    max_upload_mb: int = field(default_factory=lambda: _int("OCR_MAX_UPLOAD_MB", 64))

    # Finished jobs (and their scratch directories) are swept this long after
    # their last update, so a browser that stopped polling cannot leak disk.
    job_ttl_minutes: int = field(default_factory=lambda: _int("OCR_JOB_TTL_MINUTES", 60))

    # Load the weights at startup instead of on the first request. Costs a slow
    # boot, but then no user ever eats the ~1 min load time.
    preload: bool = field(default_factory=lambda: os.environ.get("OCR_PRELOAD", "").lower() in {"1", "true", "yes"})

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
