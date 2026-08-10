import "server-only";

/**
 * Kite Connect over MCP. §2.2 — the primary market-data path.
 *
 * Everything here goes through KiteMcpClient, which discovers tool names by
 * pattern and refuses order-shaped tools structurally. This module's own job is
 * translation: Kite's loosely-typed tool payloads into our contracts, and its
 * failure text into errors the route layer can map to a status code the UI can
 * act on.
 */

import { KiteMcpClient } from "../mcp/client";
import { makeCandle, aggregateDaily } from "../candles";
import { toKiteDateTime, toEpochSeconds } from "../time";
import {
  AuthRequiredError,
  HistoricalNotSubscribedError,
  KITE_INTERVAL,
  type CandleRequest,
  type ConnectionState,
  type Instrument,
  type Interval,
  type MarketCandle,
  type MarketProvider,
  type Quote,
} from "../types";

/** Zerodha's public endpoint — the value to use once MCP is opted into. */
export const DEFAULT_KITE_MCP_URL = "https://mcp.kite.trade/mcp";

/**
 * Whether MCP has been *deliberately* configured, as opposed to merely having
 * a sensible default available. `auto` keys off this: without the distinction
 * the default URL makes MCP look configured on a fresh clone, so `auto` picks
 * a provider that cannot authenticate and the app fails to draw anything
 * before you have even signed in.
 */
export const KITE_MCP_CONFIGURED = Boolean(process.env.KITE_MCP_URL?.trim());

export const KITE_MCP_URL = process.env.KITE_MCP_URL?.trim() || DEFAULT_KITE_MCP_URL;

/** Tool-name patterns, per §2.1 — never hardcode the exact names. */
const TOOL = {
  historical: /histor/i,
  quote: /quote|ltp/i,
  search: /search.*instrument|instrument.*search|search/i,
  login: /login|auth/i,
  profile: /profile/i,
} as const;

/**
 * Kite's historical response is JSON inside a text block, and its exact shape
 * has moved around. Accept the documented `[ts, o, h, l, c, v]` tuples and the
 * object form, and ignore anything that is neither.
 */
function parseCandlePayload(payload: unknown): MarketCandle[] {
  const rows = extractArray(payload);
  const out: MarketCandle[] = [];
  for (const row of rows) {
    if (Array.isArray(row) && row.length >= 5) {
      const [ts, o, h, l, c, v] = row as [string | number, number, number, number, number, number?];
      out.push(makeCandle(toEpochSeconds(ts), num(o), num(h), num(l), num(c), num(v ?? 0)));
      continue;
    }
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      const ts = r.date ?? r.timestamp ?? r.ts ?? r.time;
      if (ts === undefined) continue;
      out.push(
        makeCandle(
          toEpochSeconds(ts as string | number),
          num(r.open),
          num(r.high),
          num(r.low),
          num(r.close),
          num(r.volume ?? 0)
        )
      );
    }
  }
  return out.sort((a, b) => a.epochSeconds - b.epochSeconds);
}

/** Dig the first array out of a tool payload, wherever the server put it. */
function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  for (const key of ["candles", "data", "result", "records"]) {
    const v = p[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const nested = (v as Record<string, unknown>).candles;
      if (Array.isArray(nested)) return nested;
    }
  }
  return [];
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

