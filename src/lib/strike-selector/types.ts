/** Shared vocabulary for the strike selector. Pure data — no behaviour here. */

import type { OptionRight } from "./black76";

export type { OptionRight };

/** The direction of the underlying call being expressed, not the option right. */
export type Direction = "BUY" | "SELL";

/**
 * How the directional view is expressed.
 *
 * `LONG_OPTION` buys the strike outright. `DEBIT_SPREAD` buys it and sells one
 * further OTM, which caps the payoff but removes most of the vega — the right
 * answer when IV is rich and the signal is still good.
 */
export type Structure = "LONG_OPTION" | "DEBIT_SPREAD";

export type ScenarioId = "target" | "half" | "flat" | "adverse";

export interface Scenario {
  id: ScenarioId;
  label: string;
  /**
   * Move of the underlying in units of the holding-period sigma, expressed in
   * the signal's favour. Negative means the trade went against you.
   */
  sigmaMove: number;
  /** Relative shift applied to the whole IV surface, e.g. -0.08 = IV falls 8%. */
  ivShift: number;
  probability: number;
}

export interface ScenarioOutcome {
  id: ScenarioId;
  /** Underlying price at exit under this scenario. */
  underlying: number;
  /** What the position is worth at exit, after crossing the spread to get out. */
  exitValue: number;
  /** Rupees per lot, net of both fills. */
  pnl: number;
  /** Return on the capital committed, in percent. */
  returnPct: number;
}

export type AdvisorySeverity = "block" | "warn" | "info";

export type AdvisoryCode =
  | "EXPIRY_GAMMA_TRAP"
  | "IV_RICH"
  | "IV_CHEAP"
  | "SPREAD_EATS_EDGE"
  | "BREAKEVEN_TOO_FAR"
  | "DELTA_OUT_OF_BAND"
  | "NO_EDGE_ASSUMED"
  | "HOLD_EXCEEDS_EXPIRY"
  | "QUASI_FUTURES"
  | "SPREAD_NEEDS_TIME"
  | "ILLIQUID_WING";

export interface Advisory {
  code: AdvisoryCode;
  severity: AdvisorySeverity;
  message: string;
}

export interface InstrumentPreset {
  id: string;
  label: string;
  exchange: string;
  /** Indicative futures price, only used to prefill the form. */
  defaultPrice: number;
  strikeStep: number;
  lotSize: number;
  tickSize: number;
  /**
   * Hours the contract actually trades in a session. Volatility accrues during
   * trading hours, so this — not 24 — is the denominator for an intraday move.
   */
  sessionHours: number;
  /** Typical ATM implied vol, decimal. */
  defaultIv: number;
  /** Floor on the bid-ask in ticks. This is what destroys cheap OTM strikes. */
  minSpreadTicks: number;
  note?: string;
}

export interface SelectorInput {
  /** Futures price of the underlying at entry. */
  price: number;
  direction: Direction;
  /** ATM implied vol, decimal annualised. */
  iv: number;
  /** Where that IV sits in its own 1-year range, 0-100. Gates the structure. */
  ivRank: number;
  /** Intended holding period in hours. */
  holdHours: number;
  /** Trading hours per session for this contract. */
  sessionHours: number;
  tradingDaysPerYear: number;
  /** Calendar days to expiry. */
  dte: number;
  /** Profit target as a multiple of the holding-period sigma. */
  targetSigma: number;
  /** Stop distance as a multiple of the holding-period sigma. */
  stopSigma: number;
  /**
   * Your own estimated probability of reaching the target, 0-1. `null` runs the
   * model with no edge at all, which is the honest baseline: it shows what the
   * spread and decay cost before any skill is assumed.
   */
  edgeHitRate: number | null;
  strikeStep: number;
  lotSize: number;
  tickSize: number;
  minSpreadTicks: number;
  /** Bid-ask as a fraction of premium at the money, before any widening. */
  baseSpreadPct: number;
  /**
   * How much the book thins away from the money, per unit of standardised
   * moneyness squared. Applies in both directions — deep ITM is not tight
   * either, which is what stops the ranking loving high-delta strikes.
   */
  liquidityPenalty: number;
  riskFreeRate: number;
  structure: Structure;
  /** Width of the short leg for a debit spread, in sigma. */
  spreadWidthSigma: number;
  /** Relative IV change when the target is hit — usually a crush. */
  ivCrushOnTarget: number;
  /** Relative IV change when the trade goes against you. */
  ivShiftOnAdverse: number;
  /** Curvature of the smile: IV multiplier grows by this per sigma² of OTM-ness. */
  smileCurvature: number;
  /** How many strikes to lay out on each side of the money. */
  strikesEachSide: number;
}

export interface StrikeCandidate {
  strike: number;
  right: OptionRight;
  /** Label relative to the money, from the option's own point of view. */
  moneyness: "ITM" | "ATM" | "OTM";
  /** Distance out of the money in holding-period sigmas. Negative = in the money. */
  sigmaDistance: number;
  /** IV this strike carries on the smile at entry. */
  entryIv: number;
  /** Fair mid premium at entry. */
  mid: number;
  /** What you actually pay: the ask, or the net debit for a spread. */
  entryFill: number;
  /** Absolute bid-ask on the position at entry. */
  spread: number;
  spreadPct: number;
  delta: number;
  gamma: number;
  thetaPerDay: number;
  vegaPerPoint: number;
  /** Short leg of the spread, when the structure has one. */
  shortStrike: number | null;
  /** Underlying price at which the position breaks even *at expiry*. */
  breakevenPrice: number;
  /** That expiry breakeven, in holding-period sigmas. Rarely the relevant hurdle. */
  breakevenSigma: number;
  /**
   * The move needed by the time you *exit* just to get your entry cost back,
   * in rupees of underlying. `null` when no move can do it. This — not the
   * expiry breakeven — is the hurdle on a hold shorter than the contract.
   */
  scratchMove: number | null;
  /** The same, in holding-period sigmas. The headline hurdle. */
  scratchSigma: number | null;
  /** Rupees committed per lot. For a long option this is also the max loss. */
  capitalPerLot: number;
  outcomes: Record<ScenarioId, ScenarioOutcome>;
  /** Probability-weighted rupees per lot. */
  expectancy: number;
  /** Expectancy as a fraction of capital committed. The ranking key. */
  edgeRatio: number;
  /**
   * The hit rate this strike needs to break even, 0-1. Lower is better, and it
   * is the only comparison across strikes that survives repetition.
   */
  breakevenHitRate: number | null;
  advisories: Advisory[];
}

export interface SelectorResult {
  /** One-sigma move of the underlying over the holding period, in rupees. */
  sigmaHold: number;
  /** The same, as a percentage of the underlying. */
  sigmaHoldPct: number;
  atmStrike: number;
  right: OptionRight;
  targetPrice: number;
  stopPrice: number;
  /** Years to expiry at entry and at exit. */
  tNow: number;
  tExit: number;
  scenarios: Scenario[];
  candidates: StrikeCandidate[];
  /** Highest edge ratio among candidates carrying no blocking advisory. */
  best: StrikeCandidate | null;
  /** Input-level advisories that apply to the whole setup. */
  advisories: Advisory[];
}
