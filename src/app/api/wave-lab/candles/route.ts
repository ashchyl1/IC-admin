import { NextRequest, NextResponse } from "next/server";
import { resolveCandles } from "@/lib/wave-lab/providers";
import {
  AuthRequiredError,
  HistoricalNotSubscribedError,
  INTERVALS,
  type Interval,
} from "@/lib/wave-lab/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/wave-lab/candles?symbol=NSE:INFY&interval=1D&from=…&to=…
 *
 * Only route handlers are exported from this file (§12.5) — the resolution
 * logic lives in lib/, or the production build rejects the module while
 * `next dev` happily serves it.
 *
 * Every failure returns a sentence the UI can show verbatim (§14).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const symbol = params.get("symbol")?.trim();
  const interval = params.get("interval") as Interval | null;

  if (!symbol) {
    return NextResponse.json(
      { error: "A symbol is required, for example NSE:INFY." },
      { status: 400 }
    );
  }
  if (!interval || !INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `Interval must be one of ${INTERVALS.join(", ")}.` },
      { status: 400 }
    );
  }

  const to = parseDate(params.get("to")) ?? new Date();
  const from = parseDate(params.get("from")) ?? defaultFrom(interval, to);
  if (from >= to) {
    return NextResponse.json({ error: "`from` must be earlier than `to`." }, { status: 400 });
  }

  try {
    const resolution = await resolveCandles({ symbol, interval, from, to });
    return NextResponse.json(resolution);
  } catch (err) {
    // Auth failures become 401 so the UI prompts for sign-in rather than
    // showing a generic upstream error (§2.2).
    if (err instanceof AuthRequiredError) {
      return NextResponse.json(
        { error: err.message, loginUrl: err.loginUrl, needsAuth: true },
        { status: 401 }
      );
    }
    if (err instanceof HistoricalNotSubscribedError) {
      return NextResponse.json({ error: err.message, needsSubscription: true }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load candles." },
      { status: 502 }
    );
  }
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const asNumber = Number(raw);
  const d = Number.isFinite(asNumber) && raw.trim() !== "" ? new Date(asNumber * 1000) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A sensible window per interval, so a bare request still draws a chart. */
function defaultFrom(interval: Interval, to: Date): Date {
  const days: Record<Interval, number> = {
    "1m": 5,
    "3m": 10,
    "5m": 20,
    "15m": 45,
    "30m": 90,
    "1h": 180,
    "1D": 730,
    "1W": 1825,
    "1M": 3650,
  };
  return new Date(to.getTime() - days[interval] * 86400 * 1000);
}
