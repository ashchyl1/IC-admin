import { NextResponse } from "next/server";

import { withFallback } from "@/lib/market";
import { aggregateCandles } from "@/lib/market/normalize";
import { errorResponse, isoDay } from "@/lib/market/responses";
import { isStoreConfigured, writeCandles } from "@/lib/market/supabase-store";
import { INTERVALS, isInterval, type Interval } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Body {
  symbol?: string;
  interval?: string;
  days?: number;
  from?: string;
  to?: string;
  token?: number;
}

/**
 * POST /api/market/sync — pull a range from Zerodha and store it in Supabase.
 *
 * The deliberate backfill, as opposed to the incidental caching the chart does
 * as you browse. Use it to build the history a long-degree count needs before
 * you need it, so the analysis is not waiting on a rate-limited broker.
 *
 * Body: `{ symbol, interval, days }` or `{ symbol, interval, from, to }`.
 */
export async function POST(request: Request) {
  if (!isStoreConfigured()) {
    return NextResponse.json(
      {
        error:
          "Supabase is not configured for market data. Set NEXT_PUBLIC_SUPABASE_URL, " +
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_BRIDGE_KEY.",
      },
      { status: 400 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const symbol = (body.symbol ?? "").trim();
  const rawInterval = (body.interval ?? "day").trim();
  if (!symbol) return NextResponse.json({ error: "symbol is required." }, { status: 400 });
  if (!isInterval(rawInterval)) {
    return NextResponse.json({ error: `Unknown interval "${rawInterval}".` }, { status: 400 });
  }

  const interval: Interval = rawInterval;
  const spec = INTERVALS[interval];
  const days = Math.min(7_300, Math.max(1, Math.round(body.days ?? spec.defaultDays)));
  const to = body.to ?? isoDay(Date.now());
  const from = body.from ?? isoDay(Date.parse(`${to}T00:00:00Z`) - days * 86_400_000);

  try {
    const { value, provider } = await withFallback((p) =>
      p.candles({ key: symbol, instrumentToken: body.token, interval, from, to })
    );

    if (!provider.info.live) {
      return NextResponse.json(
        {
          error:
            "Refusing to store simulated prices. Connect Zerodha first — writing generated " +
            "bars into shared market data would poison it for every reader.",
          provider: provider.info,
        },
        { status: 409 }
      );
    }

    const candles = spec.native ? value.candles : aggregateCandles(value.candles, interval);
    const result = await writeCandles(symbol, interval, candles, {
      name: value.instrument?.name ?? value.instrument?.tradingSymbol,
      tickSize: value.instrument?.tickSize ?? undefined,
      lotSize: value.instrument?.lotSize ?? undefined,
    });

    return NextResponse.json({
      symbol,
      interval,
      from,
      to,
      provider: provider.info,
      fetched: candles.length,
      ...(result ?? { written: 0, inserted: 0, updated: 0, rejected: [], totalAfter: 0 }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
