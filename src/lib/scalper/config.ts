/**
 * Scalper Window — tunable constants.
 *
 * Every number a real desk would argue about lives here, not inline in the
 * engine. Contract specs and charge rates change by circular; keeping them in
 * one file means a change is a one-line edit rather than a code hunt.
 */

import type { Timeframe, Underlying } from "./types";

export interface UnderlyingSpec {
  key: Underlying;
  label: string;
  /** NSE index symbol used by a broker feed. */
  feedSymbol: string;
  lotSize: number;
  /** Distance between adjacent strikes. */
  strikeStep: number;
  /** Base level for the mock generator only. */
  mockBase: number;
  /** Annualised vol used to seed the mock walk. */
  mockVol: number;
  /** Weekly expiry weekday, 0 = Sunday. */
  expiryWeekday: number;
}

export const UNDERLYINGS: Record<Underlying, UnderlyingSpec> = {
  NIFTY: {
    key: "NIFTY",
    label: "NIFTY 50",
    feedSymbol: "NSE:NIFTY 50",
    lotSize: 75,
    strikeStep: 50,
    mockBase: 24_180,
    mockVol: 0.12,
    expiryWeekday: 4, // Thursday
  },
  BANKNIFTY: {
    key: "BANKNIFTY",
    label: "BANK NIFTY",
    feedSymbol: "NSE:NIFTY BANK",
    lotSize: 35,
    strikeStep: 100,
    mockBase: 52_450,
    mockVol: 0.16,
    expiryWeekday: 3, // Wednesday
  },
};

export const UNDERLYING_KEYS: Underlying[] = ["NIFTY", "BANKNIFTY"];

/** Ticker strip members. SENSEX and VIX are display-only. */
export const TICKER_SYMBOLS = [
  { symbol: "NSE:NIFTY 50", label: "NIFTY 50", base: 24_180, vol: 0.12 },
  { symbol: "NSE:NIFTY BANK", label: "BANKNIFTY", base: 52_450, vol: 0.16 },
  { symbol: "BSE:SENSEX", label: "SENSEX", base: 79_320, vol: 0.11 },
  { symbol: "NSE:INDIA VIX", label: "INDIA VIX", base: 13.4, vol: 0.9 },
] as const;

// ----------------------------------------------------------- session ---

export const MARKET_TIMEZONE = "Asia/Kolkata";
/** Minutes past midnight, exchange local time. */
export const SESSION = {
  preOpenStart: 9 * 60,
  open: 9 * 60 + 15,
  close: 15 * 60 + 30,
  /** Opening-range window in minutes from the open. */
  openingRangeMinutes: 15,
};

// -------------------------------------------------------- timeframes ---

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "1d": 375, // one full session
};

/** Timeframes offered in the toolbar. Scalping only — no daily/hourly default. */
export const OPTION_TIMEFRAMES: Timeframe[] = ["1m", "3m"];
export const SPOT_TIMEFRAMES: Timeframe[] = ["1m", "3m", "5m", "15m"];
/** With Sync Charts on, all three panes share one timeframe from this list. */
export const SYNC_TIMEFRAMES: Timeframe[] = ["1m", "3m", "5m"];
export const MTF_TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h", "1d"];

export const DEFAULT_OPTION_TIMEFRAME: Timeframe = "1m";
export const DEFAULT_SPOT_TIMEFRAME: Timeframe = "3m";

// -------------------------------------------------------------- costs ---

export interface CostModel {
  /** Flat per executed order, capped — the common Indian discount-broker model. */
  brokeragePerOrder: number;
  /** Securities transaction tax, sell side only, on premium turnover. */
  sttSellRate: number;
  /** Exchange transaction charge, both sides, on premium turnover. */
  exchangeTxnRate: number;
  sebiRate: number;
  /** Stamp duty, buy side only. */
  stampDutyBuyRate: number;
  ipftRate: number;
  gstRate: number;
}

/** Indicative NSE F&O options rates. Adjust to your broker's actual sheet. */
export const DEFAULT_COST_MODEL: CostModel = {
  brokeragePerOrder: 20,
  sttSellRate: 0.001, // 0.10% of premium
  exchangeTxnRate: 0.0003503, // 0.03503% of premium
  sebiRate: 0.000001, // ₹10 per crore
  stampDutyBuyRate: 0.00003, // 0.003%
  ipftRate: 0.000005, // 0.0005%
  gstRate: 0.18,
};

// --------------------------------------------------------------- risk ---

export interface RiskSettings {
  /** Rupees. A single position may not show a loss worse than this. */
  maxLossPerTrade: number;
  /** Rupees. Realised + unrealised for the day. */
  maxDailyLoss: number;
  maxLotsPerOrder: number;
  maxOpenLots: number;
  /** Percentage of mid. Above this the spread warning fires. */
  wideSpreadPct: number;
  /** Milliseconds without a tick before prices are called stale. */
  staleAfterMs: number;
  /** Minimum gap between two orders on the same contract+side. */
  duplicateWindowMs: number;
  /** Orders allowed inside `cooldownWindowMs` before the pad locks. */
  burstLimit: number;
  cooldownWindowMs: number;
  cooldownLockMs: number;
  /** Selling options opens a confirmation dialog when true. */
  confirmBeforeSell: boolean;
  /** Default SL/target as a percentage of entry premium. */
  defaultStopPct: number;
  defaultTargetPct: number;
}

export const DEFAULT_RISK: RiskSettings = {
  maxLossPerTrade: 5_000,
  maxDailyLoss: 15_000,
  maxLotsPerOrder: 10,
  maxOpenLots: 20,
  wideSpreadPct: 1.5,
  staleAfterMs: 6_000,
  duplicateWindowMs: 1_200,
  burstLimit: 4,
  cooldownWindowMs: 3_000,
  cooldownLockMs: 5_000,
  confirmBeforeSell: true,
  defaultStopPct: 25,
  defaultTargetPct: 40,
};

// ---------------------------------------------------------- execution ---

export interface ExecutionSettings {
  /** Fraction of the bid-ask spread paid on top of the touch. 0.5 = half-spread. */
  slippageSpreadFraction: number;
  /** Additional fixed slippage in premium points, always against you. */
  slippageTicks: number;
  tickSize: number;
  /** Tick cadence of the mock feed, milliseconds. */
  tickIntervalMs: number;
}

export const DEFAULT_EXECUTION: ExecutionSettings = {
  slippageSpreadFraction: 0.5,
  slippageTicks: 0.05,
  tickSize: 0.05,
  tickIntervalMs: 1_000,
};

/** Strikes shown either side of ATM in the compact chain (3 + ATM + 3 = 7). */
export const CHAIN_DEPTH = 3;

/** Bars of history the mock generator builds for the previous session. */
export const HISTORY_SESSIONS = 6;
