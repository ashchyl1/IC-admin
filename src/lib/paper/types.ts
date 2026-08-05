import type {
  EquitySnapshot,
  Instrument,
  PaperFill,
  PaperOrder,
  PaperPosition,
  ReplaySession,
  TradeJournalEntry,
} from "@/lib/supabase/types";

/** A candle the replay engine has released. Never contains future bars. */
export type ReleasedCandle = {
  bar_index: number;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Return shape of the get_session_state / advance_replay RPCs. */
export type SessionState = {
  session: ReplaySession;
  instrument: Instrument;
  position: PaperPosition | null;
  candles: ReleasedCandle[];
  orders: PaperOrder[];
  fills: PaperFill[];
  trades: TradeJournalEntry[];
  equity: EquitySnapshot[];
};

export type Performance = {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number;
  gross_realized: number;
  total_fees: number;
  net_realized: number;
  average_win: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  profit_factor: number | null;
  expectancy: number;
  risk_reward: number | null;
  average_holding_bars: number;
  max_consecutive_wins: number;
  max_consecutive_losses: number;
  long: { trades: number; net_pnl: number; wins: number };
  short: { trades: number; net_pnl: number; wins: number };
  starting_capital: number;
  cash: number;
  equity: number;
  unrealized_pnl: number;
  open_quantity: number;
  average_entry: number;
  total_return_pct: number;
  max_drawdown: number;
  max_drawdown_pct: number;
  bars_elapsed: number;
  total_bars: number;
};

export type SlippageConfig = { mode: "ticks" | "points" | "bps"; value: number };

export type FeeConfig = {
  brokerage_mode: "flat" | "percent" | "min_of_flat_and_percent";
  flat: number;
  percent: number;
  percent_cap?: number;
  min_commission?: number;
  exchange_bps: number;
  statutory_bps: number;
  preset?: string;
};

/**
 * Editable cost presets. Rates are not hard-coded into the engine -- these are
 * starting points the user can change per session, because statutory charges
 * change over time and differ by segment.
 */
export const FEE_PRESETS: Record<string, { label: string; config: FeeConfig }> = {
  "indian-discount": {
    label: "Indian discount broker (equity delivery-style)",
    config: {
      brokerage_mode: "min_of_flat_and_percent",
      flat: 20,
      percent: 0.03,
      percent_cap: 20,
      min_commission: 0,
      exchange_bps: 3.45,
      statutory_bps: 0,
      preset: "indian-discount",
    },
  },
  "flat-20": {
    label: "Flat ₹20 per order",
    config: {
      brokerage_mode: "flat",
      flat: 20,
      percent: 0,
      exchange_bps: 3.45,
      statutory_bps: 0,
      preset: "flat-20",
    },
  },
  "zero-cost": {
    label: "Zero cost (clean arithmetic)",
    config: {
      brokerage_mode: "flat",
      flat: 0,
      percent: 0,
      exchange_bps: 0,
      statutory_bps: 0,
      preset: "zero-cost",
    },
  },
};

export const TIMEFRAMES = [
  "minute",
  "3minute",
  "5minute",
  "15minute",
  "30minute",
  "60minute",
  "day",
] as const;
