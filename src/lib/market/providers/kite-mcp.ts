import "server-only";

/**
 * Zerodha Kite MCP provider.
 *
 * Talks JSON-RPC over the MCP streamable-HTTP transport to whatever Kite MCP
 * endpoint `KITE_MCP_URL` points at — Zerodha's hosted server, or a local
 * bridge holding the session in `.kite-mcp-session.json`.
 *
 * Two deliberate design choices:
 *
 *  1. Tools are *discovered*, not hard-coded. `tools/list` is fetched once per
 *     session and the historical / quote / search tools are matched by name,
 *     with their argument names read off each tool's own JSON schema. Kite MCP
 *     has renamed arguments between releases; discovery means a rename is not
 *     an outage.
 *  2. Nothing here can trade. The call surface is limited to the three
 *     read-only tools below, and `assertReadOnly` refuses to invoke a tool
 *     whose name looks like an order path even if discovery selected one.
 */

import { fetchWithTimeout, parseHeaderEnv, truncate } from "../http";
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

const PROVIDER = "kite-mcp" as const;
const PROTOCOL_VERSION = "2025-06-18";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Any tool whose name matches this is refused, whatever discovery decided. */
const WRITE_PATTERN = /(place|modify|cancel|exit|square|order|gtt|basket|withdraw|fund)/i;

export interface KiteMcpOptions {
  url: string;
  token?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class KiteMcpProvider implements MarketProvider {
  readonly info: ProviderInfo;

  private sessionId: string | null = null;
  private nextId = 1;
  private toolsPromise: Promise<McpTool[]> | null = null;

  constructor(private readonly options: KiteMcpOptions) {
    this.info = {
      id: PROVIDER,
      label: "Zerodha Kite MCP",
      live: true,
      detail: options.url,
    };
  }

  // ------------------------------------------------------------ transport ---

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // The transport may answer either way; advertise both so it can choose.
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      ...parseHeaderEnv(process.env.KITE_MCP_HEADERS),
      ...(this.options.headers ?? {}),
    };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async rpc(method: string, params?: unknown, isNotification = false): Promise<unknown> {
    const body = isNotification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: this.nextId++, method, params };

    const response = await fetchWithTimeout(
      this.options.url,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        timeoutMs: this.options.timeoutMs,
      },
      PROVIDER
    );

    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;

    // A notification is answered with 202 and an empty body.
    if (isNotification || response.status === 202) {
      await response.text().catch(() => "");
      return null;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new ProviderError(
        `MCP ${method} failed: HTTP ${response.status} — ${truncate(text, 300)}`,
        PROVIDER,
        response.status === 401 || response.status === 403 ? 401 : 502
      );
    }

    const parsed = parseRpcBody(text);
    if (!parsed) {
      throw new ProviderError(`MCP ${method} returned no JSON-RPC payload`, PROVIDER);
    }
    if (parsed.error) {
      throw new ProviderError(
        `MCP ${method} error ${parsed.error.code}: ${parsed.error.message}`,
        PROVIDER,
        parsed.error.message.toLowerCase().includes("login") ? 401 : 502
      );
    }
    return parsed.result ?? null;
  }

  private async handshake(): Promise<void> {
    if (this.sessionId) return;
    await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "indiacharts-wave-lab", version: "1.0.0" },
    });
    // Servers that key state off the session id expect this before any call.
    await this.rpc("notifications/initialized", {}, true).catch(() => null);
  }

  private tools(): Promise<McpTool[]> {
    if (!this.toolsPromise) {
      this.toolsPromise = (async () => {
        await this.handshake();
        const result = await this.rpc("tools/list", {});
        const list = (result as { tools?: unknown })?.tools;
        return Array.isArray(list) ? (list as McpTool[]) : [];
      })().catch((error: unknown) => {
        // Never cache a failure — a login completed in another tab should be
        // picked up by the next request rather than needing a restart.
        this.toolsPromise = null;
        throw error;
      });
    }
    return this.toolsPromise;
  }

  private async pickTool(match: RegExp, purpose: string): Promise<McpTool> {
    const tools = await this.tools();
    const found = tools.find((tool) => match.test(tool.name));
    if (!found) {
      const names = tools.map((t) => t.name).join(", ") || "none";
      throw new ProviderError(
        `Kite MCP exposes no ${purpose} tool. Tools seen: ${names}`,
        PROVIDER,
        501
      );
    }
    assertReadOnly(found.name);
    return found;
  }

  private async call(tool: McpTool, args: Record<string, unknown>): Promise<unknown> {
    assertReadOnly(tool.name);
    await this.handshake();
    const result = await this.rpc("tools/call", { name: tool.name, arguments: args });
    return extractToolPayload(result, tool.name);
  }

  // ------------------------------------------------------------- provider ---

  async candles(request: CandleRequest): Promise<{
    candles: MarketCandle[];
    instrument: Instrument | null;
  }> {
    const instrument = request.instrumentToken
      ? null
      : await this.resolve(request.key).catch(() => null);
    const token = request.instrumentToken ?? instrument?.instrumentToken;

    const tool = await this.pickTool(/historical|candle/i, "historical-data");
    const props = tool.inputSchema?.properties ?? {};
    const [exchange, symbol] = splitKey(request.key);

    const args: Record<string, unknown> = {};
    if (token !== undefined) args[pick(props, ["instrument_token", "instrumentToken", "token"])] = token;
    // Newer builds take exchange + tradingsymbol instead of a raw token; send
    // both when the schema has room for them and let the server pick.
    if (has(props, ["tradingsymbol", "trading_symbol", "symbol"])) {
      args[pick(props, ["tradingsymbol", "trading_symbol", "symbol"])] = symbol;
    }
    if (has(props, ["exchange"])) args.exchange = exchange;
    args[pick(props, ["interval", "timeframe", "resolution"])] = nativeInterval(request.interval);
    args[pick(props, ["from_date", "from", "start_date", "start"])] = request.from;
    args[pick(props, ["to_date", "to", "end_date", "end"])] = request.to;
    if (request.continuous && has(props, ["continuous"])) args.continuous = true;
    if (request.oi && has(props, ["oi"])) args.oi = true;

    const payload = await this.call(tool, args);
    const candles = toCandles(payload);
    if (candles.length === 0) {
      throw new ProviderError(
        `Kite MCP returned no candles for ${request.key} ${request.interval} ` +
          `(${request.from} → ${request.to}). ${truncate(JSON.stringify(payload ?? null), 200)}`,
        PROVIDER,
        404
      );
    }
    return { candles, instrument };
  }

  async quotes(keys: string[]): Promise<MarketQuote[]> {
    if (keys.length === 0) return [];
    const tool = await this.pickTool(/quote|ltp|ohlc/i, "quote");
    const props = tool.inputSchema?.properties ?? {};
    const key = pick(props, ["instruments", "symbols", "i", "instrument", "tradingsymbols"]);
    // Some schemas want a list, some a comma-joined string. A single-element
    // array is the shape both tolerate least badly, so branch on the schema.
    const wantsArray = schemaType(props[key]) === "array";
    const payload = await this.call(tool, { [key]: wantsArray ? keys : keys.join(",") });
    return toQuotes(payload, keys);
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    const tool = await this.pickTool(/search.*instrument|instrument.*search|search_symbols/i, "search");
    const props = tool.inputSchema?.properties ?? {};
    const args: Record<string, unknown> = {
      [pick(props, ["query", "q", "search", "name", "keyword"])]: query,
    };
    if (has(props, ["limit", "count"])) args[pick(props, ["limit", "count"])] = limit;
    if (has(props, ["exchange"]) && /^[A-Z]+:/.test(query)) args.exchange = splitKey(query)[0];

    const payload = await this.call(tool, args);
    return toInstruments(payload).slice(0, limit);
  }

  /** Resolve `NSE:INFY` to a full instrument so we have a token for candles. */
  private async resolve(key: string): Promise<Instrument | null> {
    const [exchange, symbol] = splitKey(key);
    const matches = await this.search(symbol, 20);
    return (
      matches.find((i) => i.exchange === exchange && i.tradingSymbol === symbol) ??
      matches.find((i) => i.tradingSymbol === symbol) ??
      matches[0] ??
      null
    );
  }
}

