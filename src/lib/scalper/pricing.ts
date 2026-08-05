/**
 * Black-Scholes pricing for the mock feed.
 *
 * This exists so simulated option premiums behave like real ones: a CE gains
 * when spot rises, both legs bleed theta through the day, and OTM strikes cost
 * less than ATM. A live adapter never calls this — the exchange sends the
 * premium — but it keeps the demo honest enough to practise against.
 */

import type { OptionType } from "./types";

/** Abramowitz & Stegun 7.1.26 — plenty accurate for a premium display. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export interface BsInput {
  /** Spot. */
  s: number;
  /** Strike. */
  k: number;
  /** Time to expiry in years. */
  t: number;
  /** Risk-free rate, decimal. */
  r: number;
  /** Implied volatility, decimal. */
  sigma: number;
  type: OptionType;
}

export function blackScholes({ s, k, t, r, sigma, type }: BsInput): number {
  if (t <= 0 || sigma <= 0) {
    return Math.max(0, type === "CE" ? s - k : k - s);
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + (sigma * sigma) / 2) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-r * t);

  const value =
    type === "CE"
      ? s * normCdf(d1) - k * df * normCdf(d2)
      : k * df * normCdf(-d2) - s * normCdf(-d1);

  // Premiums quote in ticks of 0.05 and never go negative.
  return Math.max(0.05, Math.round(value * 20) / 20);
}

export function delta({ s, k, t, r, sigma, type }: BsInput): number {
  if (t <= 0 || sigma <= 0) {
    const itm = type === "CE" ? s > k : s < k;
    return itm ? (type === "CE" ? 1 : -1) : 0;
  }
  const d1 = (Math.log(s / k) + (r + (sigma * sigma) / 2) * t) / (sigma * Math.sqrt(t));
  return type === "CE" ? normCdf(d1) : normCdf(d1) - 1;
}

/**
 * A crude volatility smile: IV rises as a strike moves away from the money, and
 * puts carry a skew premium. Keeps the mock chain from looking suspiciously flat.
 */
export function impliedVol(spot: number, strike: number, base: number, type: OptionType): number {
  const moneyness = (strike - spot) / spot;
  const smile = base * (1 + 6 * moneyness * moneyness);
  const skew = type === "PE" ? base * 0.06 : 0;
  return Math.min(1.2, Math.max(0.05, smile + skew));
}

export const RISK_FREE_RATE = 0.065;
