/**
 * The browser's view of market data.
 *
 * One indirection with two implementations: the default talks to
 * `/api/market/*`, and the standalone build swaps in an in-browser generator
 * because it has no server to talk to. Everything in the workspace goes through
 * here, so neither the store nor any component knows which it is.
 */

import type { Instrument, Interval, MarketCandle, ProviderInfo } from "./types";

export interface CandleQuery {
  symbol: string;
  interval: Interval;
  days: number;
  instrumentToken?: number;
}

export interface CandleResult {
  candles: MarketCandle[];
  provider: ProviderInfo | null;
  warning?: string;
}

export interface QuoteResult {
  key: string;
  last: number;
}

export interface MarketClient {
  candles(query: CandleQuery): Promise<CandleResult>;
  quotes(symbols: string[]): Promise<QuoteResult[]>;
  search(query: string, limit: number): Promise<Instrument[]>;
}

/** Talks to this app's own route handlers. */
export const httpMarketClient: MarketClient = {
  async candles({ symbol, interval, days, instrumentToken }) {
    const params = new URLSearchParams({ symbol, interval, days: String(days) });
    if (instrumentToken) params.set("token", String(instrumentToken));

    const response = await fetch(`/api/market/candles?${params.toString()}`);
    const payload = (await response.json()) as {
      candles?: MarketCandle[];
      provider?: ProviderInfo;
      warning?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return {
      candles: payload.candles ?? [],
      provider: payload.provider ?? null,
      warning: payload.warning,
    };
  },

  async quotes(symbols) {
    if (symbols.length === 0) return [];
    const response = await fetch(`/api/market/quote?symbols=${encodeURIComponent(symbols.join(","))}`);
    if (!response.ok) return [];
    const payload = (await response.json()) as { quotes?: QuoteResult[] };
    return payload.quotes ?? [];
  },

  async search(query, limit) {
    const response = await fetch(`/api/market/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    const payload = (await response.json()) as { instruments?: Instrument[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload.instruments ?? [];
  },
};

let active: MarketClient = httpMarketClient;

export function setMarketClient(client: MarketClient): void {
  active = client;
}

export function getMarketClient(): MarketClient {
  return active;
}
