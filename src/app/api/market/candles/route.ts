import { NextResponse } from "next/server";

import { withFallback } from "@/lib/market";
import { aggregateCandles } from "@/lib/market/normalize";
import { clampInt, errorResponse, isoDay } from "@/lib/market/responses";
import {
  isFresh,
  isStoreConfigured,
  mergeCandles,
  readCandles,
  writeCandles,
} from "@/lib/market/supabase-store";
import { INTERVALS, isInterval, type CandleResponse, type Interval } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/market/candles
 *
 * Historical bars for the Wave Lab, cached in Supabase and refreshed from
 * Zerodha.
 *
 *   ?symbol=NSE:NIFTY 50   instrument key (required)
 *   &interval=day          one of INTERVAL_KEYS (default `day`)
 *   &days=1400             history depth; ignored when from/to are given
 *   &from=2020-01-01&to=2026-08-09
 *   &token=256265          skip symbol resolution when you already have it
 *   &refresh=1             ignore the cache and go to the broker
 *   &continuous=1&oi=1     forwarded to the broker for F&O instruments
 *
 * The order of preference is deliberate. A cached series that is current
 * answers immediately — Kite's historical endpoint is rate-limited and every
 * chart interaction would otherwise spend one of those requests. When the cache
 * is stale or absent the broker fills the gap and the result is written back,
 * so the next request is cheap and the history survives a token expiring.
 *
 * That last point is the one worth keeping: if the broker is unreachable — an
 * expired token, a Zerodha outage — cached bars are still served, with a
 * warning saying why they may be behind, rather than an empty chart.
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
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const tokenParam = url.searchParams.get("token");
  const instrumentToken = tokenParam && /^\d+$/.test(tokenParam) ? Number(tokenParam) : undefined;

  const fromDate = new Date(`${from}T00:00:00+05:30`);
  const toDate = new Date(`${to}T23:59:59+05:30`);

  // ------------------------------------------------------------- cache ---
  let cachedCandles: Awaited<ReturnType<typeof readCandles>> = null;
  let cacheError: string | undefined;

  if (isStoreConfigured() && !forceRefresh) {
    try {
      cachedCandles = await readCandles(symbol, interval, fromDate, toDate);
    } catch (error) {
      cacheError = error instanceof Error ? error.message : String(error);
    }
  }

  if (cachedCandles && cachedCandles.candles.length > 0 && isFresh(cachedCandles.candles, interval)) {
    const body: CandleResponse = {
      provider: {
        id: "supabase",
        label: "Supabase cache",
        live: true,
        detail: `${cachedCandles.candles.length} bars stored`,
      },
      instrument: null,
      interval,
      candles: cachedCandles.candles,
      source: "cache",
      warning: cacheError,
    };
    return NextResponse.json(body);
  }

  // ------------------------------------------------------------ broker ---
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

    const fetched = spec.native ? value.candles : aggregateCandles(value.candles, interval);
    const candles = mergeCandles(cachedCandles?.candles ?? [], fetched);

    // Only real prices are worth persisting; writing the synthetic fallback
    // into shared reference data would poison it for every other reader.
    let stored: number | undefined;
    let storeWarning: string | undefined;
    if (isStoreConfigured() && provider.info.live && fetched.length > 0) {
      try {
        const result = await writeCandles(symbol, interval, fetched, {
          name: value.instrument?.name ?? value.instrument?.tradingSymbol,
          tickSize: value.instrument?.tickSize ?? undefined,
          lotSize: value.instrument?.lotSize ?? undefined,
        });
        stored = result?.written;
      } catch (error) {
        // A failed cache write must not fail the request — the caller has the
        // data it asked for either way.
        storeWarning = `Supabase write failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const body: CandleResponse = {
      provider: provider.info,
      instrument: value.instrument,
      interval,
      candles,
      source: cachedCandles?.candles.length ? "broker+cache" : "broker",
      stored,
      warning: [warning, cacheError, storeWarning].filter(Boolean).join(" · ") || undefined,
    };
    return NextResponse.json(body);
  } catch (error) {
    // The broker failed. Stale cached bars beat a blank chart, as long as the
    // response says plainly that they are stale and why.
    if (cachedCandles && cachedCandles.candles.length > 0) {
      const body: CandleResponse = {
        provider: {
          id: "supabase",
          label: "Supabase cache (stale)",
          live: true,
          detail: `${cachedCandles.candles.length} bars stored`,
        },
        instrument: null,
        interval,
        candles: cachedCandles.candles,
        source: "cache-fallback",
        warning: `Serving stored bars — the broker could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      return NextResponse.json(body);
    }
    return errorResponse(error);
  }
}