// ----------------------------------------------------------------- helpers ---

function assertReadOnly(name: string): void {
  if (WRITE_PATTERN.test(name)) {
    throw new ProviderError(
      `Refusing to call MCP tool "${name}" — the Wave Lab is read-only and never places orders.`,
      PROVIDER,
      403
    );
  }
}

/**
 * The transport answers with either a bare JSON-RPC object or an SSE stream of
 * `data:` lines. Take the last complete JSON-RPC frame either way.
 */
function parseRpcBody(text: string): JsonRpcResponse | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcResponse[];
      return Array.isArray(parsed) ? (parsed[parsed.length - 1] ?? null) : parsed;
    } catch {
      /* fall through to the SSE reader */
    }
  }

  let last: JsonRpcResponse | null = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) last = parsed;
    } catch {
      /* keep scanning — heartbeats and comments are normal on SSE */
    }
  }
  return last;
}

/**
 * MCP tool results carry the useful data in `structuredContent`, or in a text
 * block that happens to contain JSON. Prefer the former and fall back.
 */
function extractToolPayload(result: unknown, toolName: string): unknown {
  const record = result as
    | { content?: unknown; structuredContent?: unknown; isError?: boolean }
    | null
    | undefined;
  if (!record) return null;

  if (record.isError) {
    throw new ProviderError(`MCP tool ${toolName} reported an error: ${textOf(record.content)}`, PROVIDER);
  }
  if (record.structuredContent !== undefined && record.structuredContent !== null) {
    return unwrapSingleKey(record.structuredContent);
  }

  const text = textOf(record.content);
  if (text === "") return record.content ?? null;

  const needsLogin = /login|authenticate|session (has )?expired|unauthori[sz]ed/i.test(text);
  try {
    return unwrapSingleKey(JSON.parse(text) as unknown);
  } catch {
    if (needsLogin) {
      throw new ProviderError(
        `Kite MCP needs a login before it will return data: ${truncate(text, 200)}`,
        PROVIDER,
        401
      );
    }
    return text;
  }
}

/** `{ result: {...} }` / `{ data: {...} }` wrappers add nothing — peel one. */
function unwrapSingleKey(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1 && ["result", "data", "output", "response"].includes(entries[0][0])) {
    return entries[0][1];
  }
  return value;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = block as { type?: string; text?: string } | null;
      return record && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function pick(props: Record<string, unknown>, candidates: string[]): string {
  return candidates.find((name) => name in props) ?? candidates[0];
}

function has(props: Record<string, unknown>, candidates: string[]): boolean {
  return candidates.some((name) => name in props);
}

function schemaType(schema: unknown): string | undefined {
  const record = schema as { type?: unknown } | null;
  return typeof record?.type === "string" ? record.type : undefined;
}

function splitKey(key: string): [string, string] {
  const index = key.indexOf(":");
  return index === -1 ? ["NSE", key] : [key.slice(0, index), key.slice(index + 1)];
}

/**
 * Week and month bars are aggregated by us from daily, so ask the broker for
 * the interval it actually serves.
 */
function nativeInterval(interval: string): string {
  return interval === "week" || interval === "month" ? "day" : interval;
}
