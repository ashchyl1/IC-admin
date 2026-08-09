/**
 * Fibonacci and Lucas relationships — the price and time tables the wave count
 * is validated against.
 *
 * Everything here is a pure function over numbers, which is what makes the rule
 * engine and the exported analysis testable without a chart.
 *
 * Time tolerance is ±1 bar throughout, per the house rule that a relationship
 * landing one bar either side still counts. Price tolerance is proportional,
 * because being 0.02 away from 0.236 is a miss while being 0.02 away from 2.618
 * is a hit.
 */

export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
export const LUCAS = [3, 4, 7, 11, 18, 29, 47, 76, 123, 199, 322, 521, 843];

/** Retracement levels drawn by the Fibonacci retracement tool. */
export const RETRACEMENT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 0.886, 1];

/** Projection levels drawn by the Fibonacci extension tool. */
export const EXTENSION_LEVELS = [0.618, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236];

/** Ratios a wave-to-wave price comparison is matched against. */
export const PRICE_RATIOS = [
  0.236, 0.382, 0.5, 0.618, 0.786, 0.886, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236,
];

/** Ratios a wave-to-wave *duration* comparison is matched against. */
export const TIME_RATIOS = [
  0.146, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.058, 2.618, 4.236, 6.854,
];

/**
 * Every bar count worth watching for a turn: Fibonacci, Lucas, the square-root
 * derivatives and the 144-multiples, merged and sorted.
 */
export const MASTER_TIME_BARS = Array.from(
  new Set([
    ...FIBONACCI.filter((n) => n >= 5),
    ...LUCAS.filter((n) => n >= 7),
    14, 16, 23, 36, 38, 45, 46, 48, 56, 61, 62, 72, 78, 99, 108, 127, 145, 147, 161, 180, 216, 252,
    288, 324, 360,
  ])
).sort((a, b) => a - b);

export interface RatioMatch {
  /** The observed ratio. */
  value: number;
  /** Nearest table entry, or null when nothing is within tolerance. */
  target: number | null;
  label: string | null;
  /** Signed distance from the target, in ratio units. */
  deviation: number;
  /** How close, as a share of the tolerance band. 0 = exact, 1 = at the edge. */
  tightness: number;
  hit: boolean;
}

/** Proportional tolerance: tight on small ratios, forgiving on large ones. */
export function ratioTolerance(target: number): number {
  return Math.max(0.015, target * 0.025);
}

export function matchRatio(value: number, table: number[] = PRICE_RATIOS): RatioMatch {
  if (!Number.isFinite(value)) {
    return { value, target: null, label: null, deviation: NaN, tightness: 1, hit: false };
  }
  let best: number | null = null;
  let bestDelta = Infinity;
  for (const target of table) {
    const delta = Math.abs(value - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = target;
    }
  }
  if (best === null) {
    return { value, target: null, label: null, deviation: NaN, tightness: 1, hit: false };
  }
  const tolerance = ratioTolerance(best);
  const hit = bestDelta <= tolerance;
  return {
    value,
    target: best,
    label: formatRatio(best),
    deviation: value - best,
    tightness: Math.min(1, bestDelta / tolerance),
    hit,
  };
}

export function formatRatio(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")}×`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ------------------------------------------------------------------ time ---

export type TimeSeriesName = "fibonacci" | "lucas" | "master";

export interface TimeBarMatch {
  bars: number;
  /** Every table entry within ±`tolerance` bars. */
  hits: { series: TimeSeriesName; value: number; delta: number }[];
  hit: boolean;
}

/** Rule 1 of the SOP: all time relationships carry a ±1 bar tolerance. */
export const TIME_TOLERANCE_BARS = 1;

export function matchTimeBars(bars: number, tolerance = TIME_TOLERANCE_BARS): TimeBarMatch {
  const hits: TimeBarMatch["hits"] = [];
  const seen = new Set<string>();

  const scan = (series: TimeSeriesName, table: number[]) => {
    for (const value of table) {
      const delta = bars - value;
      if (Math.abs(delta) > tolerance) continue;
      const key = `${series}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ series, value, delta });
    }
  };

  scan("fibonacci", FIBONACCI);
  scan("lucas", LUCAS);
  scan("master", MASTER_TIME_BARS);

  // A number that is both Fibonacci and "master" should not read as two
  // independent confirmations; keep the specific series and drop the generic.
  const specific = new Set(hits.filter((h) => h.series !== "master").map((h) => h.value));
  const merged = hits.filter((h) => h.series !== "master" || !specific.has(h.value));

  return { bars, hits: merged, hit: merged.length > 0 };
}

export interface TimeCount {
  /** What was measured, e.g. `wave 3 low → wave 5 high`. */
  label: string;
  bars: number;
  match: TimeBarMatch;
}

export interface TimeCluster {
  /** Centre of the cluster, rounded. */
  bars: number;
  members: TimeCount[];
  /** Distinct series names represented — more series, stronger the cluster. */
  strength: number;
}

/**
 * Group counts that land within ±1 bar of one another. Two or more independent
 * counts at the same bar is the SOP's definition of a cluster, and clusters are
 * the whole point of the time layer.
 */
export function findTimeClusters(counts: TimeCount[], tolerance = TIME_TOLERANCE_BARS): TimeCluster[] {
  const significant = counts.filter((count) => count.match.hit);
  const sorted = significant.slice().sort((a, b) => a.bars - b.bars);
  const clusters: TimeCluster[] = [];

  for (const count of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(count.bars - last.members[last.members.length - 1].bars) <= tolerance) {
      last.members.push(count);
    } else {
      clusters.push({ bars: count.bars, members: [count], strength: 0 });
    }
  }

  return clusters
    .filter((cluster) => cluster.members.length >= 2)
    .map((cluster) => ({
      ...cluster,
      bars: Math.round(
        cluster.members.reduce((sum, member) => sum + member.bars, 0) / cluster.members.length
      ),
      strength: cluster.members.length,
    }));
}

/**
 * Fibonacci/Lucas *price* completion: does the total range of a move land on a
 * Fibonacci or Lucas number, at some power of ten? The SOP calls these price
 * number completions (13, 21, 34, 47, 55, 89, 144 …).
 */
export function matchPriceNumber(range: number): { value: number; scale: number } | null {
  if (!Number.isFinite(range) || range <= 0) return null;
  const table = Array.from(new Set([...FIBONACCI, ...LUCAS])).sort((a, b) => a - b);

  for (const scale of [0.01, 0.1, 1, 10, 100]) {
    for (const value of table) {
      const target = value * scale;
      if (target < 0.05) continue;
      if (Math.abs(range - target) <= Math.max(target * 0.01, 0.01)) return { value, scale };
    }
  }
  return null;
}

/** Project the next N key bars forward from a pivot, for the "what to watch" list. */
export function upcomingTimeBars(barsSincePivot: number, count = 5): number[] {
  return MASTER_TIME_BARS.filter((bar) => bar > barsSincePivot).slice(0, count);
}
