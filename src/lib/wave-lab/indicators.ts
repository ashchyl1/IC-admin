/**
 * Indicator maths. §7.
 *
 * Pure functions over a candle array, returning one point per input bar with
 * `null` where the indicator has not warmed up yet. Nulls rather than a
 * shortened array on purpose: the caller can zip results against bars by index
 * without an offset, and an off-by-one in that offset is the classic way an
 * indicator ends up drawn one bar early.
 */

import type { MarketCandle } from "./types";

export interface IndicatorPoint {
  time: number;
  value: number | null;
}

export interface BollingerBands {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];
  lower: IndicatorPoint[];
}

/** Simple moving average of closes. */
export function sma(candles: MarketCandle[], length: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (length <= 0) return candles.map((c) => ({ time: c.time, value: null }));

  let running = 0;
  for (let i = 0; i < candles.length; i++) {
    running += candles[i].close;
    if (i >= length) running -= candles[i - length].close;
    out.push({
      time: candles[i].time,
      value: i >= length - 1 ? running / length : null,
    });
  }
  return out;
}

/**
 * Bollinger Bands. Defaults 20 / 2, per §7.
 *
 * Uses the **population** standard deviation (divide by n), which is what
 * Bollinger specified and what every charting package including Kite plots.
 * The sample deviation (n−1) gives visibly wider bands and would quietly
 * disagree with the same study on any other screen.
 */
export function bollinger(
  candles: MarketCandle[],
  length = 20,
  deviations = 2
): BollingerBands {
  const middle = sma(candles, length);
  const upper: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const mean = middle[i].value;
    if (mean === null) {
      upper.push({ time: candles[i].time, value: null });
      lower.push({ time: candles[i].time, value: null });
      continue;
    }
    let sumSq = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const d = candles[j].close - mean;
      sumSq += d * d;
    }
    const sd = Math.sqrt(sumSq / length);
    upper.push({ time: candles[i].time, value: mean + deviations * sd });
    lower.push({ time: candles[i].time, value: mean - deviations * sd });
  }

  return { upper, middle, lower };
}

/**
 * Exponential moving average.
 *
 * Seeded with the SMA of the first `period` closes, which is the conventional
 * seed and matches Kite. Seeding with the first close instead makes the early
 * values wrong in a way that slowly decays, so two charts of the same EMA
 * disagree near the left edge and converge later — hard to spot, easy to
 * mistrust.
 */
export function ema(candles: MarketCandle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = candles.map((c) => ({ time: c.time, value: null }));
  if (period <= 0 || candles.length < period) return out;

  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].close;
  let value = seed / period;
  out[period - 1] = { time: candles[period - 1].time, value };

  for (let i = period; i < candles.length; i++) {
    value = (candles[i].close - value) * multiplier + value;
    out[i] = { time: candles[i].time, value };
  }
  return out;
}

/* ------------------------------------------------------------------ RMI -- */

/**
 * Wilder's smoothing — Pine's `ta.rma`.
 *
 * Seeded with the SMA of the first `length` valid values, then
 * `alpha*src + (1-alpha)*prev` with `alpha = 1/length`. The seed matters: an
 * EMA-style seed from the first value alone leaves the early output wrong in a
 * way that decays slowly, so the study disagrees with TradingView near the
 * left edge and quietly converges later.
 *
 * Operates on a nullable series because RMI's input is undefined for the first
 * `lookback` bars.
 */
export function rma(values: (number | null)[], length: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (length <= 0) return out;

  const alpha = 1 / length;
  let seeded = false;
  let acc = 0;
  let count = 0;
  let prev = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;

    if (!seeded) {
      acc += v;
      count += 1;
      if (count === length) {
        prev = acc / length;
        seeded = true;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Pine's `ta.sma` over a nullable series. */
export function smaOf(values: (number | null)[], length: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (length <= 0) return out;
  const window: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    window.push(v);
    sum += v;
    if (window.length > length) sum -= window.shift()!;
    if (window.length === length) out[i] = sum / length;
  }
  return out;
}

/** Pine's `ta.ema` over a nullable series — SMA-seeded, like ta.ema itself. */
export function emaOf(values: (number | null)[], length: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (length <= 0) return out;
  const alpha = 2 / (length + 1);
  let seeded = false;
  let acc = 0;
  let count = 0;
  let prev = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (!seeded) {
      acc += v;
      count += 1;
      if (count === length) {
        prev = acc / length;
        seeded = true;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export interface RmiOptions {
  lookback: number;
  smoothLen: number;
  scaleFactor: number;
  signalType: "SMA" | "EMA";
  signalLen: number;
}

export const RMI_DEFAULTS: RmiOptions = {
  lookback: 6,
  smoothLen: 11,
  scaleFactor: 4.5,
  signalType: "EMA",
  signalLen: 9,
};

export interface RmiResult {
  /** The scaled RMI — the green line. */
  rmi: IndicatorPoint[];
  /** Its moving average — the red line. */
  signal: IndicatorPoint[];
}

/**
 * RMI Scaled (Wilder's), a direct translation of the Pine study.
 *
 *   delta   = close - close[lookback]
 *   gain    = max(delta, 0)          loss = max(-delta, 0)
 *   avgGain = rma(gain, smoothLen)   avgLoss = rma(loss, smoothLen)
 *   rs      = avgLoss == 0 ? 99999 : avgGain / avgLoss
 *   rmi     = 100 - 100 / (1 + rs)
 *   green   = (rmi - 50) / scaleFactor
 *   red     = ema|sma(green, signalLen)
 *
 * The `avgLoss == 0 -> 99999` sentinel is kept rather than "fixed" to
 * Infinity: it is what the source does, and it pins the line just under the
 * scaled maximum instead of blowing the pane's auto-scale to infinity.
 */
export function rmiScaled(candles: MarketCandle[], options: RmiOptions = RMI_DEFAULTS): RmiResult {
  const { lookback, smoothLen, scaleFactor, signalType, signalLen } = options;
  const times = candles.map((c) => c.time);

  // Undefined until there is a bar `lookback` ago to compare against, which
  // is Pine's na for close[lookback].
  const gains: (number | null)[] = [];
  const losses: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < lookback) {
      gains.push(null);
      losses.push(null);
      continue;
    }
    const delta = candles[i].close - candles[i - lookback].close;
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }

  const avgGain = rma(gains, smoothLen);
  const avgLoss = rma(losses, smoothLen);

  const green: (number | null)[] = avgGain.map((g, i) => {
    const l = avgLoss[i];
    if (g === null || l === null) return null;
    const rs = l === 0 ? 99999 : g / l;
    const value = 100 - 100 / (1 + rs);
    return (value - 50) / (scaleFactor || 1);
  });

  const red = signalType === "EMA" ? emaOf(green, signalLen) : smaOf(green, signalLen);

  return {
    rmi: green.map((value, i) => ({ time: times[i], value })),
    signal: red.map((value, i) => ({ time: times[i], value })),
  };
}

/** Drop the warm-up nulls, for feeding a chart series. */
export function defined(points: IndicatorPoint[]): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  for (const p of points) if (p.value !== null) out.push({ time: p.time, value: p.value });
  return out;
}
