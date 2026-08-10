/**
 * Market-data contracts. §2.4 of the brief.
 *
 * One interface, several implementations, chosen by MARKET_PROVIDER. Everything
 * above this layer — chart, tools, rule engine — is written against these types
 * and never against Kite's wire format, so swapping MCP for REST for synthetic
 * changes exactly one factory call.
 */

import type { ChartTime } from "./time";

/** Chart intervals offered by the terminal (§3). */
export const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "1D", "1W", "1M"] as const;
export type Interval = (typeof INTERVALS)[number];

/**
 * Kite's native interval names. 1W and 1M are absent on purpose: Kite has no
 * weekly or monthly candle, so those are aggregated from daily bars on our
 * side. Anything mapping to `null` must be derived, never requested.
 */
export const KITE_INTERVAL: Record<Interval, string | null> = {
  "1m": "minute",
  "3m": "3minute",
  "5m": "5minute",
  "15m": "15minute",
  "30m": "30minute",
  "1h": "60minute",
  "1D": "day",
  "1W": null,
  "1M": null,
};

/** Interval length in seconds. 1M is nominal — used only for cache slack. */
export const INTERVAL_SECONDS: Record<Interval, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "1D": 86400,
  "1W": 604800,
  "1M": 2592000,
};

export function isIntraday(interval: Interval): boolean {
  return INTERVAL_SECONDS[interval] < 86400;
}

/**
 * A single bar.
 *
 * `time` is already in chart coordinates (see time.ts) so no component
 * downstream has to remember to convert. `epochSeconds` keeps the true instant
 * for export, cache keys and anything that must round-trip.
 */
export interface MarketCandle {
  time: ChartTime;
  epochSeconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  last: number;
  change: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  /** True instant of the quote, epoch seconds. */
  at: number;
}

export interface Instrument {
  /** Exchange-qualified key, e.g. "NSE:INFY" or "NSE:NIFTY 50". */
  key: string;
  exchange: string;
  tradingSymbol: string;
  name: string;
  instrumentToken?: number;
  segment?: string;
  lotSize?: number;
  tickSize?: number;
}

export interface CandleRequest {
  symbol: string;
  interval: Interval;
  from: Date;
  to: Date;
}

export interface ProviderInfo {
  id: "kite-mcp" | "kite-rest" | "synthetic";
  label: string;
  /** False for synthetic. Drives the "SYNTHETIC" warning chrome (§2.4). */
  live: boolean;
}

export interface MarketProvider {
  info: ProviderInfo;
  candles(req: CandleRequest): Promise<MarketCandle[]>;
  quote(symbols: string[]): Promise<Record<string, Quote>>;
  search(query: string): Promise<Instrument[]>;
}

/** Auth states the connection badge must render (§2.2). All four of them. */
export type ConnectionState =
  | { status: "not-configured"; detail: string }
  | { status: "signed-out"; detail: string; loginUrl?: string }
  | { status: "signed-in"; userName: string; expiresAt?: number }
  | { status: "error"; detail: string };

/**
 * Thrown when a provider needs the user to sign in. The route layer maps this
 * to HTTP 401 so the UI can prompt, rather than surfacing a generic 502 (§2.2).
 */
export class AuthRequiredError extends Error {
  readonly loginUrl?: string;
  constructor(message: string, loginUrl?: string) {
    super(message);
    this.name = "AuthRequiredError";
    this.loginUrl = loginUrl;
  }
}

/**
 * Thrown when the account is authenticated but lacks Kite's historical-data
 * subscription. Distinct from AuthRequiredError because the remedy is
 * different and the raw failure is otherwise indistinguishable from "no data
 * for this symbol" (§2.3).
 */
export class HistoricalNotSubscribedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalNotSubscribedError";
  }
}
