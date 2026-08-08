"""OCR backends.

`unlimited-ocr` is the real one: baidu/Unlimited-OCR loaded through
transformers, which needs a CUDA GPU. `embedded-text` is a development stand-in
that reads the PDF's existing text layer so the rest of the stack can be
exercised without a GPU.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

from config import settings

log = logging.getLogger("ocr.backend")

# Prompts from the Unlimited-OCR README. The leading <image> token is what the
# model uses to slot the page in, so it has to stay.
PAGE_PROMPT = "<image>document parsing."
DOCUMENT_PROMPT = "<image>Multi page parsing."


@dataclass
class PageInput:
    """One page handed to a backend."""

    number: int
    image_path: Path | None = None
    embedded_text: str = ""


class BackendError(RuntimeError):
    """The backend could not produce text. Reported as a failed job."""


class UnlimitedOcrBackend:
    """baidu/Unlimited-OCR via transformers `AutoModel`.

    Weights load lazily on first use (or at startup with OCR_PRELOAD=1) and are
    guarded by a lock: one model instance, one GPU, one inference at a time.
    """

    name = "unlimited-ocr"
    needs_images = True
    supports_document_mode = True

    def __init__(self) -> None:
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            try:
                import torch
                from transformers import AutoModel, AutoTokenizer
            except ImportError as exc:  # noqa: BLE001
                raise BackendError(
                    "torch/transformers are not installed. Install the model dependencies "
                    "listed in ocr-service/requirements.txt, or run with "
                    "OCR_BACKEND=embedded-text for development."
                ) from exc

            log.info("loading %s onto %s", settings.model_id, settings.device)
            tokenizer = AutoTokenizer.from_pretrained(settings.model_id, trust_remote_code=True)
            model = AutoModel.from_pretrained(
                settings.model_id,
                trust_remote_code=True,
                torch_dtype=torch.bfloat16,
                use_safetensors=True,
            )
            model = model.eval()
            if settings.device.startswith("cuda"):
                if not torch.cuda.is_available():
                    raise BackendError(
                        "OCR_DEVICE is cuda but no CUDA device is visible. Unlimited-OCR needs a "
                        "GPU; set OCR_BACKEND=embedded-text to run without one."
                    )
                model = model.to(settings.device)
            self._tokenizer, self._model = tokenizer, model
            log.info("model ready")

    def parse_page(self, page: PageInput, workdir: Path) -> str:
        self.load()
        out_dir = workdir / f"page-{page.number:04d}"
        out_dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            result = self._model.infer(
                self._tokenizer,
                prompt=PAGE_PROMPT,
                image_file=str(page.image_path),
                output_path=str(out_dir),
                base_size=settings.base_size,
                image_size=settings.image_size,
                crop_mode=True,
                max_length=settings.max_length,
                no_repeat_ngram_size=settings.no_repeat_ngram_size,
                ngram_window=settings.page_ngram_window,
                save_results=True,
            )
        return _coerce_text(result, out_dir)

    def parse_document(self, pages: list[PageInput], workdir: Path) -> str:
        self.load()
        out_dir = workdir / "document"
        out_dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            result = self._model.infer_multi(
                self._tokenizer,
                prompt=DOCUMENT_PROMPT,
                image_files=[str(p.image_path) for p in pages],
                output_path=str(out_dir),
                image_size=settings.document_image_size,
                max_length=settings.max_length,
                no_repeat_ngram_size=settings.no_repeat_ngram_size,
                ngram_window=settings.document_ngram_window,
                save_results=True,
            )
        return _coerce_text(result, out_dir)


class EmbeddedTextBackend:
    """Development stand-in: the PDF's own text layer, no model involved.

    Scanned pages have no text layer and come back empty -- that is the honest
    result here, and the reason this backend is not for production.
    """

    name = "embedded-text"
    needs_images = False
    supports_document_mode = False
    ready = True

    def load(self) -> None:
        return None

    def parse_page(self, page: PageInput, workdir: Path) -> str:
        return page.embedded_text

    def parse_document(self, pages: list[PageInput], workdir: Path) -> str:
        return "\n\n".join(p.embedded_text for p in pages if p.embedded_text)


def _coerce_text(result: object, out_dir: Path) -> str:
    """Get text out of an `infer` call.

    Upstream returns the decoded string in the common case, but also writes its
    results to `output_path`. Both paths are handled so a change in what the
    model returns degrades into reading the file rather than an empty result.
    """
    if isinstance(result, str) and result.strip():
        return result.strip()
    if isinstance(result, (list, tuple)):
        joined = "\n\n".join(str(item) for item in result if item)
        if joined.strip():
            return joined.strip()

    preferred = ["result.mmd", "result.md", "result.txt", "result_raw.mmd"]
    candidates = [out_dir / name for name in preferred]
    candidates += sorted(p for p in out_dir.glob("*") if p.suffix in {".mmd", ".md", ".txt"})
    for path in candidates:
        if path.is_file():
            text = path.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                return text
    return ""


def build_backend(name: str | None = None):
    chosen = (name or settings.backend).strip().lower()
    if chosen in {"unlimited-ocr", "unlimited_ocr", "model"}:
        return UnlimitedOcrBackend()
    if chosen in {"embedded-text", "embedded_text", "dev"}:
        log.warning("running the embedded-text dev backend: no OCR, text-layer PDFs only")
        return EmbeddedTextBackend()
    raise ValueError(f"Unknown OCR_BACKEND '{chosen}'. Use 'unlimited-ocr' or 'embedded-text'.")
