/**
 * Magnetic snapping to candle highs and lows.
 *
 * Elliott pivots are, by definition, actual extremes — a wave 3 that ends
 * three ticks below the real high is a wrong pivot, and it propagates into
 * every ratio and rule downstream. Snapping makes the honest placement the
 * easy one.
 *
 * The threshold is in **pixels, not price**, deliberately. A price threshold
 * behaves completely differently at different zoom levels and on instruments
 * an order of magnitude apart — 5 points is nothing on NIFTY and enormous on a
 * ₹40 stock. Pixels are what the hand is actually aiming with.
 */

import type { MarketCandle } from "../types";
import type { Pivot } from "./tools";

export const SNAP_RADIUS_PX = 12;

export interface SnapResult {
  pivot: Pivot;
  /** True when the point moved; lets the UI show a magnet indicator. */
  snapped: boolean;
  target?: "high" | "low";
}

interface Projector {
  toScreen(p: { time: number; price: number }): { x: number; y: number } | null;
}

/**
 * Snap a placed point to the nearest candle high or low.
 *
 * Considers a small neighbourhood of bars around the cursor rather than only
 * the bar under it: at a wide zoom the pointer often sits between bars, and
 * only testing the exact bar makes the magnet feel broken precisely when it is
 * most wanted.
 */
export function snapToExtreme(
  point: Pivot,
  candles: MarketCandle[],
  project: Projector,
  { radiusPx = SNAP_RADIUS_PX, neighbourhood = 3 }: { radiusPx?: number; neighbourhood?: number } = {}
): SnapResult {
  if (!candles.length) return { pivot: point, snapped: false };

  const cursor = project.toScreen(point);
  if (!cursor) return { pivot: point, snapped: false };

  // Nearest bar by time, then scan outward.
  let nearest = 0;
  let bestDt = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const dt = Math.abs(candles[i].time - point.time);
    if (dt < bestDt) {
      bestDt = dt;
      nearest = i;
    }
  }

  let best: { pivot: Pivot; distance: number; target: "high" | "low" } | null = null;
  const from = Math.max(0, nearest - neighbourhood);
  const to = Math.min(candles.length - 1, nearest + neighbourhood);

  for (let i = from; i <= to; i++) {
    const candle = candles[i];
    for (const target of ["high", "low"] as const) {
      const candidate: Pivot = { time: candle.time, price: candle[target] };
      const screen = project.toScreen(candidate);
      if (!screen) continue;
      const distance = Math.hypot(screen.x - cursor.x, screen.y - cursor.y);
      if (distance <= radiusPx && (!best || distance < best.distance)) {
        best = { pivot: candidate, distance, target };
      }
    }
  }

  return best
    ? { pivot: best.pivot, snapped: true, target: best.target }
    : { pivot: point, snapped: false };
}
