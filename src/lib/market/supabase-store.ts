import "server-only";

/**
 * Supabase as the candle store.
 *
 * Reads and writes go through the bridge-key-gated RPCs rather than the
 * service-role key, which is the pattern migration 0007 set for exactly this
 * job: the console needs to move candles, not to read auth. A leak of this
 * app's config therefore cannot reach user sessions, orders or journals.
 *
 * Everything here degrades to "not configured" rather than throwing, so the
 * Wave Lab still works with no Supabase project at all — the cache is an
 * optimisation and a durability story, never a dependency.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createResilientFetch } from "@/lib/supabase/resilient-fetch";
import { fromChartTime, toChartTime } from "@/lib/scalper/time";
import { INTERVALS, type Interval, type MarketCandle } from "./types";

/** `NSE:NIFTY 50` → the exchange/symbol pair the tables are keyed on. */
export function splitKey(key: string): { exchange: string; symbol: string } {
  const index = key.indexOf(":");
  return index === -1
    ? { exchange: "NSE", symbol: key.trim().toUpperCase() }
    : { exchange: key.slice(0, index).trim().toUpperCase(), symbol: key.slice(index + 1).trim().toUpperCase() };
}

/**
 * The `timeframe` column is free text, so this is the app's convention for it.
 * Kept explicit rather than reusing the Kite interval names directly, because
 * the paper-trading module already writes `1m`/`1d` style values and two
 * spellings of the same timeframe would silently split a series in two.
 */
const TIMEFRAME: Record<Interval, string> = {
  minute: "1m",
  "3minute": "3m",
  "5minute": "5m",
  "10minute": "10m",
  "15minute": "15m",
  "30minute": "30m",
  "60minute": "1h",
  day: "1d",
  week: "1w",
  month: "1M",
};

export function timeframeFor(interval: Interval): string {
  return TIMEFRAME[interval];
}

export interface StoreConfig {
  url: string;
  key: string;
  bridgeKey: string;
}

export function storeConfig(): StoreConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const bridgeKey = process.env.SUPABASE_BRIDGE_KEY?.trim();
  return url && key && bridgeKey ? { url, key, bridgeKey } : null;
}

export function isStoreConfigured(): boolean {
  return storeConfig() !== null;
}

let cached: SupabaseClient | null = null;

function client(config: StoreConfig): SupabaseClient {
  if (!cached) {
    cached = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Same reasoning as the admin client: TLS interception drops connections,
      // and a connect-phase retry never replays a write that might have landed.
      global: { fetch: createResilientFetch() },
    });
  }
  return cached;
}

// ----------------------------------------------------------------- candles ---

export interface CachedCandles {
  candles: MarketCandle[];
  /** False when the instrument has never been written. */
  found: boolean;
}

export async function readCandles(
  key: string,
  interval: Interval,
  from: Date,
  to: Date,
  limit = 5000
): Promise<CachedCandles | null> {
  const config = storeConfig();
  if (!config) return null;

  const { exchange, symbol } = splitKey(key);
  const { data, error } = await client(config).rpc("read_market_candles", {
    p_key: config.bridgeKey,
    p_exchange: exchange,
    p_symbol: symbol,
    p_timeframe: timeframeFor(interval),
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_limit: limit,
  });
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const payload = data as { found?: boolean; candles?: unknown[] } | null;
  const rows = Array.isArray(payload?.candles) ? payload!.candles : [];

  return {
    found: payload?.found === true,
    candles: rows
      .map((row) => toCandle(row))
      .filter((candle): candle is MarketCandle => candle !== null),
  };
}

export interface WriteResult {
  written: number;
  inserted: number;
  updated: number;
  rejected: { ts: string; reason: string }[];
  totalAfter: number;
}

export async function writeCandles(
  key: string,
  interval: Interval,
  candles: MarketCandle[],
  meta: { name?: string; tickSize?: number; lotSize?: number; assetType?: string } = {}
): Promise<WriteResult | null> {
  const config = storeConfig();
  if (!config || candles.length === 0) return null;

  const { exchange, symbol } = splitKey(key);
  // The table's CHECK constraints reject non-positive prices and inconsistent
  // OHLC. Filtering here keeps a single bad bar from making the whole batch a
  // round trip that reports failures instead of writing the good rows.
  const rows = candles
    .filter(
      (candle) =>
        Math.min(candle.open, candle.high, candle.low, candle.close) > 0 &&
        candle.high >= Math.max(candle.open, candle.low, candle.close) &&
        candle.low <= Math.min(candle.open, candle.high, candle.close)
    )
    .map((candle) => ({
      ts: new Date(fromChartTime(candle.time)).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Math.max(0, candle.volume),
    }));
  if (rows.length === 0) return null;

  const { data, error } = await client(config).rpc("import_market_candles", {
    p_key: config.bridgeKey,
    p_exchange: exchange,
    p_symbol: symbol,
    p_timeframe: timeframeFor(interval),
    p_candles: rows,
    p_name: meta.name ?? symbol,
    p_asset_type: meta.assetType ?? "EQUITY",
    p_currency: "INR",
    p_timezone: "Asia/Kolkata",
    p_tick_size: meta.tickSize && meta.tickSize > 0 ? meta.tickSize : 0.05,
    p_lot_size: meta.lotSize && meta.lotSize > 0 ? meta.lotSize : 1,
  });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);

  const payload = (data ?? {}) as Partial<WriteResult> & { rejected?: unknown };
  return {
    written: payload.written ?? 0,
    inserted: payload.inserted ?? 0,
    updated: payload.updated ?? 0,
    totalAfter: payload.totalAfter ?? 0,
    rejected: Array.isArray(payload.rejected)
      ? (payload.rejected as { ts: string; reason: string }[])
      : [],
  };
}

function toCandle(row: unknown): MarketCandle | null {
  if (row === null || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const ms = Date.parse(String(record.ts ?? ""));
  const open = Number(record.open);
  const high = Number(record.high);
  const low = Number(record.low);
  const close = Number(record.close);
  if (!Number.isFinite(ms) || ![open, high, low, close].every(Number.isFinite)) return null;

  return {
    time: toChartTime(ms),
    open,
    high,
    low,
    close,
    volume: Number(record.volume) || 0,
  };
}

// -------------------------------------------------------------- freshness ---

/**
 * Is the cached series complete enough to answer without calling the broker?
 *
 * "Complete" cannot mean "every bar present" — exchanges have holidays, and
 * chasing a bar that never existed would defeat the cache on every request.
 * The test is instead whether the newest cached bar is recent enough for the
 * interval: one interval's slack for intraday, and a few days for daily and
 * above, which covers a long weekend.
 */
export function isFresh(candles: MarketCandle[], interval: Interval, now = Date.now()): boolean {
  const last = candles[candles.length - 1];
  if (!last) return false;

  const minutes = INTERVALS[interval].minutes;
  const slackMs = minutes >= 375 ? 4 * 86_400_000 : Math.max(2 * minutes * 60_000, 15 * 60_000);
  return fromChartTime(last.time) >= now - slackMs;
}

/** Merge cached and freshly fetched bars, newest wins on a timestamp clash. */
export function mergeCandles(cached: MarketCandle[], fresh: MarketCandle[]): MarketCandle[] {
  if (cached.length === 0) return fresh;
  if (fresh.length === 0) return cached;

  const byTime = new Map<number, MarketCandle>();
  for (const candle of cached) byTime.set(candle.time, candle);
  for (const candle of fresh) byTime.set(candle.time, candle);
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}
