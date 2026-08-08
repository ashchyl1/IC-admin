import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, fetchServiceStatus, ocrErrorResponse, submitJob } from "@/lib/pdf-ocr/service";
import { parsePageSelection } from "@/lib/pdf-ocr/pages";

export const dynamic = "force-dynamic";
// Node, not edge: the upload is buffered and checked before it is forwarded.
export const runtime = "nodejs";

const MODES = new Set(["page", "document"]);
const MIN_DPI = 72;
const MAX_DPI = 400;

/** Sidecar health, so the page can say what is running before anyone uploads. */
export async function GET() {
  return NextResponse.json(await fetchServiceStatus());
}

/** Accept a PDF and hand it to the OCR service. Returns the job to poll. */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  const f = file as File;

  if (f.size > MAX_UPLOAD_BYTES) {
    const limit = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return NextResponse.json({ error: `The PDF is larger than the ${limit} MB limit.` }, { status: 413 });
  }

  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }
  // Check the header rather than the browser-supplied MIME type, which is
  // trivially wrong (and empty for some drag-and-drop sources).
  if (!startsWithPdfHeader(bytes)) {
    return NextResponse.json({ error: "That file is not a PDF." }, { status: 415 });
  }

  const mode = String(form.get("mode") || "page");
  if (!MODES.has(mode)) {
    return NextResponse.json({ error: `Unknown mode "${mode}".` }, { status: 400 });
  }

  const selection = parsePageSelection(String(form.get("pages") || ""));
  if (!selection.ok) {
    return NextResponse.json({ error: selection.error }, { status: 400 });
  }

  const dpi = Number(form.get("dpi"));
  const outbound = new FormData();
  outbound.set("file", new Blob([bytes], { type: "application/pdf" }), f.name || "document.pdf");
  outbound.set("mode", mode);
  outbound.set("pages", selection.canonical);
  if (Number.isFinite(dpi)) {
    outbound.set("dpi", String(Math.min(MAX_DPI, Math.max(MIN_DPI, Math.round(dpi)))));
  }

  try {
    return NextResponse.json(await submitJob(outbound), { status: 202 });
  } catch (err) {
    return ocrErrorResponse(err);
  }
}

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"
}
