import { NextResponse } from "next/server";

import { withFallback } from "@/lib/market";
import { clampInt, errorResponse } from "@/lib/market/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/market/search?q=nifty&limit=20 — powers the symbol picker. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 1) {
    return NextResponse.json({ instruments: [] });
  }
  const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);

  try {
    const { value, provider, warning } = await withFallback((p) => p.search(query, limit));
    return NextResponse.json({ provider: provider.info, instruments: value, warning });
  } catch (error) {
    return errorResponse(error);
  }
}
