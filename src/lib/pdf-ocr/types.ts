/** Wire types shared with the Python OCR sidecar (ocr-service/). */

/** Per page (`page`) keeps page boundaries and streams progress; whole
 *  document (`document`) is Unlimited-OCR's one-shot long-horizon parse, which
 *  reads better across page breaks but reports no intermediate progress. */
export type OcrMode = "page" | "document";

export type OcrStatus = "queued" | "running" | "done" | "error" | "canceled";

export type OcrPage = {
  number: number;
  text: string;
  chars: number;
  seconds: number;
};

export type OcrJob = {
  id: string;
  filename: string;
  mode: OcrMode;
  backend: string;
  status: OcrStatus;
  stage: string;
  pagesTotal: number;
  pagesDone: number;
  pageNumbers: number[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  /** Absent on the submit response; present on every poll. */
  pages?: OcrPage[];
  text?: string;
};

export type OcrHealth = {
  status: string;
  backend: string;
  model: string | null;
  device: string;
  modelLoaded: boolean;
  supportsDocumentMode: boolean;
  maxPages: number;
  maxUploadMb: number;
  jobs: { total: number; queued: number; running: number };
};

/** What /api/pdf-ocr returns when the sidecar cannot be reached at all. */
export type OcrServiceStatus =
  | ({ reachable: true } & OcrHealth)
  | { reachable: false; error: string; serviceUrl: string };

export const TERMINAL_STATUSES: OcrStatus[] = ["done", "error", "canceled"];

export function isFinished(job: Pick<OcrJob, "status">): boolean {
  return TERMINAL_STATUSES.includes(job.status);
}
