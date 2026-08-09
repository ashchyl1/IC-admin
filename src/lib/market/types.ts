/**
 * Market-data contracts shared by the server routes and the Wave Lab client.
 *
 * The wave module never talks to a broker directly — it asks `/api/market/*`,
 * which resolves one of the providers in `./providers`. That seam is what lets
 * the same UI run against Zerodha MCP, Kite Connect REST, a local bridge, or a
 * synthetic feed with nothing but an env change.
 */

/** Unix seconds, already shifted to exchange wall-clock (see `toChartTime`). */
export type Seconds = number;

export interface MarketCandle {
  time: Seconds;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Open interest, when the provider supplies it (F&O only). */
  oi?: number;
}

/**
 * Candle intervals the Wave Lab offers. These are the Kite Connect interval
 * names verbatim, so a provider can forward them without a translation table.
 */
export type Interval =
  | "minute"
  | "3minute"
  | "5minute"
  | "10minute"
  | "15minute"
  | "30minute"
  | "60minute"
  | "day"
  | "week"
  | "month";

export interface IntervalSpec {
  key: Interval;
  /** Toolbar label. */
  label: string;
  minutes: number;
  /** Days of history a single provider request may span (Kite's own caps). */
  maxDaysPerRequest: number;
  /** Days of history to load by default. */
  defaultDays: number;
  /**
   * Intervals Kite serves natively. The rest are rolled up locally from the
   * finest native interval that divides them.
   */
  native: boolean;
}

/**
 * Weekly and monthly are not Kite intervals — they are aggregated from daily
 * bars on our side, which matters for Elliott work at Primary degree and above.
 */
export const INTERVALS: Record<Interval, IntervalSpec> = {
  minute: { key: "minute", label: "1m", minutes: 1, maxDaysPerRequest: 60, defaultDays: 5, native: true },
  "3minute": { key: "3minute", label: "3m", minutes: 3, maxDaysPerRequest: 100, defaultDays: 12, native: true },
  "5minute": { key: "5minute", label: "5m", minutes: 5, maxDaysPerRequest: 100, defaultDays: 20, native: true },
  "10minute": { key: "10minute", label: "10m", minutes: 10, maxDaysPerRequest: 100, defaultDays: 40, native: true },
  "15minute": { key: "15minute", label: "15m", minutes: 15, maxDaysPerRequest: 200, defaultDays: 60, native: true },
  "30minute": { key: "30minute", label: "30m", minutes: 30, maxDaysPerRequest: 200, defaultDays: 90, native: true },
  "60minute": { key: "60minute", label: "1h", minutes: 60, maxDaysPerRequest: 400, defaultDays: 180, native: true },
  day: { key: "day", label: "1D", minutes: 375, maxDaysPerRequest: 2000, defaultDays: 1400, native: true },
  week: { key: "week", label: "1W", minutes: 375 * 5, maxDaysPerRequest: 2000, defaultDays: 3650, native: false },
  month: { key: "month", label: "1M", minutes: 375 * 21, maxDaysPerRequest: 2000, defaultDays: 7300, native: false },
};

export const INTERVAL_KEYS: Interval[] = [
  "minute",
  "3minute",
  "5minute",
  "10minute",
  "15minute",
  "30minute",
  "60minute",
  "day",
  "week",
  "month",
];

export function isInterval(value: string): value is Interval {
  return Object.prototype.hasOwnProperty.call(INTERVALS, value);
}

export interface Instrument {
  /** Kite instrument token. Required by the historical-data endpoint. */
  instrumentToken: number;
  exchangeToken?: number;
  tradingSymbol: string;
  name?: string;
  exchange: string;
  segment?: string;
  instrumentType?: string;
  expiry?: string | null;
  strike?: number | null;
  lotSize?: number | null;
  tickSize?: number | null;
  /** `NSE:INFY` — the form every quote endpoint accepts. */
  key: string;
}

export interface MarketQuote {
  key: string;
  last: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  oi: number | null;
  /** Epoch ms when the provider stamped it. */
  ts: number;
}

export type ProviderId = "kite-mcp" | "kite-rest" | "bridge" | "synthetic";

/** Everything the UI needs to be honest about where the numbers came from. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** False for `synthetic` — the workspace shows a simulated-data ribbon. */
  live: boolean;
  /** Human-readable note shown in the status strip (endpoint, auth state). */
  detail?: string;
}

export interface CandleRequest {
  /** Either an explicit token, or a `EXCHANGE:SYMBOL` key the provider resolves. */
  instrumentToken?: number;
  key: string;
  interval: Interval;
  /** Inclusive ISO dates (yyyy-mm-dd) in exchange local time. */
  from: string;
  to: string;
  /** Continuous futures data. Ignored by non-derivative instruments. */
  continuous?: boolean;
  oi?: boolean;
}

export interface CandleResponse {
  provider: ProviderInfo;
  instrument: Instrument | null;
  interval: Interval;
  candles: MarketCandle[];
  /** Present when a provider failed and a fallback answered instead. */
  warning?: string;
}

export interface MarketProvider {
  readonly info: ProviderInfo;
  /** Historical bars, oldest first, exchange-clock seconds. */
  candles(request: CandleRequest): Promise<{ candles: MarketCandle[]; instrument: Instrument | null }>;
  /** Last traded price and the day's OHLC, for the live tail of the chart. */
  quotes(keys: string[]): Promise<MarketQuote[]>;
  /** Instrument search — powers the symbol picker. */
  search(query: string, limit: number): Promise<Instrument[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status = 502
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
