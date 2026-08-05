/**
 * Scalper Window — domain types.
 *
 * This file is the contract between the four independent modules:
 *   market data  ->  indicators  ->  paper engine  ->  UI store
 * Nothing here imports React, so the engine and the adapters stay testable
 * without a DOM.
 */

export type Underlying = "NIFTY" | "BANKNIFTY";
export type OptionType = "CE" | "PE";
export type Side = "BUY" | "SELL";
export type Moneyness = "ITM" | "ATM" | "OTM";

/** Timeframes the workspace can render. `1d` is only used by the MTF strip. */
export type Timeframe = "1m" | "3m" | "5m" | "15m" | "1h" | "1d";

export type MarketPhase = "PRE_OPEN" | "OPEN" | "CLOSED";

export type ConnectionState = "connecting" | "live" | "stale" | "disconnected";

/** Unix seconds, exchange wall-clock adjusted (see `toChartTime`). */
export type Seconds = number;

export interface Candle {
  time: Seconds;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  ltp: number;
  bid: number;
  ask: number;
  /** Absolute change against the previous close. */
  change: number;
  changePct: number;
  volume: number;
  openInterest: number;
  prevClose: number;
  /** Epoch ms of the last update — drives the stale-price warning. */
  ts: number;
}

export interface IndexQuote extends Quote {
  symbol: string;
  label: string;
}

export interface OptionContract {
  /** e.g. NIFTY26AUG24000CE — display only, never sent anywhere. */
  symbol: string;
  underlying: Underlying;
  /** ISO date (yyyy-mm-dd) of expiry. */
  expiry: string;
  strike: number;
  optionType: OptionType;
  lotSize: number;
}

export interface OptionQuote extends Quote {
  contract: OptionContract;
  /** Implied volatility used by the mock pricer, as a decimal (0.18 = 18%). */
  iv: number;
}

export interface ChainRow {
  strike: number;
  call: OptionQuote;
  put: OptionQuote;
  isAtm: boolean;
}

/** One immutable snapshot of everything the UI needs for a single paint. */
export interface MarketSnapshot {
  phase: MarketPhase;
  /** Epoch ms in exchange time terms (the app renders it as Asia/Kolkata). */
  ts: number;
  indices: IndexQuote[];
  spot: Quote;
  spotCandles: Record<Timeframe, Candle[]>;
  chain: ChainRow[];
  atmStrike: number;
  expiries: string[];
  expiry: string;
}

// --------------------------------------------------------------- orders ---

export type OrderStatus = "FILLED" | "REJECTED";

export type ExitReason =
  | "MANUAL"
  | "STOP_LOSS"
  | "TARGET"
  | "KILL_SWITCH"
  | "EXIT_ALL"
  | "MAX_DAILY_LOSS";

export interface OrderRequest {
  contract: OptionContract;
  side: Side;
  /** Number of lots, not units. Quantity = lots × lotSize. */
  lots: number;
  /** Absolute premium levels, not points away. `null` = not set. */
  stopLoss: number | null;
  target: number | null;
  /** Set when the order is an exit leg, for journalling. */
  exitReason?: ExitReason;
  /** Idempotency key — the duplicate guard hashes this. */
  clientOrderId: string;
}

export interface Fill {
  id: string;
  ts: number;
  contract: OptionContract;
  side: Side;
  quantity: number;
  /** Mid/bid/ask reference before slippage was applied. */
  referencePrice: number;
  fillPrice: number;
  slippage: number;
  charges: ChargeBreakdown;
}

export interface Order {
  id: string;
  clientOrderId: string;
  ts: number;
  contract: OptionContract;
  side: Side;
  lots: number;
  quantity: number;
  status: OrderStatus;
  rejectReason?: string;
  fill?: Fill;
}

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  sebi: number;
  stampDuty: number;
  ipft: number;
  gst: number;
  total: number;
}

export interface Position {
  /** Contract symbol — one position per contract. */
  key: string;
  contract: OptionContract;
  /** Signed: positive is long, negative is short. */
  quantity: number;
  averagePrice: number;
  /** Charges paid so far on this position (entries only; exits add on close). */
  chargesPaid: number;
  realizedPnl: number;
  stopLoss: number | null;
  target: number | null;
  openedAt: number;
  /** Live mark, refreshed from the chain on every tick. */
  lastPrice: number;
}

export interface JournalTrade {
  id: string;
  entryTs: number;
  exitTs: number;
  contract: OptionContract;
  /** LONG = bought to open, SHORT = sold to open. */
  direction: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  target: number | null;
  charges: number;
  grossPnl: number;
  netPnl: number;
  /** Milliseconds held. */
  durationMs: number;
  exitReason: ExitReason;
}

// ------------------------------------------------------------ analytics ---

export interface IndicatorSeries {
  ema9: (number | null)[];
  ema20: (number | null)[];
  vwap: (number | null)[];
}

export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface MtfCell {
  timeframe: Timeframe;
  bias: Bias;
  close: number;
  vwap: number | null;
  ema20: number | null;
}

export interface Level {
  price: number;
  label: string;
  kind: "support" | "resistance" | "prevDay" | "openingRange" | "vwap";
}

export interface VolumeProfileBin {
  price: number;
  volume: number;
  /** True for the point of control (highest-volume bin). */
  isPoc: boolean;
}

// -------------------------------------------------------------- warnings ---

export type RiskCode =
  | "MARKET_CLOSED"
  | "STALE_PRICE"
  | "WIDE_SPREAD"
  | "MAX_LOTS"
  | "MAX_LOSS_PER_TRADE"
  | "MAX_DAILY_LOSS"
  | "DUPLICATE_ORDER"
  | "COOLDOWN"
  | "KILL_SWITCH"
  | "NO_POSITION";

export interface RiskViolation {
  code: RiskCode;
  message: string;
  /** `block` refuses the order outright; `warn` only surfaces a banner. */
  severity: "block" | "warn";
}

export type NoticeTone = "info" | "success" | "warn" | "error";

export interface Notice {
  id: string;
  ts: number;
  tone: NoticeTone;
  title: string;
  message: string;
}
