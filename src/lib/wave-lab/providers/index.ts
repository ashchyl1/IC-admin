import "server-only";

/**
 * Provider selection and the cache-aware candle resolver. §2.4 and §2.6.
 *
 * `MARKET_PROVIDER` picks the implementation:
 *   auto      — Kite MCP when a URL is configured, otherwise synthetic
 *   kite-mcp  — force MCP
 *   synthetic — force generated bars (never cached, always labelled)
 *
 * kite-rest is declared in the union but not yet implemented; `resolveProvider`
 * says so in words rather than silently falling back, because a silent
 * downgrade to synthetic is exactly how fake prices end up on a chart someone
 * trusts.
 */

import { CandleStore } from "../store";
import { sliceRange } from "../candles";
import { KITE_MCP_CONFIGURED, KiteMcpProvider } from "./kite-mcp";
import { SyntheticProvider } from "./synthetic";
import type { CandleRequest, MarketCandle, MarketProvider } from "../types";

export type ProviderKind = "auto" | "kite-mcp" | "kite-rest" | "synthetic";

export function configuredKind(): ProviderKind {
  const raw = (process.env.MARKET_PROVIDER ?? "auto").toLowerCase();
  return (["auto", "kite-mcp", "kite-rest", "synthetic"] as const).includes(raw as ProviderKind)
    ? (raw as ProviderKind)
    : "auto";
}

export function resolveProvider(kind: ProviderKind = configuredKind()): MarketProvider {
  switch (kind) {
    case "synthetic":
      return new SyntheticProvider();
    case "kite-mcp":
      return new KiteMcpProvider();
    case "kite-rest":
      throw new Error(
        "MARKET_PROVIDER=kite-rest is not implemented yet. Use kite-mcp, or synthetic for development."
      );
    case "auto":
    default:
      // Only when KITE_MCP_URL was set on purpose — see KITE_MCP_CONFIGURED.
      return KITE_MCP_CONFIGURED ? new KiteMcpProvider() : new SyntheticProvider();
  }
}

/** What the candles route returns, including why the data looks how it does. */
export interface CandleResolution {
  candles: MarketCandle[];
  providerId: string;
  providerLabel: string;
  live: boolean;
  /** True when the broker could not be reached and this is cached data. */
  stale: boolean;
  /** A sentence for the UI banner. Null when everything is normal. */
  warning: string | null;
  fetchedAtSeconds: number;
}

/**
 * Resolve candles in the order §2.6 prescribes:
 *
 *   1. fresh cache      -> serve at once, no broker call
 *   2. broker           -> fetch, merge into cache, serve
 *   3. broker unreachable -> serve stale cache WITH a warning
 *
 * Step 3 is the one that matters: a stale chart with a warning beats a blank
 * one, and a stale chart without a warning is worse than either.
 */
export async function resolveCandles(
  req: CandleRequest,
  provider: MarketProvider = resolveProvider()
): Promise<CandleResolution> {
  const nowSec = Date.now() / 1000;
  const fromSec = Math.floor(req.from.getTime() / 1000);
  const toSec = Math.floor(req.to.getTime() / 1000);

  const base = {
    providerId: provider.info.id,
    providerLabel: provider.info.label,
    live: provider.info.live,
  };

  // Synthetic never touches the cache, in either direction.
  if (!provider.info.live) {
    return {
      ...base,
      candles: await provider.candles(req),
      stale: false,
      warning: `Showing synthetic data from ${provider.info.label} — these prices are generated, not real.`,
      fetchedAtSeconds: nowSec,
    };
  }

  const cached = CandleStore.read(req.symbol, req.interval, nowSec);
  if (cached?.fresh) {
    return {
      ...base,
      candles: sliceRange(cached.candles, fromSec, toSec),
      stale: false,
      warning: null,
      fetchedAtSeconds: cached.fetchedAtSeconds,
    };
  }

  try {
    const fetched = await provider.candles(req);
    const merged = CandleStore.put(req.symbol, req.interval, fetched, provider.info.id, nowSec);
    return {
      ...base,
      candles: sliceRange(merged, fromSec, toSec),
      stale: false,
      warning: null,
      fetchedAtSeconds: nowSec,
    };
  } catch (err) {
    // No cache to fall back on: the caller has to see the real failure.
    if (!cached) throw err;

    const age = Math.round((nowSec - cached.fetchedAtSeconds) / 60);
    const reason = err instanceof Error ? err.message : "the broker could not be reached";
    return {
      ...base,
      candles: sliceRange(cached.candles, fromSec, toSec),
      stale: true,
      warning: `Showing cached data from ${age} minute${age === 1 ? "" : "s"} ago — ${reason}`,
      fetchedAtSeconds: cached.fetchedAtSeconds,
    };
  }
}

export { KiteMcpProvider, SyntheticProvider };
