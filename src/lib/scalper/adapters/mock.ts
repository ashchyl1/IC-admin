/**
 * Mock adapter — wraps `MockMarketGenerator` in the `MarketDataAdapter` shape.
 *
 * It owns the tick timer, so nothing in React has to. Components subscribe and
 * get told when there is something new; they never poll.
 */

import { DEFAULT_EXECUTION, MTF_TIMEFRAMES } from "../config";
import { aggregate } from "../indicators";
import { MockMarketGenerator } from "../mock/generator";
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

export interface MockAdapterOptions {
  seed?: number;
  tickIntervalMs?: number;
  closedReplayMultiplier?: number;
}

export class MockAdapter implements MarketDataAdapter {
  readonly id = "mock";
  readonly label = "Mock feed";
  readonly isLive = false;

  private readonly generator: MockMarketGenerator;
  private readonly tickIntervalMs: number;
  private readonly listeners = new Set<(snapshot: AdapterSnapshot) => void>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private state: ConnectionState = "disconnected";
  private latest: AdapterSnapshot | null = null;

  private selection: AdapterSelection = {
    underlying: "NIFTY",
    expiry: "",
    centreStrike: null,
  };

  constructor(options: MockAdapterOptions = {}) {
    this.generator = new MockMarketGenerator({
      seed: options.seed,
      closedReplayMultiplier: options.closedReplayMultiplier,
    });
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_EXECUTION.tickIntervalMs;
    this.selection.expiry = this.generator.expiries("NIFTY")[0] ?? "";
  }

  async connect(): Promise<void> {
    if (this.timer) return;
    this.state = "connecting";
    this.lastTickAt = Date.now();
    // One immediate snapshot so the workspace paints without a blank second.
    this.tick(0);
    this.state = "live";
    this.timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastTickAt;
      this.lastTickAt = now;
      this.tick(elapsed);
    }, this.tickIntervalMs);
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = "disconnected";
  }

  connectionState(): ConnectionState {
    return this.state;
  }

  select(selection: AdapterSelection): void {
    const underlyingChanged = selection.underlying !== this.selection.underlying;
    this.selection = { ...selection };
    if (underlyingChanged && !this.generator.expiries(selection.underlying).includes(selection.expiry)) {
      this.selection.expiry = this.generator.expiries(selection.underlying)[0] ?? selection.expiry;
    }
    // Republish immediately so the chain and cards do not lag a tick behind the
    // click that changed them.
    if (this.timer) this.tick(0);
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
    if (timeframe === "1d") return this.generator.daily(underlying);
    const base = this.generator.intraday1m(underlying);
    return aggregate(base, timeframe, this.generator.sessionOpenSeconds(underlying));
  }

  optionCandles(contract: OptionContract, timeframe: Timeframe): Candle[] {
    const base = this.generator.optionCandles(contract);
    if (timeframe === "1m") return base;
    return aggregate(base, timeframe, this.generator.sessionOpenSeconds(contract.underlying));
  }

  sessionOpenSeconds(underlying: Underlying): number {
    return this.generator.sessionOpenSeconds(underlying);
  }

  contractFor(
    underlying: Underlying,
    strike: number,
    optionType: OptionType,
    expiry: string
  ): OptionContract {
    return this.generator.contract(underlying, strike, optionType, expiry);
  }

  quoteFor(contract: OptionContract): OptionQuote | null {
    return this.generator.optionQuote(contract);
  }

  /** Daily candles for the 1D multi-timeframe cell. */
  mtfSeries(underlying: Underlying): Record<string, Candle[]> {
    const out: Record<string, Candle[]> = {};
    for (const tf of MTF_TIMEFRAMES) out[tf] = this.spotCandles(underlying, tf);
    return out;
  }

  restart(): void {
    this.generator.restart();
    this.selection.centreStrike = null;
    this.tick(0);
  }

  // ------------------------------------------------------------ private ---

  private tick(elapsedMs: number): void {
    this.generator.advance(elapsedMs);

    const { underlying, centreStrike } = this.selection;
    const expiries = this.generator.expiries(underlying);
    const expiry = expiries.includes(this.selection.expiry)
      ? this.selection.expiry
      : expiries[0] ?? this.selection.expiry;
    this.selection.expiry = expiry;

    const snapshot: AdapterSnapshot = {
      ts: this.generator.now,
      phase: this.generator.realPhase,
      simulated: true,
      replayComplete: this.generator.isReplayComplete,
      indices: this.generator.indexQuotes(),
      spot: this.generator.spotQuote(underlying),
      atmStrike: this.generator.atmStrike(underlying),
      expiries,
      chain: this.generator.chain(underlying, expiry, centreStrike ?? undefined),
    };

    this.latest = snapshot;
    this.state = "live";
    for (const listener of this.listeners) listener(snapshot);
  }
}
