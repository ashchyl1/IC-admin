import { NextResponse } from "next/server";

import { withFallback } from "@/lib/market";
import { aggregateCandles } from "@/lib/market/normalize";
import { clampInt, errorResponse, isoDay } from "@/lib/market/responses";
import { INTERVALS, isInterval, type CandleResponse, type Interval } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/market/candles
 *
 * Historical bars for the Wave Lab, from whichever Zerodha path is configured.
 *
 *   ?symbol=NSE:NIFTY 50   instrument key (required)
 *   &interval=day          one of INTERVAL_KEYS (default `day`)
 *   &days=1400             history depth; ignored when from/to are given
 *   &from=2020-01-01&to=2026-08-09
 *   &token=256265          skip symbol resolution when you already have it
 *   &continuous=1&oi=1     forwarded to the broker for F&O instruments
 *
 * Week and month bars are rolled up here from daily, because Kite does not
 * serve them and Elliott work at Primary degree and above needs them.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required, e.g. NSE:NIFTY 50" }, { status: 400 });
  }

  const rawInterval = (url.searchParams.get("interval") ?? "day").trim();
  if (!isInterval(rawInterval)) {
    return NextResponse.json(
      { error: `Unknown interval "${rawInterval}". Allowed: ${Object.keys(INTERVALS).join(", ")}` },
      { status: 400 }
    );
  }
  const interval: Interval = rawInterval;
  const spec = INTERVALS[interval];

  const days = clampInt(url.searchParams.get("days"), 1, 7_300, spec.defaultDays);
  const to = url.searchParams.get("to") ?? isoDay(Date.now());
  const from = url.searchParams.get("from") ?? isoDay(Date.parse(`${to}T00:00:00Z`) - days * 86_400_000);

  const tokenParam = url.searchParams.get("token");
  const instrumentToken = tokenParam && /^\d+$/.test(tokenParam) ? Number(tokenParam) : undefined;

  try {
    const { value, provider, warning } = await withFallback((p) =>
      p.candles({
        key: symbol,
        instrumentToken,
        interval,
        from,
        to,
        continuous: url.searchParams.get("continuous") === "1",
        oi: url.searchParams.get("oi") === "1",
      })
    );

    // A provider that served `day` for a week/month request still needs rolling
    // up; one that answered natively is a no-op here because the buckets match.
    const candles = spec.native ? value.candles : aggregateCandles(value.candles, interval);

    const body: CandleResponse = {
      provider: provider.info,
      instrument: value.instrument,
      interval,
      candles,
      warning,
    };
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error);
  }
}
