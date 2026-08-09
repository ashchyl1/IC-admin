/**
 * Measurement engine.
 *
 * Turns a drawing's raw points into the numbers an Elliott analyst actually
 * argues about: leg lengths in price and bars, every wave-to-wave ratio worth
 * naming, the time counts between pivots, and the clusters those counts form.
 *
 * Pure functions over plain data — no React, no chart. The rule engine and the
 * Claude export both read from here, so a wave count means the same thing on
 * screen, in the validator, and in the JSON.
 */

import {
  findTimeClusters,
  matchPriceNumber,
  matchRatio,
  matchTimeBars,
  PRICE_RATIOS,
  TIME_RATIOS,
  type RatioMatch,
  type TimeCluster,
  type TimeCount,
} from "./fib";
import { decorateLabel, type DegreeKey } from "./degrees";
import { TOOLS, labelAt, type ToolId } from "./patterns";
import { barIndexer, type BarIndex, type Drawing, type WavePoint } from "./types";
import type { MarketCandle } from "@/lib/market/types";

export interface LegMetric {
  /** 1-based leg number. Leg 1 runs from the origin to the first label. */
  index: number;
  /** Decorated label of the leg's terminal point, e.g. `(3)`. */
  label: string;
  /** Undecorated label, for machine reading. */
  base: string;
  from: WavePoint;
  to: WavePoint;
  direction: 1 | -1;
  /** Signed price move. */
  change: number;
  /** Absolute price travelled. */
  length: number;
  /** Move as a percentage of the leg's starting price. */
  changePct: number;
  /** Bars between the two pivots. */
  bars: number;
  fromIndex: number;
  toIndex: number;
}

export interface NamedRatio {
  /** e.g. `wave 3 ÷ wave 1`. */
  label: string;
  key: string;
  value: number;
  match: RatioMatch;
  kind: "price" | "time";
}

export interface DrawingMetrics {
  drawingId: string;
  tool: ToolId;
  degree: DegreeKey;
  variant?: string;
  complete: boolean;
  /** Net direction of the whole structure. */
  direction: 1 | -1;
  legs: LegMetric[];
  ratios: NamedRatio[];
  timeCounts: TimeCount[];
  clusters: TimeCluster[];
  /** Whole-pattern span. */
  totalRange: number;
  totalBars: number;
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  /** Set when the pattern's total range lands on a Fibonacci/Lucas number. */
  priceNumber: { value: number; scale: number } | null;
  /** 2–4 base line and its 1–3 parallel, for impulse channelling. */
  channel: ChannelMetric | null;
}

export interface ChannelMetric {
  /** Two points defining the base line (2→4 for an impulse, A→C for a zigzag). */
  base: [WavePoint, WavePoint];
  /** The pivot the parallel is projected through. */
  through: WavePoint;
  /** Price of the parallel line at the pattern's end. */
  projectionAtEnd: number;
  /** How far the terminal pivot sits outside (+) or inside (−) the channel. */
  overshoot: number;
}

/** Pairings measured for each tool: [numerator leg, denominator leg, label]. */
const RATIO_PAIRS: Record<string, [number, number][]> = {
  impulse: [
    [2, 1],
    [3, 1],
    [4, 3],
    [5, 1],
    [5, 3],
  ],
  correction: [
    [2, 1],
    [3, 1],
    [3, 2],
  ],
  triangle: [
    [2, 1],
    [3, 1],
    [3, 2],
    [4, 2],
    [4, 3],
    [5, 3],
    [5, 4],
  ],
  doubleCombo: [
    [2, 1],
    [3, 1],
    [3, 2],
  ],
  tripleCombo: [
    [2, 1],
    [3, 1],
    [4, 3],
    [5, 3],
    [5, 1],
  ],
};

