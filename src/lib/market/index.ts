import "server-only";

/**
 * Provider resolution.
 *
 * `MARKET_PROVIDER` pins one explicitly; the default (`auto`) walks the chain
 * below and uses the first one that is configured, falling back to the next on
 * failure. The synthetic feed is always last so the workspace is never a blank
 * screen — but it is flagged `live: false`, and the UI says so loudly.
 */

import { BridgeProvider } from "./providers/bridge";
import { KiteMcpProvider } from "./providers/kite-mcp";
import { KiteRestProvider } from "./providers/kite-rest";
import { SyntheticProvider } from "./providers/synthetic";
import { ProviderError, type MarketProvider, type ProviderId } from "./types";

export type ProviderMode = ProviderId | "auto";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function configuredMode(): ProviderMode {
  const raw = env("MARKET_PROVIDER")?.toLowerCase();
  switch (raw) {
    case "kite-mcp":
    case "mcp":
      return "kite-mcp";
    case "kite-rest":
    case "kite":
    case "rest":
      return "kite-rest";
    case "bridge":
      return "bridge";
    case "synthetic":
    case "mock":
      return "synthetic";
    default:
      return "auto";
  }
}

function build(id: ProviderId): MarketProvider | null {
  switch (id) {
    case "kite-mcp": {
      const url = env("KITE_MCP_URL");
      return url
        ? new KiteMcpProvider({
            url,
            token: env("KITE_MCP_TOKEN"),
            timeoutMs: Number(env("KITE_MCP_TIMEOUT_MS") ?? 20_000) || 20_000,
          })
        : null;
    }
    case "bridge": {
      const url = env("ZERODHA_BRIDGE_URL");
      return url ? new BridgeProvider({ baseUrl: url }) : null;
    }
    case "kite-rest": {
      const apiKey = env("KITE_API_KEY");
      const accessToken = env("KITE_ACCESS_TOKEN");
      return apiKey && accessToken
        ? new KiteRestProvider({ apiKey, accessToken, baseUrl: env("KITE_API_URL") })
        : null;
    }
    case "synthetic":
      return new SyntheticProvider();
    default:
      return null;
  }
}

/** Preference order when `MARKET_PROVIDER` is unset or `auto`. */
const AUTO_ORDER: ProviderId[] = ["kite-mcp", "bridge", "kite-rest"];

/**
 * The providers to try, in order. Always at least one entry.
 *
 * Set `MARKET_ALLOW_SYNTHETIC=0` to drop the synthetic tail, so a production
 * deployment fails loudly instead of quietly drawing invented prices.
 */
export function providerChain(mode: ProviderMode = configuredMode()): MarketProvider[] {
  const allowSynthetic = env("MARKET_ALLOW_SYNTHETIC") !== "0";
  const chain: MarketProvider[] = [];

  if (mode === "auto") {
    for (const id of AUTO_ORDER) {
      const provider = build(id);
      if (provider) chain.push(provider);
    }
  } else if (mode !== "synthetic") {
    const provider = build(mode);
    if (provider) chain.push(provider);
    else {
      throw new ProviderError(
        `MARKET_PROVIDER=${mode} but its environment variables are not set. ` +
          `See .env.example for the ones each provider needs.`,
        mode,
        500
      );
    }
  }

  if (mode === "synthetic" || (allowSynthetic && chain.length === 0) || (allowSynthetic && mode === "auto")) {
    chain.push(new SyntheticProvider());
  }
  if (chain.length === 0) {
    throw new ProviderError(
      "No market-data provider is configured and synthetic data is disabled. " +
        "Set KITE_MCP_URL, ZERODHA_BRIDGE_URL, or KITE_API_KEY + KITE_ACCESS_TOKEN.",
      "synthetic",
      500
    );
  }
  return chain;
}

/**
 * Run `attempt` against each provider in turn. Collects the failures so the
 * response can explain *why* it ended up on the fallback rather than just
 * quietly serving different numbers.
 */
export async function withFallback<T>(
  attempt: (provider: MarketProvider) => Promise<T>,
  mode?: ProviderMode
): Promise<{ value: T; provider: MarketProvider; warning?: string }> {
  const chain = providerChain(mode);
  const failures: string[] = [];

  for (const provider of chain) {
    try {
      const value = await attempt(provider);
      return {
        value,
        provider,
        warning: failures.length > 0 ? failures.join(" · ") : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${provider.info.label}: ${message}`);
    }
  }

  throw new ProviderError(
    failures.join(" · ") || "No provider could serve the request",
    chain[chain.length - 1].info.id,
    502
  );
}

export { ProviderError };
export type { MarketProvider };
