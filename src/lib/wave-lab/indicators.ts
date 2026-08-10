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

/** Drop the warm-up nulls, for feeding a chart series. */
export function defined(points: IndicatorPoint[]): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  for (const p of points) if (p.value !== null) out.push({ time: p.time, value: p.value });
  return out;
}
