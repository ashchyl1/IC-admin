/**
 * Market-data adapter contract.
 *
 * The workspace never touches a generator, a socket or an HTTP client directly
 * — it only ever holds one of these. Swapping the mock feed for Kite Connect,
 * the Kite MCP bridge, or any other vendor means writing one new class here and
 * changing one line in `createAdapter`. Nothing in the UI, the indicators or
 * the paper engine has to know.
 *
 * See `kite.ts` for a worked stub of the live implementation.
 */

import type {
  Candle,
  ChainRow,
  ConnectionState,
  IndexQuote,
  MarketPhase,
  OptionContract,
  OptionQuote,
  OptionType,
  Quote,
  Timeframe,
  Underlying,
} from "../types";

/** One coherent picture of the market, published on every tick. */
export interface AdapterSnapshot {
  /** Adapter clock in epoch ms. May be a replay clock, not wall time. */
  ts: number;
  /** The phase of the *real* exchange session, regardless of replay state. */
  phase: MarketPhase;
  /** True when the data is simulated rather than received from an exchange. */
  simulated: boolean;
  /** Set when a simulated session has run to its close. */
  replayComplete: boolean;
  indices: IndexQuote[];
  spot: Quote;
  atmStrike: number;
  expiries: string[];
  chain: ChainRow[];
}

export interface AdapterSelection {
  underlying: Underlying;
  expiry: string;
  /** Strike the chain is centred on. `null` follows ATM automatically. */
  centreStrike: number | null;
}

export interface MarketDataAdapter {
  /** Stable id for diagnostics and the connection badge. */
  readonly id: string;
  readonly label: string;
  /** False for mock/replay feeds — the UI shows a simulated-data ribbon. */
  readonly isLive: boolean;

  connect(): Promise<void>;
  disconnect(): void;
  connectionState(): ConnectionState;

  /** Change what the adapter should be streaming. */
  select(selection: AdapterSelection): void;

  /** Subscribe to snapshots. Returns an unsubscribe function. */
  onSnapshot(listener: (snapshot: AdapterSnapshot) => void): () => void;

  /** Latest snapshot, or null before the first tick. */
  snapshot(): AdapterSnapshot | null;

  /** Candles for the index itself. */
  spotCandles(underlying: Underlying, timeframe: Timeframe): Candle[];

  /** Candles for one option contract. */
  optionCandles(contract: OptionContract, timeframe: Timeframe): Candle[];

  /** Chart-time seconds of the current session's 09:15, for opening-range maths. */
  sessionOpenSeconds(underlying: Underlying): number;

  /** Build a contract descriptor without subscribing to it. */
  contractFor(
    underlying: Underlying,
    strike: number,
    optionType: OptionType,
    expiry: string
  ): OptionContract;

  /** Point quote for a single contract (used by the order cards). */
  quoteFor(contract: OptionContract): OptionQuote | null;

  /** Only meaningful for simulated feeds; a no-op on a live one. */
  restart?(): void;
}
