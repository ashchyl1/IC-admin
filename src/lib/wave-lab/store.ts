import "server-only";

import { mergeCandles, isFresh, sliceRange } from "./candles";
import type { Interval, MarketCandle } from "./types";

/**
 * Server-side candle cache. §2.6.
 *
 * Parked on `globalThis` for the same reason the MCP session is (§12.7):
 * module-level state does not survive Next's per-route compilation, and a
 * cache that empties on every request is worse than none — it adds a lookup
 * and still burns the rate limit.
 *
 * Deliberately in-process rather than in Postgres. The job here is to stop a
 * chart pan turning into a Kite request, which is a within-session concern; a
 * durable store is a later upgrade and `CandleStore` is the seam for it. What
 * matters now is the rule enforced in `put`: **synthetic bars never enter this
 * cache**, so a synthetic price cannot leak into a dataset someone later
 * trusts (§2.4, §14).
 */

export interface CacheEntry {
  candles: MarketCandle[];
  fetchedAtSeconds: number;
  providerId: string;
}

export interface CachedRead {
  candles: MarketCandle[];
  fresh: boolean;
  fetchedAtSeconds: number;
  providerId: string;
}

const CACHE_KEY = Symbol.for("wave-lab.candle-cache");
type Cache = Map<string, CacheEntry>;

function cache(): Cache {
  const g = globalThis as unknown as Record<symbol, Cache | undefined>;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY]!;
}

function keyOf(symbol: string, interval: Interval): string {
  return `${symbol.toUpperCase()}|${interval}`;
}

export const CandleStore = {
  /** Everything cached for this series, with a freshness verdict. */
  read(symbol: string, interval: Interval, now = Date.now() / 1000): CachedRead | null {
    const entry = cache().get(keyOf(symbol, interval));
    if (!entry) return null;
    return {
      candles: entry.candles,
      fresh: isFresh(entry.fetchedAtSeconds, interval, now),
      fetchedAtSeconds: entry.fetchedAtSeconds,
      providerId: entry.providerId,
    };
  },

  /** Just the window the caller asked for. */
  readRange(
    symbol: string,
    interval: Interval,
    fromSec: number,
    toSec: number,
    now = Date.now() / 1000
  ): CachedRead | null {
    const all = this.read(symbol, interval, now);
    if (!all) return null;
    return { ...all, candles: sliceRange(all.candles, fromSec, toSec) };
  },

  /**
   * Merge fresh bars in. Returns the merged series.
   *
   * Refuses synthetic data outright rather than trusting callers to remember —
   * a synthetic bar that reaches a real dataset is a bug found months later on
   * a chart you had no reason to doubt.
   */
  put(
    symbol: string,
    interval: Interval,
    candles: MarketCandle[],
    providerId: string,
    now = Date.now() / 1000
  ): MarketCandle[] {
    if (providerId === "synthetic") {
      throw new Error("Refusing to cache synthetic candles: they must never enter a shared store.");
    }
    const key = keyOf(symbol, interval);
    const existing = cache().get(key);
    const merged = mergeCandles(existing?.candles ?? [], candles);
    cache().set(key, { candles: merged, fetchedAtSeconds: now, providerId });
    return merged;
  },

  clear(): void {
    cache().clear();
  },

  get size(): number {
    return cache().size;
  },
};
