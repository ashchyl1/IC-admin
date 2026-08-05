import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CandleRow } from "@/lib/paper/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 1000;

type Body = {
  instrument?: {
    id?: string;
    symbol?: string;
    name?: string;
    exchange?: string;
    currency?: string;
    timezone?: string;
    tick_size?: number;
    lot_size?: number;
  };
  timeframe?: string;
  candles?: CandleRow[];
};

/**
 * Batch upsert of OHLCV history.
 *
 * `market_candles` and `instruments` are shared reference data and are
 * deliberately read-only to every browser client, so the write happens here
 * with the service-role key -- after this route has verified there is a signed
 * in user. The key stays server-side; src/lib/supabase/admin.ts is `server-only`.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to import market data." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { instrument, timeframe, candles } = body;
  if (!timeframe || !Array.isArray(candles) || candles.length === 0) {
    return NextResponse.json(
      { error: "timeframe and a non-empty candles array are required." },
      { status: 400 }
    );
  }
  if (!instrument?.id && !(instrument?.symbol && instrument?.exchange)) {
    return NextResponse.json(
      { error: "Provide either an existing instrument id, or a symbol and exchange to create one." },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Service role key unavailable." },
      { status: 500 }
    );
  }

  // ------------------------------------------------- resolve the instrument ---
  let instrumentId = instrument.id;
  if (!instrumentId) {
    const { data: existing } = await admin
      .from("instruments")
      .select("id")
      .eq("exchange", instrument.exchange!)
      .eq("symbol", instrument.symbol!)
      .maybeSingle();

    if (existing) {
      instrumentId = existing.id;
    } else {
      const { data: created, error } = await admin
        .from("instruments")
        .insert({
          symbol: instrument.symbol!,
          exchange: instrument.exchange!,
          name: instrument.name || instrument.symbol!,
          currency: instrument.currency || "INR",
          timezone: instrument.timezone || "Asia/Kolkata",
          tick_size: instrument.tick_size ?? 0.05,
          lot_size: instrument.lot_size ?? 1,
        })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      instrumentId = created.id;
    }
  }

  // How many of these timestamps already exist, so the summary can distinguish
  // inserted from updated.
  const { count: before } = await admin
    .from("market_candles")
    .select("id", { count: "exact", head: true })
    .eq("instrument_id", instrumentId)
    .eq("timeframe", timeframe)
    .gte("ts", candles[0].ts)
    .lte("ts", candles[candles.length - 1].ts);

  // ------------------------------------------------------------- upsert ---
  let written = 0;
  for (let i = 0; i < candles.length; i += BATCH) {
    const slice = candles.slice(i, i + BATCH).map((c) => ({
      instrument_id: instrumentId!,
      timeframe,
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const { error } = await admin
      .from("market_candles")
      .upsert(slice, { onConflict: "instrument_id,timeframe,ts" });

    if (error) {
      return NextResponse.json(
        { error: error.message, writtenBeforeFailure: written },
        { status: 400 }
      );
    }
    written += slice.length;
  }

  const { count: after } = await admin
    .from("market_candles")
    .select("id", { count: "exact", head: true })
    .eq("instrument_id", instrumentId)
    .eq("timeframe", timeframe);

  return NextResponse.json({
    instrumentId,
    timeframe,
    received: candles.length,
    written,
    updatedExisting: before ?? 0,
    inserted: written - (before ?? 0),
    totalCandlesForInstrument: after ?? null,
    range: { from: candles[0].ts, to: candles[candles.length - 1].ts },
  });
}
