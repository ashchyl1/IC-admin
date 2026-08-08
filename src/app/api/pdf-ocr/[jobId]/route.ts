import { NextResponse } from "next/server";
import { fetchJob, ocrErrorResponse, stopJob } from "@/lib/pdf-ocr/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: { jobId: string } };

/** Poll a conversion. Partial pages are included while it is still running. */
export async function GET(_req: Request, { params }: Params) {
  try {
    return NextResponse.json(await fetchJob(params.jobId));
  } catch (err) {
    return ocrErrorResponse(err);
  }
}

/** Stop a running conversion and discard its scratch files. */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    await stopJob(params.jobId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return ocrErrorResponse(err);
  }
}
