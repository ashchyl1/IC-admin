import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KiteMcpProvider } from "@/lib/market/providers/kite-mcp";
import { ProviderError } from "@/lib/market/types";

/**
 * The Kite MCP provider, driven against `scripts/mock-kite-mcp.mjs`.
 *
 * The mock speaks the real streamable-HTTP transport — session ids, SSE
 * framing, Kite's tool names and schemas, Kite's response shapes, and the
 * signed-out refusal — so this exercises the parts of the integration that a
 * type check cannot: the handshake, tool discovery, argument mapping, the
 * `+0530` timestamps, and the login flow.
 *
 * It cannot prove Zerodha's live tool names. It does prove that when they
 * change, discovery is what adapts.
 */

const PORT = 4177;
const URL = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

beforeAll(async () => {
  server = spawn("node", ["scripts/mock-kite-mcp.mjs", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock MCP did not start")), 10_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("mock kite mcp")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("error", reject);
  });
}, 20_000);

afterAll(() => {
  server?.kill();
});

function provider(): KiteMcpProvider {
  return new KiteMcpProvider({ url: URL });
}

describe("Kite MCP transport", () => {
  it("handshakes and discovers the tools the server advertises", async () => {
    const diagnostics = await provider().diagnostics();

    expect(diagnostics.discovered).toEqual(
      expect.arrayContaining(["login", "get_historical_data", "get_quotes", "search_instruments"])
    );
    expect(diagnostics.resolved).toMatchObject({
      historical: "get_historical_data",
      quotes: "get_quotes",
      search: "search_instruments",
      login: "login",
    });
  });

  it("reports a signed-out session as needing a login, not as a generic failure", async () => {
    const diagnostics = await provider().diagnostics();
    expect(diagnostics.ready).toBe(false);
    expect(diagnostics.needsLogin).toBe(true);
  });

  it("returns the sign-in URL from the login tool", async () => {
    const challenge = await provider().login();
    expect(challenge.url).toMatch(/^https:\/\/kite\.zerodha\.com\/connect\/login/);
  });
});

describe("Kite MCP data, once authorised", () => {
  // One instance throughout: the authorised session lives on it, which is
  // exactly why `market/index.ts` caches providers per endpoint.
  const kite = provider();

  beforeAll(async () => {
    await kite.login();
  });

  it("is ready after signing in", async () => {
    const diagnostics = await kite.diagnostics();
    expect(diagnostics.ready).toBe(true);
    expect(diagnostics.needsLogin).toBe(false);
  });

  it("resolves a symbol to its instrument token and fetches candles", async () => {
    const { candles, instrument } = await kite.candles({
      key: "NSE:NIFTY 50",
      interval: "day",
      from: "2026-06-01",
      to: "2026-07-01",
    });

    expect(instrument?.instrumentToken).toBe(256265);
    expect(candles.length).toBeGreaterThan(15);
    for (const candle of candles) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.low);
      expect(Number.isFinite(candle.close)).toBe(true);
    }
  });

  it("places daily bars on IST midnight, not five and a half hours off", async () => {
    const { candles } = await kite.candles({
      key: "NSE:NIFTY 50",
      interval: "day",
      from: "2026-06-01",
      to: "2026-06-15",
    });
    // Chart time is exchange-shifted, so a daily bar reads as 00:00 on the axis.
    for (const candle of candles.slice(0, 5)) {
      expect(new Date(candle.time * 1000).toISOString()).toMatch(/T00:00:00/);
    }
  });

  it("keeps candles in ascending order with no duplicate timestamps", async () => {
    const { candles } = await kite.candles({
      key: "NSE:INFY",
      interval: "day",
      from: "2026-05-01",
      to: "2026-07-01",
    });
    const times = candles.map((candle) => candle.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it("reads Kite's quote shape, including the nested ohlc block", async () => {
    const [quote] = await kite.quotes(["NSE:NIFTY 50"]);
    expect(quote.key).toBe("NSE:NIFTY 50");
    expect(quote.last).toBeCloseTo(21_345.6, 1);
    expect(quote.prevClose).toBe(21_280);
    expect(quote.changePct).toBeCloseTo(0.308, 2);
  });

  it("searches the instrument master", async () => {
    const results = await kite.search("INFY", 5);
    expect(results[0]).toMatchObject({ tradingSymbol: "INFY", instrumentToken: 408065, key: "NSE:INFY" });
  });
});

describe("read-only guard", () => {
  it("refuses to call an order tool even though the server exposes one", async () => {
    const kite = provider();
    await kite.login();

    // Reach past the private API deliberately: the guard has to hold at the
    // call site, not only in the tool-picking regexes.
    const call = (kite as unknown as {
      call(tool: { name: string }, args: Record<string, unknown>): Promise<unknown>;
    }).call({ name: "place_order" }, { tradingsymbol: "INFY" });

    await expect(call).rejects.toThrow(/read-only|never places orders/i);
    await expect(call).rejects.toBeInstanceOf(ProviderError);
  });

  it("never selects an order tool for a data job", async () => {
    const diagnostics = await provider().diagnostics();
    for (const tool of Object.values(diagnostics.resolved ?? {})) {
      expect(tool ?? "").not.toMatch(/order/i);
    }
  });
});
