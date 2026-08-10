import "server-only";

/**
 * Local Zerodha bridge provider.
 *
 * For the FastAPI service in `zerodha-integration/backend` (or any small
 * service you put in front of Kite). It keeps the API secret off this app
 * entirely: this process only ever sees candles.
 *
 * Expected contract — three GET endpoints returning JSON:
 *
 *   GET {base}/candles?symbol=NSE:INFY&interval=day&from=2024-01-01&to=2024-06-01
 *       -> { candles: [[ts,o,h,l,c,v], …] }  or  { candles: [{date,open,…}, …] }
 *   GET {base}/quote?symbols=NSE:INFY,NSE:TCS
 *       -> { data: { "NSE:INFY": { last_price, ohlc: {…} } } }
 *   GET {base}/instruments/search?q=infy&limit=20
 *       -> { instruments: [{ instrument_token, tradingsymbol, exchange, … }] }
 *
 * Every one of those shapes goes through the tolerant parsers in
 * `../normalize`, so near-misses (a `data` wrapper, epoch seconds instead of
 * ISO) still work.
 */

import { fetchWithTimeout, parseHeaderEnv, readJson } from "../http";
import { toCandles, toInstruments, toQuotes } from "../normalize";
import {
  ProviderError,
  type CandleRequest,
  type Instrument,
  type MarketCandle,
  type MarketProvider,
  type MarketQuote,
  type ProviderInfo,
} from "../types";

const PROVIDER = "bridge" as const;

export interface BridgeOptions {
  baseUrl: string;
  headers?: Record<string, string>;
}

export class BridgeProvider implements MarketProvider {
  readonly info: ProviderInfo;
  private readonly baseUrl: string;

  constructor(private readonly options: BridgeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.info = { id: PROVIDER, label: "Zerodha bridge", live: true, detail: this.baseUrl };
  }

  private get(path: string): Promise<unknown> {
    return fetchWithTimeout(
      `${this.baseUrl}${path}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...parseHeaderEnv(process.env.ZERODHA_BRIDGE_HEADERS),
          ...(this.options.headers ?? {}),
        },
      },
      PROVIDER
    ).then((response) => readJson(response, PROVIDER));
  }

  async candles(request: CandleRequest): Promise<{
    candles: MarketCandle[];
    instrument: Instrument | null;
  }> {
    const params = new URLSearchParams({
      symbol: request.key,
      interval: request.interval === "week" || request.interval === "month" ? "day" : request.interval,
      from: request.from,
      to: request.to,
    });
    if (request.instrumentToken) params.set("instrument_token", String(request.instrumentToken));
    if (request.continuous) params.set("continuous", "1");
    if (request.oi) params.set("oi", "1");

    const payload = await this.get(`/candles?${params.toString()}`);
    const candles = toCandles(payload);
    if (candles.length === 0) {
      throw new ProviderError(`Bridge returned no candles for ${request.key}`, PROVIDER, 404);
    }
    return { candles, instrument: null };
  }

  async quotes(keys: string[]): Promise<MarketQuote[]> {
    if (keys.length === 0) return [];
    const payload = await this.get(`/quote?symbols=${encodeURIComponent(keys.join(","))}`);
    return toQuotes(payload, keys);
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    const payload = await this.get(
      `/instruments/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    return toInstruments(payload).slice(0, limit);
  }
}