export function computeMetrics(
  drawing: Drawing,
  candles: MarketCandle[],
  index: BarIndex = barIndexer(candles)
): DrawingMetrics | null {
  const spec = TOOLS[drawing.tool];
  if (!spec.elliott || drawing.points.length < 2) return null;

  const points = drawing.points;
  const legs: LegMetric[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const change = to.price - from.price;
    const fromIndex = index.indexOf(from.time);
    const toIndex = index.indexOf(to.time);
    const base = labelAt(drawing.tool, i);
    legs.push({
      index: i,
      label: decorateLabel(base, drawing.degree),
      base,
      from,
      to,
      direction: change >= 0 ? 1 : -1,
      change,
      length: Math.abs(change),
      changePct: from.price !== 0 ? (change / from.price) * 100 : 0,
      bars: Math.abs(toIndex - fromIndex),
      fromIndex,
      toIndex,
    });
  }

  const first = points[0];
  const last = points[points.length - 1];
  const ratios: NamedRatio[] = [];

  for (const [numerator, denominator] of RATIO_PAIRS[drawing.tool] ?? []) {
    const a = legs[numerator - 1];
    const b = legs[denominator - 1];
    if (!a || !b || b.length === 0) continue;

    ratios.push({
      key: `price:${a.base}/${b.base}`,
      label: `${waveWord(drawing.tool, a.base)} ÷ ${waveWord(drawing.tool, b.base)} (price)`,
      value: a.length / b.length,
      match: matchRatio(a.length / b.length, PRICE_RATIOS),
      kind: "price",
    });

    if (b.bars > 0) {
      ratios.push({
        key: `time:${a.base}/${b.base}`,
        label: `${waveWord(drawing.tool, a.base)} ÷ ${waveWord(drawing.tool, b.base)} (time)`,
        value: a.bars / b.bars,
        match: matchRatio(a.bars / b.bars, TIME_RATIOS),
        kind: "time",
      });
    }
  }

  // Wave 5 against the combined span of 1 and 3 — the standard fifth-wave
  // projection when the third has extended.
  if (drawing.tool === "impulse" && legs.length >= 5) {
    const span = legs[0].length + legs[2].length;
    if (span > 0) {
      ratios.push({
        key: "price:5/(1+3)",
        label: "wave 5 ÷ (wave 1 + wave 3) (price)",
        value: legs[4].length / span,
        match: matchRatio(legs[4].length / span, PRICE_RATIOS),
        kind: "price",
      });
    }
  }

  const timeCounts = buildTimeCounts(drawing.tool, legs, index, first, last);

  return {
    drawingId: drawing.id,
    tool: drawing.tool,
    degree: drawing.degree,
    variant: drawing.variant,
    complete: points.length >= spec.points,
    direction: last.price >= first.price ? 1 : -1,
    legs,
    ratios,
    timeCounts,
    clusters: findTimeClusters(timeCounts),
    totalRange: Math.abs(last.price - first.price),
    totalBars: Math.abs(index.indexOf(last.time) - index.indexOf(first.time)),
    startTime: first.time,
    endTime: last.time,
    startPrice: first.price,
    endPrice: last.price,
    priceNumber: matchPriceNumber(Math.abs(last.price - first.price)),
    channel: buildChannel(drawing, legs),
  };
}

/**
 * The three progressions the SOP asks for — every leg's own duration, plus the
 * pivot-to-pivot counts that skip a leg (high→high and low→low), plus the
 * whole-pattern count. Those are what cluster.
 */
function buildTimeCounts(
  tool: ToolId,
  legs: LegMetric[],
  index: BarIndex,
  first: WavePoint,
  last: WavePoint
): TimeCount[] {
  const counts: TimeCount[] = [];
  const push = (label: string, bars: number) => {
    if (bars > 0) counts.push({ label, bars, match: matchTimeBars(bars) });
  };

  for (const leg of legs) push(`${waveWord(tool, leg.base)} duration`, leg.bars);

  // Same-direction pivots: 1→3, 3→5, A→C … the high-to-high and low-to-low
  // progressions that confirm a pattern's completion.
  for (let i = 0; i + 2 < legs.length; i += 1) {
    const from = legs[i];
    const to = legs[i + 2];
    push(
      `${waveWord(tool, from.base)} → ${waveWord(tool, to.base)} (same-direction pivots)`,
      Math.abs(to.toIndex - from.toIndex)
    );
  }

  // Origin to each terminal pivot.
  const originIndex = index.indexOf(first.time);
  for (const leg of legs) {
    push(`origin → ${waveWord(tool, leg.base)}`, Math.abs(leg.toIndex - originIndex));
  }

  push("whole pattern", Math.abs(index.indexOf(last.time) - originIndex));
  return counts;
}

/**
 * Channelling. For an impulse the base line joins the ends of waves 2 and 4 and
 * the parallel is thrown through the end of wave 3; wave 5 finishing near that
 * parallel is the classic confirmation. For a zigzag the A–C line does the same
 * job through B.
 */
function buildChannel(drawing: Drawing, legs: LegMetric[]): ChannelMetric | null {
  if (drawing.tool === "impulse" && legs.length >= 4) {
    return channelFrom(legs[1].to, legs[3].to, legs[2].to, legs[legs.length - 1].to);
  }
  if (drawing.tool === "correction" && legs.length >= 3) {
    return channelFrom(legs[0].to, legs[2].to, legs[1].to, legs[2].to);
  }
  if (drawing.tool === "triangle" && legs.length >= 4) {
    // Triangle boundaries: A–C is one side, B–D the other.
    return channelFrom(legs[0].to, legs[2].to, legs[1].to, legs[legs.length - 1].to);
  }
  return null;
}

function channelFrom(
  baseA: WavePoint,
  baseB: WavePoint,
  through: WavePoint,
  terminal: WavePoint
): ChannelMetric | null {
  const span = baseB.time - baseA.time;
  if (span === 0) return null;

  const slope = (baseB.price - baseA.price) / span;
  const baseAtThrough = baseA.price + slope * (through.time - baseA.time);
  const offset = through.price - baseAtThrough;
  const projectionAtEnd = baseA.price + slope * (terminal.time - baseA.time) + offset;

  return {
    base: [baseA, baseB],
    through,
    projectionAtEnd,
    // Positive when the terminal pivot pushed through the parallel — a throw-over.
    overshoot: offset >= 0 ? terminal.price - projectionAtEnd : projectionAtEnd - terminal.price,
  };
}

/** `wave 3` / `wave C` — reads better than a bare label in ratio names. */
export function waveWord(tool: ToolId, base: string): string {
  return TOOLS[tool].elliott ? `wave ${base}` : base;
}

/** Ratios that matched their Fibonacci target, best first. */
export function confirmedRatios(metrics: DrawingMetrics): NamedRatio[] {
  return metrics.ratios
    .filter((ratio) => ratio.match.hit)
    .sort((a, b) => a.match.tightness - b.match.tightness);
}
