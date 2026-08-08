/**
 * Server-side client for the Python OCR sidecar (ocr-service/).
 *
 * Unlimited-OCR is a CUDA + PyTorch model, so it cannot live in this Node
 * process. It runs as its own HTTP service and the route handlers under
 * /api/pdf-ocr proxy to it -- which also keeps the sidecar off the public
 * network: it only ever has to listen on localhost.
 */

import { NextResponse } from "next/server";
import type { OcrJob, OcrServiceStatus } from "./types";

export const OCR_SERVICE_URL = (process.env.OCR_SERVICE_URL || "http://127.0.0.1:8077").replace(/\/+$/, "");

/** Mirrors OCR_MAX_UPLOAD_MB in the sidecar; rejected here so a too-big file
 *  never crosses the wire twice. */
export const MAX_UPLOAD_BYTES = Number(process.env.OCR_MAX_UPLOAD_MB || 64) * 1024 * 1024;

const HEALTH_TIMEOUT_MS = 4_000;
const POLL_TIMEOUT_MS = 15_000;
// Uploading a large PDF plus the sidecar writing it to disk. Not the OCR run
// itself -- that happens after the response, and is polled for.
const SUBMIT_TIMEOUT_MS = 120_000;

export class OcrServiceError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "OcrServiceError";
    this.status = status;
  }
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${OCR_SERVICE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is not reachable";
    throw new OcrServiceError(
      `The OCR service ${reason} at ${OCR_SERVICE_URL}. Start it with "uvicorn app:app --port 8077" in ocr-service/, or point OCR_SERVICE_URL at it.`,
      503
    );
  }

  if (!response.ok) {
    throw new OcrServiceError(await readError(response), response.status);
  }
  return response;
}

/** FastAPI puts its message in `detail`; fall back to whatever came back. */
async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  } catch {
    // not JSON
  }
  return body.slice(0, 400) || `The OCR service returned ${response.status}.`;
}

export async function fetchServiceStatus(): Promise<OcrServiceStatus> {
  try {
    const response = await call("/health", { method: "GET" }, HEALTH_TIMEOUT_MS);
    return { reachable: true, ...(await response.json()) };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : "The OCR service is not reachable.",
      serviceUrl: OCR_SERVICE_URL,
    };
  }
}

export async function submitJob(form: FormData): Promise<OcrJob> {
  const response = await call("/jobs", { method: "POST", body: form }, SUBMIT_TIMEOUT_MS);
  return response.json();
}

export async function fetchJob(jobId: string): Promise<OcrJob> {
  const response = await call(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, POLL_TIMEOUT_MS);
  return response.json();
}

/** Stop a running job and drop its scratch files. */
export async function stopJob(jobId: string): Promise<void> {
  const id = encodeURIComponent(jobId);
  await call(`/jobs/${id}/cancel`, { method: "POST" }, POLL_TIMEOUT_MS);
  await call(`/jobs/${id}`, { method: "DELETE" }, POLL_TIMEOUT_MS);
}

/**
 * Turn a sidecar failure into a response. Lives here rather than in the route
 * module because Next only allows handler exports from a route file.
 */
export function ocrErrorResponse(err: unknown) {
  if (err instanceof OcrServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "The OCR request failed." }, { status: 500 });
}
