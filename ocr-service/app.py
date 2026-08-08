"""HTTP surface for the OCR sidecar.

Run it next to the Next.js app:

    uvicorn app:app --host 127.0.0.1 --port 8077

The web app never talks to the model directly -- it posts PDFs here and polls
for the result. See README.md in this directory.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backends import build_backend
from config import settings
from jobs import JobStore

logging.basicConfig(level=os.environ.get("OCR_LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("ocr.app")

MODES = {"page", "document"}
MIN_DPI, MAX_DPI = 72, 400

backend = build_backend()
store = JobStore(backend)

app = FastAPI(title="Unlimited-OCR PDF service", version="1.0.0")

# Only needed if a browser calls this service directly; the Next.js app proxies
# through its own origin, so this is empty by default.
_origins = [o.strip() for o in os.environ.get("OCR_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )


@app.on_event("startup")
def _startup() -> None:
    log.info("backend=%s model=%s device=%s", backend.name, settings.model_id, settings.device)
    if settings.preload and hasattr(backend, "load"):
        backend.load()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "backend": backend.name,
        "model": settings.model_id if backend.needs_images else None,
        "device": settings.device if backend.needs_images else "cpu",
        "modelLoaded": bool(getattr(backend, "ready", False)),
        "supportsDocumentMode": backend.supports_document_mode,
        "maxPages": settings.max_pages,
        "maxUploadMb": settings.max_upload_mb,
        "jobs": store.stats(),
    }


@app.post("/jobs", status_code=202)
async def create_job(
    file: UploadFile = File(...),
    mode: str = Form("page"),
    pages: str = Form(""),
    dpi: int = Form(settings.render_dpi),
) -> dict:
    if mode not in MODES:
        raise HTTPException(400, f"Unknown mode '{mode}'. Use 'page' or 'document'.")
    if mode == "document" and not backend.supports_document_mode:
        raise HTTPException(400, f"The {backend.name} backend cannot do whole-document parsing. Use mode=page.")

    data = await file.read()
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"The PDF is larger than the {settings.max_upload_mb} MB limit.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "That file is not a PDF.")

    job = store.submit(
        data=data,
        filename=os.path.basename(file.filename or "document.pdf"),
        mode=mode,
        selection=pages,
        dpi=max(MIN_DPI, min(MAX_DPI, dpi)),
    )
    return job.as_dict(include_text=False)


@app.get("/jobs/{job_id}")
def read_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job. It may have expired.")
    return job.as_dict()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    job = store.cancel(job_id)
    if job is None:
        raise HTTPException(404, "No such job. It may have expired.")
    return job.as_dict(include_text=False)


@app.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str) -> None:
    if not store.delete(job_id):
        raise HTTPException(404, "No such job. It may have expired.")
