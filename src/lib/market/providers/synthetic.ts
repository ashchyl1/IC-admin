import "server-only";

/**
 * Offline fallback provider.
 *
 * Exists so the Wave Lab is usable — and demonstrable — with no broker
 * credentials at all. The series itself comes from `../synthetic-series`, which
 * is client-safe because the standalone build of the workspace needs the same
 * generator with no server behind it.
 *
 * Every response is flagged `live: false` and the workspace shows a
 * simulated-data ribbon. These prices must never be mistaken for the market.
 */

import { aggregateCandles } from "../normalize";
import {
  DEMO_SYMBOLS,
  barsForRange,
  profileFor,
  searchDemoSymbols,
  syntheticCandles,
} from "../synthetic-series";
import {
  INTERVALS,
  type CandleRequest,
  type Instrument,
  type MarketCandle,
  type MarketProvider,
  type MarketQuote,
  type ProviderInfo,
} from "../types";

export class SyntheticProvider implements MarketProvider {
  readonly info: ProviderInfo = {
    id: "synthetic",
    label: "Simulated data",
    live: false,
    detail: "No broker configured — Elliott-shaped synthetic series",
  };

  async candles(request: CandleRequest): Promise<{
    candles: MarketCandle[];
    instrument: Instrument | null;
  }> {
    const bars = barsForRange(request.from, request.to, INTERVALS[request.interval].minutes);
    const series = syntheticCandles(request.key, request.interval, bars);
    return {
      candles: aggregateCandles(series, request.interval),
      instrument: DEMO_SYMBOLS.find((row) => row.key === request.key) ?? null,
    };
  }

  async quotes(keys: string[]): Promise<MarketQuote[]> {
    return keys.map((key) => {
      const series = syntheticCandles(key, "day", 260);
      const last = series[series.length - 1];
      const prev = series[series.length - 2] ?? last;
      return {
        key,
        last: last.close,
        open: last.open,
        high: last.high,
        low: last.low,
        prevClose: prev.close,
        change: last.close - prev.close,
        changePct: ((last.close - prev.close) / prev.close) * 100,
        volume: last.volume,
        oi: null,
        ts: Date.now(),
      };
    });
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    return searchDemoSymbols(query, limit);
  }
}

export { profileFor };
