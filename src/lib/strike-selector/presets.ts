/**
 * Contract presets.
 *
 * These only prefill the form — every field stays editable, and the price in
 * particular is indicative rather than live. The values that matter and rarely
 * change are the structural ones: lot size, strike interval, tick, and the
 * session length, because that last one is the denominator for the expected
 * move and is the field people most often get wrong (they use 24, or 6.25 for
 * an MCX contract that trades until 23:30).
 */

import type { InstrumentPreset, SelectorInput } from "./types";

export const TRADING_DAYS_PER_YEAR = 250;

/** MCX runs 09:00-23:30 for most of the year. */
const MCX_SESSION_HOURS = 14.5;
/** NSE cash-equity derivatives: 09:15-15:30. */
const NSE_SESSION_HOURS = 6.25;

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  {
    id: "mcx-silver",
    label: "SILVER",
    exchange: "MCX",
    defaultPrice: 115000,
    strikeStep: 1000,
    lotSize: 30,
    tickSize: 1,
    sessionHours: MCX_SESSION_HOURS,
    defaultIv: 0.22,
    minSpreadTicks: 10,
    note: "30 kg. Real volatility lands after 18:00 IST when COMEX opens.",
  },
  {
    id: "mcx-silverm",
    label: "SILVERM",
    exchange: "MCX",
    defaultPrice: 115000,
    strikeStep: 1000,
    lotSize: 5,
    tickSize: 1,
    sessionHours: MCX_SESSION_HOURS,
    defaultIv: 0.22,
    minSpreadTicks: 10,
    note: "5 kg mini. Same behaviour as SILVER at a sixth of the capital.",
  },
  {
    id: "mcx-gold",
    label: "GOLD",
    exchange: "MCX",
    defaultPrice: 98000,
    strikeStep: 100,
    lotSize: 100,
    tickSize: 1,
    sessionHours: MCX_SESSION_HOURS,
    defaultIv: 0.14,
    minSpreadTicks: 5,
    note: "Quoted per 10 g, 1 kg contract. Calmer than silver — smaller sigma.",
  },
  {
    id: "mcx-crudeoil",
    label: "CRUDEOIL",
    exchange: "MCX",
    defaultPrice: 5600,
    strikeStep: 50,
    lotSize: 100,
    tickSize: 1,
    sessionHours: MCX_SESSION_HOURS,
    defaultIv: 0.35,
    minSpreadTicks: 5,
    note: "100 barrels. High IV — the debit-spread gate trips here often.",
  },
  {
    id: "nse-nifty",
    label: "NIFTY",
    exchange: "NSE",
    defaultPrice: 24000,
    strikeStep: 50,
    lotSize: 75,
    tickSize: 0.05,
    sessionHours: NSE_SESSION_HOURS,
    defaultIv: 0.12,
    minSpreadTicks: 1,
    note: "Tightest book in the country — the spread gate rarely trips.",
  },
  {
    id: "nse-banknifty",
    label: "BANKNIFTY",
    exchange: "NSE",
    defaultPrice: 52000,
    strikeStep: 100,
    lotSize: 30,
    tickSize: 0.05,
    sessionHours: NSE_SESSION_HOURS,
    defaultIv: 0.15,
    minSpreadTicks: 2,
  },
];

export function presetById(id: string): InstrumentPreset {
  return INSTRUMENT_PRESETS.find((p) => p.id === id) ?? INSTRUMENT_PRESETS[0];
}

/**
 * Modelling constants that are not worth a form field but are worth naming.
 *
 * `IV_CRUSH_ON_TARGET` is the one to argue about: a directional thrust into
 * your target usually *lowers* implied vol, so a long option can be right on
 * direction and still disappoint. Eight percent is a conservative commodity
 * figure; index options around an event can crush far harder.
 */
export const MODEL_DEFAULTS = {
  riskFreeRate: 0.065,
  baseSpreadPct: 0.015,
  liquidityPenalty: 0.5,
  ivCrushOnTarget: -0.08,
  ivShiftOnAdverse: 0.04,
  smileCurvature: 0.05,
  spreadWidthSigma: 1,
  strikesEachSide: 4,
  targetSigma: 1,
  stopSigma: 1,
} as const;

/**
 * A complete, valid input built from a preset.
 *
 * The holding period defaults to two hours and the expiry to 7 days because
 * that is the shape of a published intraday call, and it is the shape where
 * strike choice actually changes the outcome.
 */
export function defaultInput(preset: InstrumentPreset): SelectorInput {
  return {
    price: preset.defaultPrice,
    direction: "BUY",
    iv: preset.defaultIv,
    ivRank: 50,
    holdHours: 2,
    sessionHours: preset.sessionHours,
    tradingDaysPerYear: TRADING_DAYS_PER_YEAR,
    dte: 7,
    targetSigma: MODEL_DEFAULTS.targetSigma,
    stopSigma: MODEL_DEFAULTS.stopSigma,
    edgeHitRate: null,
    strikeStep: preset.strikeStep,
    lotSize: preset.lotSize,
    tickSize: preset.tickSize,
    minSpreadTicks: preset.minSpreadTicks,
    baseSpreadPct: MODEL_DEFAULTS.baseSpreadPct,
    liquidityPenalty: MODEL_DEFAULTS.liquidityPenalty,
    riskFreeRate: MODEL_DEFAULTS.riskFreeRate,
    structure: "LONG_OPTION",
    spreadWidthSigma: MODEL_DEFAULTS.spreadWidthSigma,
    ivCrushOnTarget: MODEL_DEFAULTS.ivCrushOnTarget,
    ivShiftOnAdverse: MODEL_DEFAULTS.ivShiftOnAdverse,
    smileCurvature: MODEL_DEFAULTS.smileCurvature,
    strikesEachSide: MODEL_DEFAULTS.strikesEachSide,
  };
}