/** Tool text is usually JSON; fall back to the raw text if it is not. */
function jsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class KiteMcpProvider implements MarketProvider {
  readonly info = { id: "kite-mcp" as const, label: "Kite Connect (MCP)", live: true };
  private readonly client: KiteMcpClient;

  constructor(serverUrl: string = KITE_MCP_URL) {
    this.client = new KiteMcpClient({ serverUrl });
  }

  /**
   * Connection state for the badge (§2.2). Must return something useful in
   * every case, including when nothing is configured — a panel that renders an
   * empty box when unconfigured is the single most common complaint.
   */
  async connectionState(): Promise<ConnectionState> {
    if (!KITE_MCP_URL) {
      return { status: "not-configured", detail: "KITE_MCP_URL is not set." };
    }
    try {
      const profileTool = await this.client.findTool(TOOL.profile);
      if (!profileTool) {
        return {
          status: "signed-out",
          detail: "Connected to the MCP server, but it exposes no profile tool.",
        };
      }
      const res = await this.client.callTool(profileTool.name, {});
      if (res.isError) {
        return { status: "signed-out", detail: res.text || "Not signed in to Kite." };
      }
      const parsed = jsonFromText(res.text) as Record<string, unknown>;
      const name =
        (parsed?.user_name as string) ?? (parsed?.user_id as string) ?? "Kite user";
      return { status: "signed-in", userName: name };
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return { status: "signed-out", detail: err.message };
      }
      return {
        status: "error",
        detail: err instanceof Error ? err.message : "Could not reach the Kite MCP server.",
      };
    }
  }

  /** Kick off sign-in and hand back the URL the user must open. */
  async loginUrl(): Promise<string | null> {
    const tool = await this.client.findTool(TOOL.login);
    if (!tool) return null;
    // Exempt: the login tool's own reply naturally contains "login" and would
    // otherwise trip the auth detector on the very call that fixes things.
    const res = await this.client.callTool(tool.name, {}, { exemptAuthDetection: true });
    const match = res.text.match(/https?:\/\/[^\s)\]]+/);
    return match ? match[0] : null;
  }

  async candles(req: CandleRequest): Promise<MarketCandle[]> {
    // 1W and 1M do not exist at Kite; fetch daily and fold (see candles.ts).
    const derived = req.interval === "1W" || req.interval === "1M";
    const fetchInterval: Interval = derived ? "1D" : req.interval;
    const kiteInterval = KITE_INTERVAL[fetchInterval];
    if (!kiteInterval) {
      throw new Error(`No Kite interval maps to ${req.interval}.`);
    }

    const tool = await this.client.findTool(TOOL.historical);
    if (!tool) {
      throw new Error("The Kite MCP server exposes no historical-data tool.");
    }

    const instrument = await this.resolve(req.symbol);
    const res = await this.client.callTool(tool.name, {
      instrument_token: instrument.instrumentToken,
      from_date: toKiteDateTime(req.from),
      to_date: toKiteDateTime(req.to),
      interval: kiteInterval,
    });

    if (res.isError) {
      // Being signed in is not the same as holding the historical-data
      // subscription; the raw failure is otherwise indistinguishable from
      // "no data for this symbol" (§2.3).
      if (/subscri|not authorised|not authorized|permission/i.test(res.text)) {
        throw new HistoricalNotSubscribedError(
          "This Kite API key is signed in but has no historical-data subscription, so candles cannot be fetched. " +
            "Add the historical data add-on in the Kite developer console."
        );
      }
      // Kite's generic "Failed to get historical data" carries no cause, and
      // by far the most common one is simply not being signed in. Check rather
      // than pass an unactionable sentence through to the user (§14).
      const state = await this.connectionState().catch(() => null);
      if (state && state.status !== "signed-in") {
        throw new AuthRequiredError(
          `Kite refused the historical request and this session is not signed in (${state.status}). Sign in to Kite and retry.`
        );
      }
      throw new Error(
        res.text
          ? `Kite could not return candles for ${req.symbol} at ${req.interval}: ${res.text}`
          : `Kite returned no candles for ${req.symbol} at ${req.interval} and gave no reason.`
      );
    }

    const parsed = parseCandlePayload(res.structured ?? jsonFromText(res.text));
    return derived ? aggregateDaily(parsed, req.interval as "1W" | "1M") : parsed;
  }

  async quote(symbols: string[]): Promise<Record<string, Quote>> {
    if (!symbols.length) return {};
    const tool = await this.client.findTool(TOOL.quote);
    if (!tool) throw new Error("The Kite MCP server exposes no quote tool.");

    const res = await this.client.callTool(tool.name, { instruments: symbols });
    if (res.isError) throw new Error(res.text || "Kite returned an error for the quote request.");

    const payload = (res.structured ?? jsonFromText(res.text)) as Record<string, unknown>;
    const at = Math.floor(Date.now() / 1000);
    const out: Record<string, Quote> = {};

    for (const symbol of symbols) {
      const row = (payload?.[symbol] ?? payload) as Record<string, unknown> | undefined;
      if (!row || typeof row !== "object") continue;
      const last = num(row.last_price ?? row.last ?? row.ltp);
      if (!last) continue;
      const prevClose = num(
        (row.ohlc as Record<string, unknown> | undefined)?.close ?? row.close ?? last
      );
      const change = last - prevClose;
      out[symbol] = {
        symbol,
        last,
        change,
        changePercent: prevClose ? (change / prevClose) * 100 : 0,
        volume: num(row.volume),
        at,
      };
    }
    return out;
  }

  async search(query: string): Promise<Instrument[]> {
    const tool = await this.client.findTool(TOOL.search);
    if (!tool) throw new Error("The Kite MCP server exposes no instrument-search tool.");

    const res = await this.client.callTool(tool.name, { query, limit: 25 });
    if (res.isError) throw new Error(res.text || "Kite returned an error for the search request.");

    const rows = extractArray(res.structured ?? jsonFromText(res.text));
    return rows
      .map((row): Instrument | null => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const exchange = String(r.exchange ?? "NSE");
        const tradingSymbol = String(r.tradingsymbol ?? r.trading_symbol ?? r.symbol ?? "");
        if (!tradingSymbol) return null;
        return {
          key: `${exchange}:${tradingSymbol}`,
          exchange,
          tradingSymbol,
          name: String(r.name ?? tradingSymbol),
          instrumentToken: r.instrument_token ? Number(r.instrument_token) : undefined,
          segment: r.segment ? String(r.segment) : undefined,
          lotSize: r.lot_size ? Number(r.lot_size) : undefined,
          tickSize: r.tick_size ? Number(r.tick_size) : undefined,
        };
      })
      .filter((i): i is Instrument => i !== null);
  }

  /** "NSE:INFY" -> an instrument carrying the token historical data needs. */
  private async resolve(symbol: string): Promise<Instrument> {
    const [, tradingSymbol] = symbol.includes(":") ? symbol.split(":") : ["NSE", symbol];
    const matches = await this.search(tradingSymbol);
    const exact =
      matches.find((m) => m.key.toUpperCase() === symbol.toUpperCase()) ??
      matches.find((m) => m.tradingSymbol.toUpperCase() === tradingSymbol.toUpperCase()) ??
      matches[0];
    if (!exact?.instrumentToken) {
      throw new Error(
        `Could not resolve ${symbol} to a Kite instrument token, so historical data cannot be requested.`
      );
    }
    return exact;
  }
}
