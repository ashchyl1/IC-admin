import { NextResponse } from "next/server";

import { withFallback } from "@/lib/market";
import { errorResponse } from "@/lib/market/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/market/quote?symbols=NSE:NIFTY 50,NSE:INFY
 *
 * The live tail of the chart. The Wave Lab polls this on a timer rather than
 * holding a socket: a wave analyst is looking at structure, not the tape, and a
 * few seconds of latency costs nothing while a WebSocket per open tab costs a
 * broker connection each.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "symbols is required" }, { status: 400 });
  }

  try {
    const { value, provider, warning } = await withFallback((p) => p.quotes(symbols));
    return NextResponse.json({ provider: provider.info, quotes: value, warning });
  } catch (error) {
    return errorResponse(error);
  }
}
