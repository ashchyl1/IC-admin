/**
 * Indicator maths. Pure functions over candle arrays — no React, no store.
 *
 * Every series returned is the same length as its input, padded with `null`
 * where the indicator is not yet defined, so a chart can align by index without
 * offset bookkeeping.
 */

import { SESSION, TIMEFRAME_MINUTES } from "./config";
import type {
  Bias,
  Candle,
  IndicatorSeries,
  Level,
  MtfCell,
  Timeframe,
  VolumeProfileBin,
} from "./types";

/** Exponential moving average. `null` until `period` closes have accumulated. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Session-anchored VWAP. Resets whenever the calendar day changes, so a chart
 * that spans several sessions still shows one VWAP per session, which is what
 * an intraday trader expects.
 */
export function vwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let cumPv = 0;
  let cumVol = 0;
  let currentDay = -1;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const day = Math.floor(c.time / 86_400);
    if (day !== currentDay) {
      currentDay = day;
      cumPv = 0;
      cumVol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    cumPv += typical * c.volume;
    cumVol += c.volume;
    out[i] = cumVol > 0 ? cumPv / cumVol : c.close;
  }
  return out;
}

export function indicatorsFor(candles: Candle[]): IndicatorSeries {
  const closes = candles.map((c) => c.close);
  return { ema9: ema(closes, 9), ema20: ema(closes, 20), vwap: vwap(candles) };
}

/** Roll 1-minute candles up into any coarser timeframe. */
export function aggregate(base: Candle[], timeframe: Timeframe, anchorSeconds: number): Candle[] {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  if (minutes <= 1) return base.slice();

  const size = minutes * 60;
  const out: Candle[] = [];
  let bucket: Candle | null = null;
  let bucketStart = 0;

  for (const c of base) {
    const start =
      timeframe === "1d"
        ? Math.floor(c.time / 86_400) * 86_400
        : anchorSeconds + Math.floor((c.time - anchorSeconds) / size) * size;

    if (!bucket || start !== bucketStart) {
      if (bucket) out.push(bucket);
      bucketStart = start;
      bucket = { time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += c.volume;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

/** High and low of the most recent complete session before the current one. */
export function previousDayRange(candles: Candle[]): { high: number; low: number } | null {
  if (candles.length === 0) return null;
  const lastDay = Math.floor(candles[candles.length - 1].time / 86_400);
  let prevDay = -1;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const day = Math.floor(candles[i].time / 86_400);
    if (day !== lastDay) {
      prevDay = day;
      break;
    }
  }
  if (prevDay < 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (Math.floor(c.time / 86_400) !== prevDay) continue;
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  return Number.isFinite(high) ? { high, low } : null;
}

/** High and low of the first `SESSION.openingRangeMinutes` of the current session. */
export function openingRange(
  candles: Candle[],
  sessionOpenSeconds: number
): { high: number; low: number } | null {
  const end = sessionOpenSeconds + SESSION.openingRangeMinutes * 60;
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.time < sessionOpenSeconds || c.time >= end) continue;
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  return Number.isFinite(high) ? { high, low } : null;
}

/**
 * Swing-pivot support and resistance.
 *
 * A bar is a pivot when it is the extreme of a `lookback`-wide window on both
 * sides. Nearby pivots are merged so the chart does not end up with six lines a
 * rupee apart, and only the strongest few either side of price survive.
 */
export function supportResistance(candles: Candle[], lookback = 5, maxLevels = 4): Level[] {
  if (candles.length < lookback * 2 + 1) return [];

  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = lookback; i < candles.length - lookback; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }

  const last = candles[candles.length - 1].close;
  const tolerance = last * 0.0008; // ~20 points on NIFTY

  const resistances = cluster(highs.filter((h) => h > last), tolerance).slice(0, maxLevels);
  const supports = cluster(lows.filter((l) => l < last), tolerance)
    .sort((a, b) => b.price - a.price)
    .slice(0, maxLevels);

  return [
    ...resistances.map((r, i) => ({ price: r.price, label: `R${i + 1}`, kind: "resistance" as const })),
    ...supports.map((s, i) => ({ price: s.price, label: `S${i + 1}`, kind: "support" as const })),
  ];
}

function cluster(values: number[], tolerance: number): { price: number; weight: number }[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(v - last[last.length - 1]) <= tolerance) last.push(v);
    else groups.push([v]);
  }
  return groups
    .map((g) => ({ price: g.reduce((a, b) => a + b, 0) / g.length, weight: g.length }))
    .sort((a, b) => b.weight - a.weight || a.price - b.price);
}

/** Horizontal volume-at-price histogram, plus the point of control. */
export function volumeProfile(candles: Candle[], bins = 24): VolumeProfileBin[] {
  if (candles.length === 0) return [];
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of candles) {
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
  }
  if (!Number.isFinite(hi) || hi <= lo) return [];

  const step = (hi - lo) / bins;
  const buckets = new Array<number>(bins).fill(0);

  for (const c of candles) {
    // Spread each candle's volume evenly across the bins it spans. Cheap, and
    // close enough to a real profile for a visual reference level.
    const from = Math.max(0, Math.floor((c.low - lo) / step));
    const to = Math.min(bins - 1, Math.floor((c.high - lo) / step));
    const span = to - from + 1;
    for (let b = from; b <= to; b += 1) buckets[b] += c.volume / span;
  }

  const peak = Math.max(...buckets);
  return buckets.map((volume, i) => ({
    price: lo + step * (i + 0.5),
    volume,
    isPoc: volume === peak,
  }));
}

/**
 * Multi-timeframe bias.
 *
 * v1 rule, exactly as specified: bullish when the close is above *both* VWAP
 * and the 20 EMA, bearish when below both, neutral otherwise. Deliberately
 * blunt — a scalper wants a traffic light, not a thesis.
 */
export function biasFor(candles: Candle[]): { bias: Bias; close: number; vwapValue: number | null; ema20Value: number | null } {
  if (candles.length === 0) return { bias: "NEUTRAL", close: 0, vwapValue: null, ema20Value: null };

  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const vw = vwap(candles);
  const i = candles.length - 1;
  const close = closes[i];
  const ema20Value = e20[i];
  const vwapValue = vw[i];

  if (ema20Value === null || vwapValue === null) {
    return { bias: "NEUTRAL", close, vwapValue, ema20Value };
  }
  if (close > vwapValue && close > ema20Value) return { bias: "BULLISH", close, vwapValue, ema20Value };
  if (close < vwapValue && close < ema20Value) return { bias: "BEARISH", close, vwapValue, ema20Value };
  return { bias: "NEUTRAL", close, vwapValue, ema20Value };
}

export function mtfCells(
  base1m: Candle[],
  anchorSeconds: number,
  timeframes: Timeframe[]
): MtfCell[] {
  return timeframes.map((tf) => {
    const series = aggregate(base1m, tf, anchorSeconds);
    const { bias, close, vwapValue, ema20Value } = biasFor(series);
    return { timeframe: tf, bias, close, vwap: vwapValue, ema20: ema20Value };
  });
}
