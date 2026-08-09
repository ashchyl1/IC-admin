/**
 * Overlay indicators for the Wave Lab.
 *
 * `ema` and `vwap` are reused from the scalper module — they are pure functions
 * over the same candle shape and there is no reason for two implementations to
 * drift. Bollinger Bands and the Heikin-Ashi transform live here because
 * nothing else in the app needed them.
 *
 * Every series returned is the same length as its input and padded with `null`
 * where the indicator is not yet defined, so a chart can align by index.
 */

import { ema, vwap } from "@/lib/scalper/indicators";
import type { MarketCandle } from "@/lib/market/types";
import type { BollingerSettings, IndicatorSettings } from "./types";

export { ema, vwap };

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export interface BollingerSeries {
  basis: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  /** (close − lower) ÷ (upper − lower). Above 1 = closed outside the upper band. */
  percentB: (number | null)[];
  /** (upper − lower) ÷ basis. Squeeze detection. */
  bandwidth: (number | null)[];
}

/**
 * Bollinger Bands.
 *
 * Population standard deviation over the same window as the basis, which is
 * what Bollinger specified and what every charting package uses — a sample
 * deviation would put the bands fractionally wider and disagree with
 * TradingView on every bar.
 */
export function bollinger(
  candles: MarketCandle[],
  settings: Pick<BollingerSettings, "period" | "stdDev" | "source">
): BollingerSeries {
  const { period, stdDev, source } = settings;
  const values = candles.map((candle) =>
    source === "hlc3" ? (candle.high + candle.low + candle.close) / 3 : candle.close
  );

  const basis = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  const percentB: (number | null)[] = new Array(values.length).fill(null);
  const bandwidth: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i += 1) {
    const mean = basis[i];
    if (mean === null) continue;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (values[j] - mean) ** 2;
    const deviation = Math.sqrt(variance / period);

    const up = mean + stdDev * deviation;
    const down = mean - stdDev * deviation;
    upper[i] = up;
    lower[i] = down;
    percentB[i] = up === down ? 0.5 : (candles[i].close - down) / (up - down);
    bandwidth[i] = mean === 0 ? null : (up - down) / mean;
  }

  return { basis, upper, lower, percentB, bandwidth };
}

/**
 * Heikin-Ashi. Offered as a chart type but never as a source for wave pivots —
 * its opens and closes are averages and do not exist in the market, so a pivot
 * read off one cannot be traded. The workspace keeps the real candle array for
 * snapping and measurement whichever chart type is on screen.
 */
export function heikinAshi(candles: MarketCandle[]): MarketCandle[] {
  const out: MarketCandle[] = [];
  let prevOpen = 0;
  let prevClose = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open = i === 0 ? (candle.open + candle.close) / 2 : (prevOpen + prevClose) / 2;
    out.push({
      time: candle.time,
      open,
      close,
      high: Math.max(candle.high, open, close),
      low: Math.min(candle.low, open, close),
      volume: candle.volume,
    });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

export interface ComputedIndicators {
  emas: { id: string; period: number; color: string; values: (number | null)[] }[];
  bollinger: BollingerSeries | null;
  vwap: (number | null)[] | null;
}

export function computeIndicators(
  candles: MarketCandle[],
  settings: IndicatorSettings
): ComputedIndicators {
  const closes = candles.map((candle) => candle.close);
  return {
    emas: settings.emas
      .filter((line) => line.enabled)
      .map((line) => ({
        id: line.id,
        period: line.period,
        color: line.color,
        values: ema(closes, line.period),
      })),
    bollinger: settings.bollinger.enabled ? bollinger(candles, settings.bollinger) : null,
    vwap: settings.vwap ? vwap(candles) : null,
  };
}

/** Last defined value of a padded series — what the export and the readout want. */
export function lastValue(series: (number | null)[] | null | undefined): number | null {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
