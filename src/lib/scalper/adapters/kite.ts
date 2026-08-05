/**
 * Kite adapter — the live-feed seam, deliberately left unwired.
 *
 * Everything the workspace needs from a broker is listed below with the exact
 * Kite Connect call that supplies it. Fill the five marked sections in and
 * change `createAdapter` to return this class; no component, indicator or
 * engine file has to change.
 *
 * IMPORTANT: this file must never place an order. The paper engine is the only
 * execution path in this app, and it is simulated by construction. Wiring
 * `kc.placeOrder` here would make every keyboard shortcut a live trade.
 */

import { CHAIN_DEPTH, UNDERLYINGS } from "../config";
import { aggregate } from "../indicators";
import type {
  Candle,
  ConnectionState,
  OptionContract,
  OptionQuote,
  OptionType,
  Timeframe,
  Underlying,
} from "../types";
import type { AdapterSelection, AdapterSnapshot, MarketDataAdapter } from "./types";

export interface KiteAdapterOptions {
  /**
   * Where the browser gets ticks from. Two shapes work:
   *
   *  - `ws://localhost:PORT` — a small server-side process holds the Kite
   *    `KiteTicker` connection and rebroadcasts ticks. Preferred: the API
   *    secret and access token never reach the browser.
   *  - a Kite MCP bridge endpoint, if you are driving quotes through the MCP
   *    session already saved in `.kite-mcp-session.json`.
   */
  socketUrl: string;
  /** REST base for historical candles and the instrument dump. */
  restUrl: string;
  /** Reconnect backoff ceiling. */
  maxBackoffMs?: number;
}

export class KiteAdapter implements MarketDataAdapter {
  readonly id = "kite";
  readonly label = "Kite Connect";
  readonly isLive = true;

  private socket: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private latest: AdapterSnapshot | null = null;
  private readonly listeners = new Set<(snapshot: AdapterSnapshot) => void>();
  private selection: AdapterSelection = { underlying: "NIFTY", expiry: "", centreStrike: null };

  /** instrument_token -> our contract, built from the instruments dump. */
  private readonly tokenMap = new Map<number, OptionContract>();
  /** 1-minute history per instrument, seeded from REST then extended by ticks. */
  private readonly candles = new Map<string, Candle[]>();

  constructor(private readonly options: KiteAdapterOptions) {}

  async connect(): Promise<void> {
    this.state = "connecting";

    // ---------------------------------------------------------------- 1 ---
    // Instrument master. `GET /instruments/NFO` returns a CSV of every F&O
    // contract: instrument_token, tradingsymbol, expiry, strike, instrument_type
    // (CE/PE), lot_size. Parse it once per session and populate `tokenMap`, then
    // `contractFor` becomes a lookup instead of the string-building the mock
    // adapter does.
    //
    //   const csv = await fetch(`${this.options.restUrl}/instruments/NFO`).then(r => r.text());
    //   for (const row of parseCsv(csv)) { ... this.tokenMap.set(row.instrument_token, contract) }

    // ---------------------------------------------------------------- 2 ---
    // Historical seed. Charts need bars that predate the connection, and the
    // WebSocket only sends what happens from now on. For each of the index and
    // the two selected legs:
    //
    //   GET /instruments/historical/:token/minute?from=...&to=...
    //
    // Map the response into `Candle` and store under the contract symbol via
    // `toChartTime(new Date(row[0]).getTime())` so the axis reads IST.

    // ---------------------------------------------------------------- 3 ---
    // Streaming. Open the socket, subscribe the tokens in `full` mode (`ltp`
    // mode omits depth, and the order cards need bid/ask), then translate each
    // tick into a chain update.
    //
    //   this.socket = new WebSocket(this.options.socketUrl);
    //   this.socket.onmessage = (event) => this.onTicks(JSON.parse(event.data));
    //
    // A Kite `full` tick carries last_price, volume_traded, oi, and a five-level
    // depth book: depth.buy[0].price is the bid, depth.sell[0].price the ask.
    // That is exactly what `OptionQuote` wants.

    // ---------------------------------------------------------------- 4 ---
    // Resubscription. `select()` fires when the user changes underlying, expiry
    // or strike. Send `{"a":"unsubscribe","v":[...old]}` then
    // `{"a":"subscribe","v":[...new]}` plus a `mode` message. Keep the index
    // token subscribed across all changes.

    // ---------------------------------------------------------------- 5 ---
    // Liveness. Set `this.state = "stale"` when no tick has arrived for longer
    // than `RiskSettings.staleAfterMs`; the header badge and the order guard
    // both read `connectionState()`. Reconnect with exponential backoff up to
    // `maxBackoffMs`, and re-seed history after a reconnect rather than
    // assuming the gap was empty.

    throw new Error(
      "KiteAdapter is a stub. Implement the five sections in adapters/kite.ts, " +
        "then return it from createAdapter()."
    );
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.state = "disconnected";
  }

  connectionState(): ConnectionState {
    return this.state;
  }

  select(selection: AdapterSelection): void {
    this.selection = { ...selection };
    // See section 4 above.
  }

  onSnapshot(listener: (snapshot: AdapterSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): AdapterSnapshot | null {
    return this.latest;
  }

  spotCandles(underlying: Underlying, timeframe: Timeframe): Candle[] {
    const base = this.candles.get(UNDERLYINGS[underlying].feedSymbol) ?? [];
    return timeframe === "1m" ? base : aggregate(base, timeframe, this.sessionOpenSeconds(underlying));
  }

  optionCandles(contract: OptionContract, timeframe: Timeframe): Candle[] {
    const base = this.candles.get(contract.symbol) ?? [];
    return timeframe === "1m"
      ? base
      : aggregate(base, timeframe, this.sessionOpenSeconds(contract.underlying));
  }

  sessionOpenSeconds(_underlying: Underlying): number {
    // Same computation as the mock adapter: toChartTime(sessionOpenMs(Date.now())).
    return 0;
  }

  contractFor(
    underlying: Underlying,
    strike: number,
    optionType: OptionType,
    expiry: string
  ): OptionContract {
    for (const contract of Array.from(this.tokenMap.values())) {
      if (
        contract.underlying === underlying &&
        contract.strike === strike &&
        contract.optionType === optionType &&
        contract.expiry === expiry
      ) {
        return contract;
      }
    }
    throw new Error(`No listed contract for ${underlying} ${expiry} ${strike} ${optionType}`);
  }

  quoteFor(contract: OptionContract): OptionQuote | null {
    const row = this.latest?.chain.find((r) => r.strike === contract.strike);
    if (!row) return null;
    return contract.optionType === "CE" ? row.call : row.put;
  }

  /** Strikes the chain should carry around the money, for the subscribe list. */
  protected strikeWindow(atm: number, underlying: Underlying): number[] {
    const step = UNDERLYINGS[underlying].strikeStep;
    const out: number[] = [];
    for (let i = -CHAIN_DEPTH; i <= CHAIN_DEPTH; i += 1) out.push(atm + i * step);
    return out;
  }
}
