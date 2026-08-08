"""PDF inspection and page rasterisation, via PyMuPDF."""

from __future__ import annotations

from pathlib import Path

import pymupdf


class PdfError(ValueError):
    """A problem with the uploaded document that the user can act on."""


def open_document(pdf_path: Path) -> pymupdf.Document:
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as exc:  # noqa: BLE001 -- surfaced to the user as 400
        raise PdfError(f"Could not read the PDF: {exc}") from exc
    if doc.needs_pass:
        doc.close()
        raise PdfError("The PDF is password protected. Remove the password and upload it again.")
    if doc.page_count == 0:
        doc.close()
        raise PdfError("The PDF has no pages.")
    return doc


def resolve_pages(selection: str | None, page_count: int) -> list[int]:
    """Turn a page selection like "1-3,7,10-" into sorted 1-based page numbers.

    An empty selection means every page. The syntax is also validated in the
    browser (src/lib/pdf-ocr/pages.ts) so typos surface before the upload, but
    this side is the authority: only here is the real page count known, which
    is what open-ended ranges like "10-" need.
    """
    if not selection or not selection.strip():
        return list(range(1, page_count + 1))

    pages: set[int] = set()
    for chunk in selection.split(","):
        part = chunk.strip()
        if not part:
            continue
        if "-" in part:
            start_raw, _, end_raw = part.partition("-")
            start = _page_number(start_raw, "start page")
            end = page_count if not end_raw.strip() else _page_number(end_raw, "end page")
            if end < start:
                raise PdfError(f"Page range '{part}' ends before it starts.")
            pages.update(range(start, min(end, page_count) + 1))
        else:
            pages.add(_page_number(part, "page"))

    in_range = sorted(p for p in pages if p <= page_count)
    if not in_range:
        raise PdfError(f"The selected pages are outside this {page_count}-page document.")
    return in_range


def _page_number(raw: str, what: str) -> int:
    text = raw.strip()
    if not text.isdigit():
        raise PdfError(f"'{text or raw}' is not a valid {what} number.")
    value = int(text)
    if value < 1:
        raise PdfError("Page numbers start at 1.")
    return value


def render_page(doc: pymupdf.Document, page_number: int, out_dir: Path, dpi: int) -> Path:
    """Rasterise one 1-based page to a PNG and return its path."""
    page = doc.load_page(page_number - 1)
    pixmap = page.get_pixmap(dpi=dpi)
    out_path = out_dir / f"page-{page_number:04d}.png"
    pixmap.save(out_path)
    return out_path


def extract_text(doc: pymupdf.Document, page_number: int) -> str:
    """The page's embedded text layer. Empty for scanned pages."""
    return doc.load_page(page_number - 1).get_text("text").strip()
