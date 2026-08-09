/**
 * In-browser market client.
 *
 * Serves the same `MarketClient` interface from the synthetic generator, with
 * no server involved. Used by the standalone build of the workspace, which is
 * a single HTML file and cannot call an API.
 *
 * Every response reports `live: false`, so the workspace's simulated-data
 * ribbon and the per-terminal badge behave exactly as they do when the server
 * falls back to synthetic data. Nothing here is a market price.
 */

import { aggregateCandles } from "./normalize";
import { searchDemoSymbols, syntheticCandles } from "./synthetic-series";
import type { MarketClient } from "./client";
import { INTERVALS, type ProviderInfo } from "./types";

const PROVIDER: ProviderInfo = {
  id: "synthetic",
  label: "Simulated data",
  live: false,
  detail: "Standalone demo — Elliott-shaped synthetic series, generated in your browser",
};

export const offlineMarketClient: MarketClient = {
  async candles({ symbol, interval, days }) {
    const spec = INTERVALS[interval];
    const bars = Math.round(
      spec.minutes >= 375 ? days * (5 / 7) : ((days * (5 / 7)) * 375) / spec.minutes
    );
    return {
      candles: aggregateCandles(syntheticCandles(symbol, interval, bars), interval),
      provider: PROVIDER,
    };
  },

  async quotes(symbols) {
    // Nudge the last price a little each poll so the live tail visibly moves,
    // without wandering away from the generated series it belongs to.
    return symbols.map((key) => {
      const series = syntheticCandles(key, "day", 260);
      const last = series[series.length - 1];
      const drift = Math.sin(Date.now() / 20_000) * (last.close * 0.0008);
      return { key, last: Math.round((last.close + drift) * 100) / 100 };
    });
  },

  async search(query, limit) {
    return searchDemoSymbols(query, limit);
  },
};
