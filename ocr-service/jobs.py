"""In-memory job store and the worker that turns a PDF into text.

OCR of a long PDF takes minutes, which is far too long to hold an HTTP request
open, so uploads create a job and the browser polls it. Work runs on a single
worker thread: the GPU is the bottleneck and running two documents at once only
makes both slower (and can exhaust VRAM).
"""

from __future__ import annotations

import logging
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backends import BackendError, PageInput
from config import settings
from pdf import PdfError, extract_text, open_document, render_page, resolve_pages

log = logging.getLogger("ocr.jobs")

QUEUED, RUNNING, DONE, ERROR, CANCELED = "queued", "running", "done", "error", "canceled"


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class PageResult:
    number: int
    text: str
    seconds: float

    def as_dict(self) -> dict:
        return {
            "number": self.number,
            "text": self.text,
            "chars": len(self.text),
            "seconds": round(self.seconds, 2),
        }


@dataclass
class Job:
    id: str
    filename: str
    mode: str
    backend: str
    workdir: Path
    pdf_path: Path
    selection: str | None
    dpi: int
    status: str = QUEUED
    stage: str = "queued"
    page_numbers: list[int] = field(default_factory=list)
    pages: list[PageResult] = field(default_factory=list)
    document_text: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    cancel_requested: bool = False

    @property
    def pages_total(self) -> int:
        return len(self.page_numbers)

    @property
    def pages_done(self) -> int:
        return len(self.pages)

    @property
    def finished(self) -> bool:
        return self.status in {DONE, ERROR, CANCELED}

    def text(self) -> str:
        """The whole document as one string."""
        if self.document_text is not None:
            return self.document_text
        return "\n\n".join(p.text for p in self.pages if p.text)

    def as_dict(self, include_text: bool = True) -> dict:
        payload = {
            "id": self.id,
            "filename": self.filename,
            "mode": self.mode,
            "backend": self.backend,
            "status": self.status,
            "stage": self.stage,
            "pagesTotal": self.pages_total,
            "pagesDone": self.pages_done,
            "pageNumbers": self.page_numbers,
            "error": self.error,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
            "elapsedSeconds": round(self._elapsed(), 2),
        }
        if include_text:
            payload["pages"] = [p.as_dict() for p in self.pages]
            payload["text"] = self.text()
        return payload

    def _elapsed(self) -> float:
        if self.started_at is None:
            return 0.0
        end = self.finished_at or _now()
        return (end - self.started_at).total_seconds()


class JobStore:
    def __init__(self, backend) -> None:
        self._backend = backend
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        # One worker: inference is serialised on the GPU anyway, and a queue of
        # one keeps memory predictable. Extra submissions wait their turn.
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr")

    # -- lifecycle ---------------------------------------------------------

    def submit(self, *, data: bytes, filename: str, mode: str, selection: str | None, dpi: int) -> Job:
        job_id = uuid.uuid4().hex
        workdir = Path(tempfile.mkdtemp(prefix=f"ocr-{job_id[:8]}-"))
        pdf_path = workdir / "source.pdf"
        pdf_path.write_bytes(data)

        job = Job(
            id=job_id,
            filename=filename,
            mode=mode,
            backend=self._backend.name,
            workdir=workdir,
            pdf_path=pdf_path,
            selection=selection,
            dpi=dpi,
        )
        with self._lock:
            self._jobs[job_id] = job
        self._pool.submit(self._run, job)
        self.sweep()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job is None or job.finished:
            return job
        job.cancel_requested = True
        if job.status == QUEUED:
            # Never started, so nothing will notice the flag -- retire it here.
            self._finish(job, CANCELED)
        return job

    def delete(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        job.cancel_requested = True
        _rmtree(job.workdir)
        return True

    def sweep(self) -> None:
        """Drop finished jobs, and their scratch files, once they go stale."""
        cutoff = _now() - timedelta(minutes=settings.job_ttl_minutes)
        with self._lock:
            stale = [j for j in self._jobs.values() if j.finished and j.updated_at < cutoff]
            for job in stale:
                self._jobs.pop(job.id, None)
        for job in stale:
            _rmtree(job.workdir)

    def stats(self) -> dict:
        with self._lock:
            jobs = list(self._jobs.values())
        return {
            "total": len(jobs),
            "queued": sum(1 for j in jobs if j.status == QUEUED),
            "running": sum(1 for j in jobs if j.status == RUNNING),
        }

    # -- worker ------------------------------------------------------------

    def _run(self, job: Job) -> None:
        if job.cancel_requested:
            self._finish(job, CANCELED)
            return

        job.status = RUNNING
        job.started_at = _now()
        self._touch(job)

        doc = None
        try:
            doc = open_document(job.pdf_path)
            job.page_numbers = resolve_pages(job.selection, doc.page_count)
            if len(job.page_numbers) > settings.max_pages:
                raise PdfError(
                    f"{len(job.page_numbers)} pages selected but the limit is {settings.max_pages}. "
                    "Narrow the page range and try again."
                )
            self._touch(job)

            inputs = self._prepare_pages(job, doc)
            if job.cancel_requested:
                self._finish(job, CANCELED)
                return

            job.stage = "parsing"
            self._touch(job)
            if job.mode == "document":
                job.document_text = self._backend.parse_document(inputs, job.workdir)
            else:
                self._parse_per_page(job, inputs)
                if job.cancel_requested:
                    self._finish(job, CANCELED)
                    return
            self._finish(job, DONE)
        except (PdfError, BackendError) as exc:
            job.error = str(exc)
            self._finish(job, ERROR)
        except Exception as exc:  # noqa: BLE001 -- a worker thread must not die silently
            log.exception("job %s failed", job.id)
            job.error = f"{type(exc).__name__}: {exc}"
            self._finish(job, ERROR)
        finally:
            if doc is not None:
                doc.close()

    def _prepare_pages(self, job: Job, doc) -> list[PageInput]:
        """Rasterise (or read the text layer of) each selected page."""
        job.stage = "rendering"
        self._touch(job)
        images_dir = job.workdir / "pages"
        images_dir.mkdir(parents=True, exist_ok=True)

        inputs: list[PageInput] = []
        for number in job.page_numbers:
            if job.cancel_requested:
                break
            image_path = render_page(doc, number, images_dir, job.dpi) if self._backend.needs_images else None
            text = "" if self._backend.needs_images else extract_text(doc, number)
            inputs.append(PageInput(number=number, image_path=image_path, embedded_text=text))
        return inputs

    def _parse_per_page(self, job: Job, inputs: list[PageInput]) -> None:
        for page in inputs:
            if job.cancel_requested:
                return
            started = time.monotonic()
            text = self._backend.parse_page(page, job.workdir)
            # Appended one at a time so a poll mid-run shows finished pages.
            job.pages.append(PageResult(number=page.number, text=text, seconds=time.monotonic() - started))
            self._touch(job)

    def _finish(self, job: Job, status: str) -> None:
        job.status = status
        job.stage = status
        job.finished_at = _now()
        self._touch(job)
        # Page images can be hundreds of MB; the text is what callers still need.
        _rmtree(job.workdir / "pages")

    def _touch(self, job: Job) -> None:
        job.updated_at = _now()


def _rmtree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
