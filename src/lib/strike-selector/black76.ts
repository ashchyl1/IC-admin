/**
 * Black-76 pricing and greeks for options on futures.
 *
 * Why not reuse `lib/scalper/pricing.ts`: that module is spot Black-Scholes
 * built to make the mock feed's premiums move plausibly, and it exposes only
 * price and delta. Exchange-traded options in India settle against a *futures*
 * price (MCX commodities outright, NSE index options economically), so the
 * carry term belongs in the forward, not in the discount on the underlying.
 * Black-76 is that model, and the selector needs the full greek set plus a
 * repricing path it can trust at two different times.
 *
 * Everything here is pure and unrounded. Tick rounding is a display and
 * fill-modelling concern, so it lives in the engine, not in the pricer — a
 * premium rounded to 0.05 inside the model would make the greeks lumpy.
 */

export type OptionRight = "CE" | "PE";

/** Abramowitz & Stegun 7.1.26. Max error ~1.5e-7 — far below a paisa. */
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

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface Black76Input {
  /** Futures price. */
  f: number;
  /** Strike. */
  k: number;
  /** Time to expiry in years (calendar). */
  t: number;
  /** Risk-free rate, decimal. */
  r: number;
  /** Implied volatility, decimal annualised. */
  sigma: number;
  right: OptionRight;
}

export interface Greeks {
  price: number;
  /** dPrice/dFutures. Signed: negative for puts. */
  delta: number;
  /** d²Price/dFutures². Always positive for a long option. */
  gamma: number;
  /** Rupees lost per calendar day from decay alone, signed (negative = bleeding). */
  thetaPerDay: number;
  /** Rupees gained per 1 percentage point rise in IV. */
  vegaPerPoint: number;
}

/**
 * Intrinsic value, used whenever the option has no life or no vol left. Both
 * degenerate cases have to be handled explicitly: d1 divides by sigma*sqrt(t).
 */
function intrinsic(f: number, k: number, right: OptionRight): number {
  return Math.max(0, right === "CE" ? f - k : k - f);
}

function dTerms(f: number, k: number, t: number, sigma: number) {
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(f / k) + ((sigma * sigma) / 2) * t) / (sigma * sqrtT);
  return { d1, d2: d1 - sigma * sqrtT, sqrtT };
}

export function black76Price({ f, k, t, r, sigma, right }: Black76Input): number {
  if (t <= 0 || sigma <= 0 || f <= 0 || k <= 0) return intrinsic(f, k, right);
  const { d1, d2 } = dTerms(f, k, t, sigma);
  const df = Math.exp(-r * t);
  return right === "CE"
    ? df * (f * normCdf(d1) - k * normCdf(d2))
    : df * (k * normCdf(-d2) - f * normCdf(-d1));
}

/**
 * Price plus the four greeks the selector actually reasons about.
 *
 * Theta is reported per calendar day and vega per volatility *point* (not per
 * 1.0 of sigma) because that is how a trading screen quotes them, and the whole
 * point of this tool is to be checkable against one.
 */
export function black76Greeks(input: Black76Input): Greeks {
  const { f, k, t, r, sigma, right } = input;

  if (t <= 0 || sigma <= 0 || f <= 0 || k <= 0) {
    const itm = right === "CE" ? f > k : f < k;
    return {
      price: intrinsic(f, k, right),
      delta: itm ? (right === "CE" ? 1 : -1) : 0,
      gamma: 0,
      thetaPerDay: 0,
      vegaPerPoint: 0,
    };
  }

  const { d1, d2, sqrtT } = dTerms(f, k, t, sigma);
  const df = Math.exp(-r * t);
  const nd1 = normPdf(d1);
  const price =
    right === "CE"
      ? df * (f * normCdf(d1) - k * normCdf(d2))
      : df * (k * normCdf(-d2) - f * normCdf(-d1));

  // Theta = r*price - discounted vol-decay term. Both puts and calls share the
  // decay term because F*n(d1) === K*n(d2) under Black-76.
  const decay = (df * f * nd1 * sigma) / (2 * sqrtT);
  const thetaPerYear = r * price - decay;

  return {
    price,
    delta: right === "CE" ? df * normCdf(d1) : -df * normCdf(-d1),
    gamma: (df * nd1) / (f * sigma * sqrtT),
    thetaPerDay: thetaPerYear / 365,
    vegaPerPoint: (df * f * nd1 * sqrtT) / 100,
  };
}

/**
 * Newton solve for implied vol, bisection fallback.
 *
 * Present so a user can paste a real premium off their terminal and have the
 * selector calibrate to the market rather than to a guessed IV. Newton alone is
 * unreliable on deep wings where vega collapses, hence the bracketed fallback.
 */
export function impliedVolatility(
  target: number,
  { f, k, t, r, right }: Omit<Black76Input, "sigma">,
  guess = 0.25
): number | null {
  if (!(target > 0) || t <= 0) return null;
  // No vol can price below intrinsic or above the discounted forward.
  if (target < intrinsic(f, k, right) - 1e-9) return null;

  let sigma = guess;
  for (let i = 0; i < 40; i++) {
    const { price, vegaPerPoint } = black76Greeks({ f, k, t, r, sigma, right });
    const diff = price - target;
    if (Math.abs(diff) < 1e-6) return sigma;
    const vega = vegaPerPoint * 100; // back to per-1.0-of-sigma
    if (vega < 1e-8) break;
    const next = sigma - diff / vega;
    if (!Number.isFinite(next) || next <= 0 || next > 5) break;
    sigma = next;
  }

  let lo = 1e-4;
  let hi = 5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const price = black76Price({ f, k, t, r, sigma: mid, right });
    if (Math.abs(price - target) < 1e-6) return mid;
    if (price > target) hi = mid;
    else lo = mid;
  }
  const solved = (lo + hi) / 2;
  return solved > 1e-3 && solved < 4.99 ? solved : null;
}
