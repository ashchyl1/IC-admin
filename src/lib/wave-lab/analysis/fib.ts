/**
 * Fibonacci and Lucas relationships, in price and in time. §6.
 *
 * The time half is what separates a real Elliott tool from a drawing app, and
 * it carries one trap worth stating up front. Fibonacci (1 2 3 5 8 13 21 34…)
 * and Lucas (2 1 3 4 7 11 18 29 47…) together, at ±1 bar, cover almost every
 * integer below roughly twenty: 1-9 are all hits, so is 10, 11, 12, 13, 14…
 * A "match" down there confirms nothing — it is arithmetic, not evidence.
 *
 * So a match carries a `significant` flag, and only significant matches feed
 * the confidence verdict. Insignificant ones are still reported, because an
 * analyst may want to see them, but they are labelled as coincidence.
 */

/** §6's price ratio ladder. */
export const PRICE_RATIOS = [
  0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.618, 4.236,
] as const;

export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377] as const;
export const LUCAS = [2, 1, 3, 4, 7, 11, 18, 29, 47, 76, 123, 199, 322] as const;

/** ±1 bar, per §6. */
export const BAR_TOLERANCE = 1;

/**
 * Below this, the two series are so dense that a hit is meaningless.
 *
 * 13 is where the gaps first exceed the tolerance window often enough for a
 * match to carry information: under it, every integer 1..14 is within ±1 of
 * some Fibonacci or Lucas term.
 */
export const SIGNIFICANCE_FLOOR = 13;

/** How close a price ratio must be to count. 2% of the ratio itself. */
export const RATIO_TOLERANCE = 0.02;

export interface SeriesMatch {
  series: "fibonacci" | "lucas";
  term: number;
  /** Signed difference: actual − term. */
  delta: number;
  /** False when the bar count is small enough that both series blanket it. */
  significant: boolean;
}

/**
 * Match a bar count against both series.
 *
 * Returns every hit rather than the best one — "8 bars, which is Fibonacci 8
 * and one off Lucas 7" is a genuinely different statement from a clean single
 * hit, and the analyst should see both.
 */
export function matchBarCount(bars: number): SeriesMatch[] {
  if (!Number.isFinite(bars) || bars <= 0) return [];
  const out: SeriesMatch[] = [];
  const significant = bars >= SIGNIFICANCE_FLOOR;

  for (const term of FIBONACCI) {
    if (Math.abs(bars - term) <= BAR_TOLERANCE) {
      out.push({ series: "fibonacci", term, delta: bars - term, significant });
    }
  }
  for (const term of LUCAS) {
    if (Math.abs(bars - term) <= BAR_TOLERANCE) {
      out.push({ series: "lucas", term, delta: bars - term, significant });
    }
  }
  return out;
}

/** Only the hits that should move the confidence needle. */
export function significantMatches(bars: number): SeriesMatch[] {
  return matchBarCount(bars).filter((m) => m.significant);
}

export interface RatioMatch {
  ratio: number;
  actual: number;
  /** Signed difference: actual − ratio. */
  delta: number;
}

/** Nearest ratio on the ladder, if the actual lands within tolerance. */
export function matchRatio(actual: number, ratios: readonly number[] = PRICE_RATIOS): RatioMatch | null {
  if (!Number.isFinite(actual)) return null;
  let best: RatioMatch | null = null;
  for (const ratio of ratios) {
    const delta = actual - ratio;
    // Tolerance scales with the ratio: 2% of 4.236 is a wider absolute window
    // than 2% of 0.236, which is the right behaviour — a 4.236 extension is
    // never going to land as tightly as a shallow retracement.
    //
    // The epsilon makes the boundary inclusive in practice. Without it a value
    // that is exactly on the limit can fall outside by float representation
    // alone — 0.51 − 0.5 evaluates to 0.010000000000000009, marginally over
    // 2% of 0.5 — so the documented "within 2%" would quietly not hold at the
    // edge.
    if (Math.abs(delta) <= ratio * RATIO_TOLERANCE + Number.EPSILON * 16) {
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { ratio, actual, delta };
      }
    }
  }
  return best;
}

export interface TimeProjection {
  /** Bar index the projection lands on. */
  barIndex: number;
  /** Index of the pivot it was projected from. */
  fromPivot: number;
  series: "fibonacci" | "lucas";
  term: number;
}

export interface TimeCluster {
  barIndex: number;
  /** How many independent pivots project onto this bar. */
  convergence: number;
  projections: TimeProjection[];
}

/**
 * Project each series term forward from every pivot and find where the
 * projections pile up. §6.
 *
 * Ranked by how many *independent pivots* converge, not by how many
 * projections do: five terms from one pivot is one pivot's opinion, whereas
 * three terms from three different pivots is three. Counting raw projections
 * would rank a single prolific pivot above genuine agreement.
 */
export function timeClusters(
  pivotBarIndices: number[],
  { horizon = 250, minConvergence = 2, window = BAR_TOLERANCE } = {}
): TimeCluster[] {
  const projections: TimeProjection[] = [];
  const terms: { series: "fibonacci" | "lucas"; term: number }[] = [
    ...FIBONACCI.filter((t) => t >= SIGNIFICANCE_FLOOR).map(
      (term) => ({ series: "fibonacci" as const, term })
    ),
    ...LUCAS.filter((t) => t >= SIGNIFICANCE_FLOOR).map((term) => ({ series: "lucas" as const, term })),
  ];

  pivotBarIndices.forEach((pivotBar, fromPivot) => {
    for (const { series, term } of terms) {
      const barIndex = pivotBar + term;
      if (barIndex - pivotBar <= horizon) {
        projections.push({ barIndex, fromPivot, series, term });
      }
    }
  });

  // Bucket by bar, then absorb neighbours within the tolerance window.
  const byBar = new Map<number, TimeProjection[]>();
  for (const p of projections) {
    const list = byBar.get(p.barIndex);
    if (list) list.push(p);
    else byBar.set(p.barIndex, [p]);
  }

  const clusters: TimeCluster[] = [];
  for (const [barIndex] of byBar) {
    const nearby = projections.filter((p) => Math.abs(p.barIndex - barIndex) <= window);
    const pivots = new Set(nearby.map((p) => p.fromPivot));
    if (pivots.size >= minConvergence) {
      clusters.push({ barIndex, convergence: pivots.size, projections: nearby });
    }
  }

  // Strongest first; earlier bar breaks a tie, since a nearer turn window is
  // the more actionable one.
  clusters.sort((a, b) => b.convergence - a.convergence || a.barIndex - b.barIndex);

  // Collapse near-duplicates so the list reads as distinct windows.
  const distinct: TimeCluster[] = [];
  for (const c of clusters) {
    if (!distinct.some((d) => Math.abs(d.barIndex - c.barIndex) <= window)) distinct.push(c);
  }
  return distinct;
}

/** The next few series terms beyond `barsSince`, for the "turn approaching" hint. */
export function upcomingBarCounts(barsSince: number, count = 3): number[] {
  const all = [...new Set([...FIBONACCI, ...LUCAS])]
    .filter((t) => t > barsSince && t >= SIGNIFICANCE_FLOOR)
    .sort((a, b) => a - b);
  return all.slice(0, count);
}
