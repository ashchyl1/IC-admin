import "server-only";

/**
 * Kite Connect REST provider.
 *
 * The direct path: `KITE_API_KEY` + `KITE_ACCESS_TOKEN` against
 * `https://api.kite.trade`. Read endpoints only — historical candles, quotes
 * and the instrument dump. Nothing in this file can place an order.
 *
 * Access tokens are day-scoped by Zerodha; a 403 here means "run the login
 * flow again", which the route surfaces as a 401 so the UI can say so plainly.
 */

import { fetchWithTimeout, readJson, truncate } from "../http";
import { dedupe, parseInstrumentCsv, toCandles, toQuotes } from "../normalize";
import { fromChartTime } from "@/lib/scalper/time";
import {
  INTERVALS,
  ProviderError,
  type CandleRequest,
  type Instrument,
  type MarketCandle,
  type MarketProvider,
  type MarketQuote,
  type ProviderInfo,
} from "../types";

const PROVIDER = "kite-rest" as const;
const INSTRUMENT_TTL_MS = 12 * 3_600_000;

/** Module-level so the ~2MB CSV is parsed once per server process, not per request. */
const instrumentCache = new Map<string, { at: number; rows: Instrument[] }>();

export interface KiteRestOptions {
  apiKey: string;
  accessToken: string;
  baseUrl?: string;
}

export class KiteRestProvider implements MarketProvider {
  readonly info: ProviderInfo;
  private readonly baseUrl: string;

  constructor(private readonly options: KiteRestOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.kite.trade").replace(/\/+$/, "");
    this.info = { id: PROVIDER, label: "Kite Connect REST", live: true, detail: this.baseUrl };
  }

  private headers(): Record<string, string> {
    return {
      "X-Kite-Version": "3",
      Authorization: `token ${this.options.apiKey}:${this.options.accessToken}`,
    };
  }

  private async get(path: string): Promise<unknown> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}${path}`,
      { method: "GET", headers: this.headers() },
      PROVIDER
    );
    if (response.status === 403 || response.status === 401) {
      throw new ProviderError(
        "Kite rejected the access token (403). Kite access tokens expire daily — re-run the login flow and update KITE_ACCESS_TOKEN.",
        PROVIDER,
        401
      );
    }
    return readJson(response, PROVIDER);
  }

  async candles(request: CandleRequest): Promise<{
    candles: MarketCandle[];
    instrument: Instrument | null;
  }> {
    const instrument = request.instrumentToken ? null : await this.resolve(request.key);
    const token = request.instrumentToken ?? instrument?.instrumentToken;
    if (token === undefined) {
      throw new ProviderError(`No instrument token for ${request.key}`, PROVIDER, 404);
    }

    const interval = request.interval === "week" || request.interval === "month" ? "day" : request.interval;
    const spec = INTERVALS[interval];
    const chunks = chunkRange(request.from, request.to, spec.maxDaysPerRequest);

    const all: MarketCandle[] = [];
    for (const [from, to] of chunks) {
      const params = new URLSearchParams({ from, to });
      if (request.continuous) params.set("continuous", "1");
      if (request.oi) params.set("oi", "1");
      const payload = await this.get(
        `/instruments/historical/${token}/${interval}?${params.toString()}`
      );
      all.push(...toCandles(payload));
    }

    const candles = dedupe(all);
    if (candles.length === 0) {
      throw new ProviderError(
        `Kite returned no candles for ${request.key} ${request.interval} (${request.from} → ${request.to}).`,
        PROVIDER,
        404
      );
    }
    return { candles, instrument };
  }

  async quotes(keys: string[]): Promise<MarketQuote[]> {
    if (keys.length === 0) return [];
    const params = keys.map((key) => `i=${encodeURIComponent(key)}`).join("&");
    return toQuotes(await this.get(`/quote?${params}`), keys);
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    const [exchange, term] = splitKey(query);
    const rows = await this.instruments(/^[A-Z]+:/.test(query) ? exchange : null);
    return rankInstruments(rows, term, limit);
  }

  private async resolve(key: string): Promise<Instrument | null> {
    const [exchange, symbol] = splitKey(key);
    const rows = await this.instruments(exchange);
    return (
      rows.find((row) => row.exchange === exchange && row.tradingSymbol === symbol) ??
      rows.find((row) => row.tradingSymbol === symbol) ??
      null
    );
  }

  /** The instrument dump for one exchange, or the whole book when null. */
  private async instruments(exchange: string | null): Promise<Instrument[]> {
    const cacheKey = exchange ?? "ALL";
    const cached = instrumentCache.get(cacheKey);
    if (cached && Date.now() - cached.at < INSTRUMENT_TTL_MS) return cached.rows;

    const response = await fetchWithTimeout(
      `${this.baseUrl}/instruments${exchange ? `/${exchange}` : ""}`,
      { method: "GET", headers: this.headers(), timeoutMs: 60_000 },
      PROVIDER
    );
    const csv = await response.text();
    if (!response.ok) {
      throw new ProviderError(
        `Instrument dump failed: HTTP ${response.status} — ${truncate(csv, 200)}`,
        PROVIDER,
        response.status === 403 ? 401 : 502
      );
    }
    const rows = parseInstrumentCsv(csv);
    instrumentCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
  }
}

/**
 * Rank a plain instrument dump the way a symbol box should: exact ticker first,
 * then prefix matches, then anything whose company name contains the term.
 * Cash equity and index rows outrank the thousands of option contracts that
 * share their underlying's name.
 */
export function rankInstruments(rows: Instrument[], term: string, limit: number): Instrument[] {
  const needle = term.trim().toUpperCase();
  if (needle === "") return rows.slice(0, limit);

  const scored: { row: Instrument; score: number }[] = [];
  for (const row of rows) {
    const symbol = row.tradingSymbol.toUpperCase();
    const name = (row.name ?? "").toUpperCase();

    let score = -1;
    if (symbol === needle) score = 100;
    else if (name === needle) score = 90;
    else if (symbol.startsWith(needle)) score = 70;
    else if (name.startsWith(needle)) score = 60;
    else if (symbol.includes(needle)) score = 40;
    else if (name.includes(needle)) score = 30;
    if (score < 0) continue;

    // Prefer the tradable cash/index line over its derivative chain.
    if (row.instrumentType === "EQ") score += 12;
    if (row.segment === "INDICES") score += 10;
    if (row.expiry) score -= 8;
    if (row.exchange === "NSE" || row.exchange === "BSE") score += 4;

    scored.push({ row, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.row.tradingSymbol.localeCompare(b.row.tradingSymbol))
    .slice(0, limit)
    .map((entry) => entry.row);
}

/**
 * Kite caps how much history one call may span, and the cap differs per
 * interval. Split the requested window into legal chunks, oldest first.
 */
export function chunkRange(from: string, to: string, maxDays: number): [string, string][] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [[from, to]];

  const span = maxDays * 86_400_000;
  const out: [string, string][] = [];
  for (let cursor = start; cursor <= end; cursor += span + 86_400_000) {
    const chunkEnd = Math.min(cursor + span, end);
    out.push([isoDay(cursor), isoDay(chunkEnd)]);
    if (chunkEnd === end) break;
  }
  return out;
}

function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function splitKey(key: string): [string, string] {
  const index = key.indexOf(":");
  return index === -1 ? ["NSE", key] : [key.slice(0, index), key.slice(index + 1)];
}

/** Exported for the route's freshness check — the last bar's wall-clock time. */
export function lastBarEpochMs(candles: MarketCandle[]): number | null {
  const last = candles[candles.length - 1];
  return last ? fromChartTime(last.time) : null;
}
