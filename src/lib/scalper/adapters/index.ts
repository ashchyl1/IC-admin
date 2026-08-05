/**
 * Adapter factory — the single line to change when going live.
 *
 * `NEXT_PUBLIC_SCALPER_FEED=kite` switches the workspace onto the Kite adapter.
 * It is deliberately opt-in and defaults to the mock feed, so a stray env var
 * cannot silently point a paper-trading UI at a real data subscription.
 */

import { MockAdapter } from "./mock";
import { KiteAdapter } from "./kite";
import type { MarketDataAdapter } from "./types";

export type FeedKind = "mock" | "kite";

export function createAdapter(kind: FeedKind = resolveFeedKind()): MarketDataAdapter {
  switch (kind) {
    case "kite":
      return new KiteAdapter({
        socketUrl: process.env.NEXT_PUBLIC_KITE_SOCKET_URL ?? "ws://localhost:4010",
        restUrl: process.env.NEXT_PUBLIC_KITE_REST_URL ?? "https://api.kite.trade",
      });
    case "mock":
    default:
      return new MockAdapter();
  }
}

function resolveFeedKind(): FeedKind {
  return process.env.NEXT_PUBLIC_SCALPER_FEED === "kite" ? "kite" : "mock";
}

export { MockAdapter, KiteAdapter };
export type { MarketDataAdapter, AdapterSnapshot, AdapterSelection } from "./types";
