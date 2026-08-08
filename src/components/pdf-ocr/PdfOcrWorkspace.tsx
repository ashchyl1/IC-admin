"use client";

import * as React from "react";
import {
  Copy,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  ScanText,
  Square,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { parsePageSelection } from "@/lib/pdf-ocr/pages";
import { isFinished, type OcrJob, type OcrMode, type OcrServiceStatus } from "@/lib/pdf-ocr/types";

const POLL_MS = 1200;

const RESOLUTIONS = [
  { value: 144, label: "Standard — 144 dpi" },
  { value: 200, label: "High — 200 dpi" },
  { value: 300, label: "Maximum — 300 dpi" },
];

const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting for a free worker",
  rendering: "Preparing pages",
  parsing: "Reading text",
  done: "Finished",
  error: "Failed",
  canceled: "Stopped",
};

export function PdfOcrWorkspace({ initialStatus }: { initialStatus: OcrServiceStatus }) {
  const toast = useToast();
  const [status, setStatus] = React.useState(initialStatus);
  const [file, setFile] = React.useState<File | null>(null);
  const [mode, setMode] = React.useState<OcrMode>("page");
  const [pages, setPages] = React.useState("");
  const [dpi, setDpi] = React.useState(144);
  const [job, setJob] = React.useState<OcrJob | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const maxUploadMb = status.reachable ? status.maxUploadMb : 64;
  const selection = parsePageSelection(pages);
  const running = job !== null && !isFinished(job);
  const documentModeAvailable = !status.reachable || status.supportsDocumentMode;

  // Poll while a job is in flight. Every response replaces the job, so pages
  // finished so far show up as they land instead of only at the end.
  React.useEffect(() => {
    if (!job || isFinished(job)) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pdf-ocr/${job.id}`, { cache: "no-store" });
        const body = await res.json();
        if (!live) return;
        if (!res.ok) {
          setError(body.error || "Lost track of the conversion.");
          setJob((prev) => (prev ? { ...prev, status: "error", error: body.error } : prev));
          return;
        }
        setJob(body as OcrJob);
      } catch {
        if (live) setError("Lost connection while checking on the conversion.");
      }
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [job]);

  React.useEffect(() => {
    if (job?.status === "done") toast.push(`Converted ${job.filename}`, "success");
    if (job?.status === "error" && job.error) toast.push(job.error, "error");
    // Announce each terminal state once, not on every poll.
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function acceptFile(candidate: File | undefined | null) {
    if (!candidate) return;
    const looksPdf = candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf");
    if (!looksPdf) {
      setError(`${candidate.name} is not a PDF.`);
      return;
    }
    if (candidate.size > maxUploadMb * 1024 * 1024) {
      setError(`${candidate.name} is ${formatBytes(candidate.size)} — the limit is ${maxUploadMb} MB.`);
      return;
    }
    setError(null);
    setJob(null);
    setFile(candidate);
  }

  async function convert() {
    if (!file || !selection.ok) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      form.set("pages", selection.canonical);
      form.set("dpi", String(dpi));
      const res = await fetch("/api/pdf-ocr", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "The conversion could not be started.");
        return;
      }
      setJob(body as OcrJob);
    } catch {
      setError("The conversion could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  async function stop() {
    if (!job) return;
    const stopped: OcrJob = { ...job, status: "canceled", stage: "canceled" };
    setJob(stopped); // ends the poll loop immediately
    try {
      await fetch(`/api/pdf-ocr/${job.id}`, { method: "DELETE" });
    } catch {
      // The job is already off the screen; the sidecar sweeps it on its own.
    }
  }

  function reset() {
    setJob(null);
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function refreshStatus() {
    try {
      const res = await fetch("/api/pdf-ocr", { cache: "no-store" });
      setStatus((await res.json()) as OcrServiceStatus);
    } catch {
      // Leave the last known status in place.
    }
  }

  const text = job?.text ?? "";

  return (
    <div className="space-y-6">
      {!status.reachable && <ServiceDownNotice status={status} onRetry={refreshStatus} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <DropZone
            file={file}
            dragging={dragging}
            disabled={running || submitting}
            maxUploadMb={maxUploadMb}
            inputRef={inputRef}
            onDraggingChange={setDragging}
            onFile={acceptFile}
            onClear={reset}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss error" className="opacity-70 hover:opacity-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {job && <JobPanel job={job} onStop={stop} onReset={reset} />}
          {/* Always rendered once a job exists, including when the result is
              empty. A conversion that finds no text still has to say so --
              silence reads as a broken page. */}
          {job && <ResultPanel job={job} text={text} onCopied={() => toast.push("Copied", "success")} />}
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold">Options</h2>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ocr-mode">Parsing mode</Label>
              <Select
                id="ocr-mode"
                className="w-full"
                value={mode}
                disabled={running || submitting}
                onChange={(e) => setMode(e.target.value as OcrMode)}
              >
                <option value="page">Page by page</option>
                <option value="document" disabled={!documentModeAvailable}>
                  Whole document
                </option>
              </Select>
              <p className="text-xs text-muted-foreground">
                {mode === "page"
                  ? "One pass per page. Keeps page boundaries and reports progress as it goes."
                  : "Unlimited-OCR's one-shot long-horizon parse. Reads better across page breaks — tables and paragraphs that span pages — but reports no progress until it finishes."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ocr-pages">Pages</Label>
              <Input
                id="ocr-pages"
                value={pages}
                placeholder="All pages"
                disabled={running || submitting}
                onChange={(e) => setPages(e.target.value)}
                aria-invalid={!selection.ok}
                aria-describedby="ocr-pages-hint"
              />
              <p id="ocr-pages-hint" className={cn("text-xs", selection.ok ? "text-muted-foreground" : "text-destructive")}>
                {selection.ok
                  ? selection.canonical
                    ? `Converting ${selection.canonical.replace(/,/g, ", ")}${selection.openEnded ? " to the end" : ""}.`
                    : "Blank converts every page. Try 1-3, 7, 10- for a subset."
                  : selection.error}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ocr-dpi">Page resolution</Label>
              <Select
                id="ocr-dpi"
                className="w-full"
                value={dpi}
                disabled={running || submitting}
                onChange={(e) => setDpi(Number(e.target.value))}
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Higher resolution helps small print and dense tables, and costs time per page.
              </p>
            </div>

            <Button
              className="w-full"
              onClick={convert}
              disabled={!file || !selection.ok || running || submitting || !status.reachable}
            >
              {submitting || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
              {running ? "Converting…" : "Convert to text"}
            </Button>
          </div>

          <ServiceSummary status={status} />
        </Card>
      </div>
    </div>
  );
}

function DropZone({
  file,
  dragging,
  disabled,
  maxUploadMb,
  inputRef,
  onDraggingChange,
  onFile,
  onClear,
}: {
  file: File | null;
  dragging: boolean;
  disabled: boolean;
  maxUploadMb: number;
  inputRef: React.RefObject<HTMLInputElement>;
  onDraggingChange: (value: boolean) => void;
  onFile: (file: File | undefined) => void;
  onClear: () => void;
}) {
  if (file) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
          <X className="h-4 w-4" /> Remove
        </Button>
      </Card>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) onDraggingChange(true);
      }}
      onDragLeave={() => onDraggingChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDraggingChange(false);
        if (!disabled) onFile(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "rounded-lg border-2 border-dashed p-10 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-input",
        disabled && "opacity-60"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Upload className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium">Drop a PDF here</p>
      <p className="mt-1 text-xs text-muted-foreground">Scanned or digital, up to {maxUploadMb} MB</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Choose a file
      </Button>
    </div>
  );
}

function JobPanel({ job, onStop, onReset }: { job: OcrJob; onStop: () => void; onReset: () => void }) {
  const done = isFinished(job);
  // Per-page parsing is the only stage with real checkpoints. Page rendering
  // and whole-document parsing are single opaque steps, so the bar pulses
  // rather than claiming progress it cannot measure.
  const measurable = job.mode === "page" && job.stage === "parsing";
  const pct = job.pagesTotal ? Math.round((job.pagesDone / job.pagesTotal) * 100) : 0;
  const indeterminate = !done && !measurable;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!done && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <span className="text-sm font-medium">{STAGE_LABEL[job.stage] ?? job.stage}</span>
          <Badge tone={job.status === "done" ? "green" : job.status === "error" ? "red" : job.status === "canceled" ? "slate" : "blue"}>
            {job.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{job.elapsedSeconds.toFixed(1)}s</span>
          {!done ? (
            <Button variant="outline" size="sm" onClick={onStop}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-3.5 w-3.5" /> Start over
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            job.status === "error" ? "bg-destructive" : "bg-primary",
            indeterminate && "animate-pulse"
          )}
          style={{ width: `${job.status === "done" || indeterminate ? 100 : pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>
          {job.mode === "document" ? "Whole document" : "Page by page"} · {job.pagesTotal || "?"} pages
        </span>
        {job.mode === "page" && <span className="tabular-nums">{job.pagesDone} / {job.pagesTotal} done</span>}
      </div>

      {job.error && <p className="mt-3 text-sm text-destructive">{job.error}</p>}
    </Card>
  );
}

function ResultPanel({ job, text, onCopied }: { job: OcrJob; text: string; onCopied: () => void }) {
  const [view, setView] = React.useState<"combined" | "pages">("combined");
  const pages = job.pages ?? [];
  const showPages = job.mode === "page" && pages.length > 0;
  const running = !isFinished(job);
  const empty = text.length === 0;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
    } catch {
      // Clipboard is blocked on insecure origins; the text is on screen to select.
    }
  }

  function download(extension: "txt" | "md") {
    const base = job.filename.replace(/\.pdf$/i, "") || "document";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${base}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Extracted text</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {text.length.toLocaleString()} characters{running && " so far"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showPages && (
            <div className="flex rounded-md border border-input p-0.5">
              {(["combined", "pages"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setView(option)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => copy(text)} disabled={empty}>
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          <Button variant="outline" size="sm" onClick={() => download("txt")} disabled={empty}>
            <Download className="h-3.5 w-3.5" /> .txt
          </Button>
          <Button variant="outline" size="sm" onClick={() => download("md")} disabled={empty}>
            <Download className="h-3.5 w-3.5" /> .md
          </Button>
        </div>
      </div>

      {empty ? (
        <EmptyResult job={job} running={running} />
      ) : view === "combined" || !showPages ? (
        <pre className="scroll-thin min-h-[16rem] max-h-[32rem] overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-relaxed">
          {text}
          {running && <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-primary align-middle" />}
        </pre>
      ) : (
        <div className="scroll-thin min-h-[16rem] max-h-[32rem] divide-y overflow-auto">
          {pages.map((page) => (
            <div key={page.number} className="px-5 py-4">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="slate">Page {page.number}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {page.chars.toLocaleString()} chars · {page.seconds.toFixed(1)}s
                </span>
                <button
                  onClick={() => copy(page.text)}
                  className="ml-auto text-xs text-primary hover:underline"
                  disabled={!page.text}
                >
                  Copy page
                </button>
              </div>
              {page.text ? (
                <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">{page.text}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">No text found on this page.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * What the output box shows when there is no text yet. A blank panel after a
 * "Converted" toast is the confusing case this exists to prevent -- especially
 * on a scanned PDF run through the dev backend, which succeeds and legitimately
 * finds nothing.
 */
function EmptyResult({ job, running }: { job: OcrJob; running: boolean }) {
  const devBackend = job.backend !== "unlimited-ocr";

  let headline: string;
  let detail: string | null = null;
  if (running) {
    headline = "Reading the document…";
    detail =
      job.mode === "page"
        ? "Text appears here as each page finishes."
        : "Whole-document mode returns everything at once, so this stays empty until the parse completes.";
  } else if (job.status === "canceled") {
    headline = "Stopped before any text was read.";
  } else if (job.status === "error") {
    headline = "The conversion failed, so there is no text.";
  } else if (devBackend) {
    headline = "No text found — and this backend cannot OCR.";
    detail =
      "The embedded-text development backend only reads a text layer the PDF already carries. A scanned document has none, so it comes back empty. Run the service without OCR_BACKEND=embedded-text, on a machine with a GPU, to read scans with Unlimited-OCR.";
  } else {
    headline = "No text found on the selected pages.";
    detail = "The pages may be blank, or the scan may be too low-contrast to read. A higher page resolution sometimes helps.";
  }

  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      {running ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-medium">{headline}</p>
      {detail && <p className="max-w-md text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function ServiceDownNotice({ status, onRetry }: { status: OcrServiceStatus; onRetry: () => void }) {
  if (status.reachable) return null;
  return (
    <Card className="border-amber-500/40 bg-amber-50 p-4 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 text-sm">
          <div className="font-semibold">The OCR service is not running</div>
          <p className="mt-1 text-muted-foreground">{status.error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Unlimited-OCR is a CUDA model, so it runs as a separate Python service. See{" "}
            <code className="rounded bg-muted px-1 py-0.5">ocr-service/README.md</code>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

function ServiceSummary({ status }: { status: OcrServiceStatus }) {
  if (!status.reachable) return null;
  const isDevBackend = status.backend !== "unlimited-ocr";
  return (
    <div className="mt-5 space-y-1.5 border-t pt-4 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span>Engine</span>
        <span className="truncate font-medium text-foreground">{status.model ?? status.backend}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Device</span>
        <span className="font-medium text-foreground">{status.device}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Model loaded</span>
        <span className="font-medium text-foreground">{status.modelLoaded ? "yes" : "on first use"}</span>
      </div>
      {isDevBackend && (
        <p className="pt-1 text-amber-600 dark:text-amber-400">
          Development backend: this reads the PDF&rsquo;s existing text layer and does no OCR. Scanned pages come back empty.
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
