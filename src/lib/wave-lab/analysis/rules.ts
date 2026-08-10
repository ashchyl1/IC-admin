/**
 * The rule engine. §5.
 *
 * Hard rules and guidelines are kept strictly apart, because they mean
 * different things. A hard-rule breach says the count is *wrong* — not
 * unlikely, wrong — and is reported in red with the exact price that would
 * repair it. A guideline breach says the count is unusual, which is worth
 * knowing and no more.
 *
 * Every result carries a sentence. §5 is explicit that a score tells an
 * analyst nothing: they need to know *which* guideline failed and by how much,
 * because that is what they act on.
 */

import { allowsOverlap, type Drawing } from "../drawings/tools";
import type { MarketCandle } from "../types";
import {
  matchBarCount,
  matchRatio,
  significantMatches,
  timeClusters,
  upcomingBarCounts,
  type SeriesMatch,
  type TimeCluster,
} from "./fib";

export type RuleStatus = "pass" | "fail" | "not-applicable";

export interface RuleResult {
  id: string;
  kind: "hard" | "guideline";
  label: string;
  status: RuleStatus;
  /** A sentence the analyst can act on. */
  detail: string;
  /** Present on a hard failure: the level that would satisfy the rule. */
  fixPrice?: number;
}

export interface LegMeasure {
  /** "1".."5", "A".."E", "W".."Z". */
  label: string;
  from: { time: number; price: number };
  to: { time: number; price: number };
  points: number;
  percent: number;
  bars: number;
  matches: SeriesMatch[];
}

export type Confidence = "High" | "Medium" | "Low" | "Invalid";

export interface Analysis {
  results: RuleResult[];
  confidence: Confidence;
  /** Sentences, in the order they should be read. */
  reasoning: string[];
  invalidation: { price: number; rationale: string } | null;
  legs: LegMeasure[];
  clusters: TimeCluster[];
  barsSinceLastPivot: number | null;
  upcoming: number[];
}

/** Nearest bar to a chart time. Pivots need not sit exactly on a bar. */
export function barIndexAt(candles: MarketCandle[], time: number): number {
  if (!candles.length) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  // Snap to whichever neighbour is closer.
  if (lo > 0 && Math.abs(candles[lo - 1].time - time) < Math.abs(candles[lo].time - time)) {
    return lo - 1;
  }
  return lo;
}

const money = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Measure each leg once; every rule reads from this. */
function measureLegs(drawing: Drawing, candles: MarketCandle[], labels: string[]): LegMeasure[] {
  const out: LegMeasure[] = [];
  for (let i = 0; i < drawing.pivots.length - 1; i++) {
    const from = drawing.pivots[i];
    const to = drawing.pivots[i + 1];
    const points = to.price - from.price;
    const fromBar = barIndexAt(candles, from.time);
    const toBar = barIndexAt(candles, to.time);
    const bars = fromBar >= 0 && toBar >= 0 ? Math.abs(toBar - fromBar) : 0;
    out.push({
      label: labels[i] ?? String(i + 1),
      from,
      to,
      points,
      percent: from.price ? points / from.price : 0,
      bars,
      matches: matchBarCount(bars),
    });
  }
  return out;
}

/**
 * Analyse a completed structure.
 *
 * Returns `null` for anything still being placed — a partial count has no
 * verdict to give, and inventing one would train the analyst to ignore it.
 */
export function analyse(drawing: Drawing, candles: MarketCandle[]): Analysis | null {
  if (!drawing.complete || drawing.pivots.length < 2) return null;

  switch (drawing.kind) {
    case "impulse":
      return analyseImpulse(drawing, candles);
    case "correction":
      return analyseCorrection(drawing, candles);
    case "triangle":
      return analyseTriangle(drawing, candles);
    default:
      return null;
  }
}

/* -------------------------------------------------------------- impulse -- */

function analyseImpulse(drawing: Drawing, candles: MarketCandle[]): Analysis {
  const p = drawing.pivots;
  const legs = measureLegs(drawing, candles, ["1", "2", "3", "4", "5"]);
  const results: RuleResult[] = [];

  // Direction is taken from wave 1, and every later rule is expressed in terms
  // of it, so the same code serves bull and bear counts.
  const dir = Math.sign(p[1].price - p[0].price) || 1;
  const up = dir > 0;
  const len = (i: number) => Math.abs(legs[i].points);
  const diagonal = allowsOverlap(drawing);

  // ---- hard: alternation -------------------------------------------------
  const expected = [dir, -dir, dir, -dir, dir];
  const wrong = legs
    .map((leg, i) => ({ leg, i }))
    .filter(({ leg, i }) => Math.sign(leg.points) !== expected[i]);
  results.push({
    id: "alternation",
    kind: "hard",
    label: "Legs alternate direction",
    status: wrong.length ? "fail" : "pass",
    detail: wrong.length
      ? `Wave ${wrong.map((w) => w.leg.label).join(" and ")} ${
          wrong.length > 1 ? "run" : "runs"
        } the wrong way for ${up ? "an upward" : "a downward"} impulse. That is a mislabelled pivot, not a rule breach — recheck which highs and lows the count is anchored to.`
      : `Waves 1, 3 and 5 all run ${up ? "up" : "down"} with 2 and 4 against them.`,
  });

  // ---- hard: wave 2 retracement ------------------------------------------
  const w2Beyond = up ? p[2].price <= p[0].price : p[2].price >= p[0].price;
  const w2Retrace = len(0) ? len(1) / len(0) : 0;
  results.push({
    id: "wave2-100",
    kind: "hard",
    label: "Wave 2 never retraces more than 100% of wave 1",
    status: w2Beyond ? "fail" : "pass",
    detail: w2Beyond
      ? `Wave 2 ended at ${money(p[2].price)}, ${up ? "below" : "above"} wave 1's origin at ${money(
          p[0].price
        )}. The count is dead unless wave 2 ends ${up ? "above" : "below"} ${money(p[0].price)}.`
      : `Wave 2 retraced ${pct(w2Retrace)} of wave 1, inside the 100% limit.`,
    fixPrice: w2Beyond ? p[0].price : undefined,
  });

  // ---- hard: wave 3 not the shortest -------------------------------------
  const shortest = len(2) < len(0) && len(2) < len(4);
  const needed = Math.min(len(0), len(4));
  const w3Target = p[2].price + dir * needed;
  results.push({
    id: "wave3-shortest",
    kind: "hard",
    label: "Wave 3 is never the shortest of 1, 3 and 5",
    status: shortest ? "fail" : "pass",
    detail: shortest
      ? `Wave 3 spans ${money(len(2))} points against wave 1's ${money(len(0))} and wave 5's ${money(
          len(4)
        )} — the shortest of the three. Wave 3 would have to reach ${money(
          w3Target
        )} to clear it.`
      : `Wave 3 spans ${money(len(2))} points, against wave 1's ${money(
          len(0)
        )} and wave 5's ${money(len(4))}.`,
    fixPrice: shortest ? w3Target : undefined,
  });

  // ---- hard: wave 4 out of wave 1's territory ----------------------------
  // Skipped for diagonals, which permit the overlap by definition (§4.2).
  const overlaps = up ? p[4].price <= p[1].price : p[4].price >= p[1].price;
  results.push({
    id: "wave4-overlap",
    kind: "hard",
    label: "Wave 4 never enters wave 1's price territory",
    status: diagonal ? "not-applicable" : overlaps ? "fail" : "pass",
    detail: diagonal
      ? `Not applied: a ${drawing.variant.replace("-", " ")} permits wave 4 to overlap wave 1.`
      : overlaps
        ? `Wave 4 ended at ${money(p[4].price)}, inside wave 1's territory which tops at ${money(
            p[1].price
          )}. Either wave 4 must hold ${up ? "above" : "below"} ${money(
            p[1].price
          )}, or this is a diagonal — switch the variant if so.`
        : `Wave 4 ended at ${money(p[4].price)}, clear of wave 1's extreme at ${money(p[1].price)}.`,
    fixPrice: !diagonal && overlaps ? p[1].price : undefined,
  });

  // ---- guidelines --------------------------------------------------------
  results.push(
    ratioGuideline("wave2-retrace", "Wave 2 typically retraces 50–61.8% of wave 1", w2Retrace, [
      0.5, 0.618,
    ]),
    ratioGuideline(
      "wave4-retrace",
      "Wave 4 typically retraces 38.2% of wave 3",
      len(2) ? len(3) / len(2) : 0,
      [0.382]
    ),
    ratioGuideline(
      "wave3-extension",
      "Wave 3 is most often 1.618× wave 1, or 2.618× when extended",
      len(0) ? len(2) / len(0) : 0,
      [1.618, 2.618]
    ),
    ratioGuideline("wave5-equality", "Wave 5 is often equal to wave 1", len(0) ? len(4) / len(0) : 0, [
      1.0,
    ])
  );

  // Alternation of form: a sharp 2 usually pairs with a flat 4.
  const sharp2 = w2Retrace >= 0.5;
  const flat4 = (len(2) ? len(3) / len(2) : 0) <= 0.382;
  results.push({
    id: "alternation-form",
    kind: "guideline",
    label: "Alternation — a sharp wave 2 pairs with a flat wave 4",
    status: sharp2 === flat4 ? "pass" : "fail",
    detail:
      sharp2 === flat4
        ? `Wave 2 is ${sharp2 ? "sharp" : "shallow"} and wave 4 is ${
            flat4 ? "flat" : "deep"
          }, which alternate as expected.`
        : `Wave 2 is ${sharp2 ? "sharp" : "shallow"} and wave 4 is ${
            flat4 ? "flat" : "deep"
          } — both of the same character, where Elliott expects them to alternate.`,
  });

  // Volume: peaks in 3, diverges in 5.
  results.push(volumeGuideline(legs, candles));

  return assemble(drawing, candles, results, legs, up);
}

/* ----------------------------------------------------------- correction -- */

function analyseCorrection(drawing: Drawing, candles: MarketCandle[]): Analysis {
  const p = drawing.pivots;
  const legs = measureLegs(drawing, candles, ["A", "B", "C"]);
  const results: RuleResult[] = [];
  const dir = Math.sign(p[1].price - p[0].price) || 1;
  const down = dir < 0;

  const expected = [dir, -dir, dir];
  const wrong = legs.filter((leg, i) => Math.sign(leg.points) !== expected[i]);
  results.push({
    id: "abc-alternation",
    kind: "hard",
    label: "A, B and C alternate correctly",
    status: wrong.length ? "fail" : "pass",
    detail: wrong.length
      ? `Wave ${wrong.map((w) => w.label).join(" and ")} runs the wrong way for a three-leg correction.`
      : "A and C run together with B against them, as a correction requires.",
  });

  // Zigzag only: B must not retrace beyond A's origin.
  const isZigzag = drawing.variant === "zigzag";
  const bBeyond = down ? p[2].price >= p[0].price : p[2].price <= p[0].price;
  results.push({
    id: "zigzag-b",
    kind: "hard",
    label: "Zigzag — B does not retrace beyond A's origin",
    status: !isZigzag ? "not-applicable" : bBeyond ? "fail" : "pass",
    detail: !isZigzag
      ? `Not applied: a ${drawing.variant.replace("-", " ")} allows B to exceed A's origin.`
      : bBeyond
        ? `B reached ${money(p[2].price)}, past A's origin at ${money(
            p[0].price
          )}. As a zigzag this is dead; as an expanded or running flat it is expected — switch the variant if so.`
        : `B held at ${money(p[2].price)}, short of A's origin at ${money(p[0].price)}.`,
    fixPrice: isZigzag && bBeyond ? p[0].price : undefined,
  });

  const aLen = Math.abs(legs[0].points);
  results.push(
    ratioGuideline("c-equals-a", "C is often equal to A, or 1.618× A", aLen ? Math.abs(legs[2].points) / aLen : 0, [
      1.0, 1.618,
    ]),
    ratioGuideline("b-retrace", "B typically retraces 50–78.6% of A", aLen ? Math.abs(legs[1].points) / aLen : 0, [
      0.5, 0.618, 0.786,
    ])
  );

  return assemble(drawing, candles, results, legs, !down);
}

/* ------------------------------------------------------------- triangle -- */

function analyseTriangle(drawing: Drawing, candles: MarketCandle[]): Analysis {
  const p = drawing.pivots;
  const legs = measureLegs(drawing, candles, ["A", "B", "C", "D", "E"]);
  const results: RuleResult[] = [];
  const contracting = drawing.variant === "contracting";
  const len = (i: number) => Math.abs(legs[i].points);

  // Each leg shorter than the one two before it: C<A, D<B, E<C.
  const pairs: [number, number][] = [
    [2, 0],
    [3, 1],
    [4, 2],
  ];
  const breaches = pairs.filter(([a, b]) => len(a) >= len(b));
  results.push({
    id: "triangle-contraction",
    kind: "hard",
    label: "Contracting triangle — each leg is shorter than the one two before",
    status: !contracting ? "not-applicable" : breaches.length ? "fail" : "pass",
    detail: !contracting
      ? `Not applied: a ${drawing.variant} triangle does not contract on every leg.`
      : breaches.length
        ? breaches
            .map(
              ([a, b]) =>
                `Leg ${legs[a].label} spans ${money(len(a))} points against leg ${
                  legs[b].label
                }'s ${money(len(b))}, so it is not contracting.`
            )
            .join(" ")
        : "Every leg is shorter than the one two before it.",
  });

  // E must stay inside C.
  const dirE = Math.sign(legs[4].points) || 1;
  const eBeyond = dirE > 0 ? p[5].price > p[3].price : p[5].price < p[3].price;
  results.push({
    id: "triangle-e",
    kind: "hard",
    label: "E stays inside C",
    status: !contracting ? "not-applicable" : eBeyond ? "fail" : "pass",
    detail: !contracting
      ? "Not applied for this triangle variant."
      : eBeyond
        ? `E ended at ${money(p[5].price)}, past C at ${money(
            p[3].price
          )}. E must finish short of C for a contracting triangle.`
        : `E ended at ${money(p[5].price)}, inside C at ${money(p[3].price)}.`,
    fixPrice: contracting && eBeyond ? p[3].price : undefined,
  });

  // Post-triangle thrust ≈ the widest leg, measured from the breakout.
  const widest = Math.max(...legs.map((l) => Math.abs(l.points)));
  results.push({
    id: "triangle-thrust",
    kind: "guideline",
    label: "Post-triangle thrust approximates the widest leg",
    status: "pass",
    detail: `The widest leg spans ${money(
      widest
    )} points, so expect a thrust of about that from the breakout.`,
  });

  return assemble(drawing, candles, results, legs, dirE > 0);
}

/* ---------------------------------------------------------------- shared -- */

function ratioGuideline(
  id: string,
  label: string,
  actual: number,
  targets: number[]
): RuleResult {
  const match = matchRatio(actual, targets);
  return {
    id,
    kind: "guideline",
    label,
    status: match ? "pass" : "fail",
    detail: match
      ? `Measured ${pct(actual)}, which lands on ${pct(match.ratio)}.`
      : `Measured ${pct(actual)}, against an expected ${targets.map(pct).join(" or ")}.`,
  };
}

function volumeGuideline(legs: LegMeasure[], candles: MarketCandle[]): RuleResult {
  if (legs.length < 5 || !candles.length) {
    return {
      id: "volume",
      kind: "guideline",
      label: "Volume peaks in wave 3 and diverges in wave 5",
      status: "not-applicable",
      detail: "Not enough volume data to judge.",
    };
  }
  const avg = (leg: LegMeasure) => {
    const a = barIndexAt(candles, leg.from.time);
    const b = barIndexAt(candles, leg.to.time);
    const slice = candles.slice(Math.min(a, b), Math.max(a, b) + 1);
    return slice.length ? slice.reduce((s, c) => s + c.volume, 0) / slice.length : 0;
  };
  const v3 = avg(legs[2]);
  const v5 = avg(legs[4]);
  const peaks = v3 >= avg(legs[0]) && v3 >= v5;
  return {
    id: "volume",
    kind: "guideline",
    label: "Volume peaks in wave 3 and diverges in wave 5",
    status: peaks ? "pass" : "fail",
    detail: peaks
      ? `Wave 3 carried the heaviest average volume, with wave 5 lighter — the usual signature.`
      : `Wave 3 did not carry the heaviest volume, which is unusual for a genuine third wave.`,
  };
}

/** Roll rules, time analysis and the invalidation level into a verdict. */
function assemble(
  drawing: Drawing,
  candles: MarketCandle[],
  results: RuleResult[],
  legs: LegMeasure[],
  up: boolean
): Analysis {
  const hardFails = results.filter((r) => r.kind === "hard" && r.status === "fail");
  const guidelinePasses = results.filter((r) => r.kind === "guideline" && r.status === "pass");

  const timeHits = legs.flatMap((l) => significantMatches(l.bars));
  const pivotBars = drawing.pivots.map((p) => barIndexAt(candles, p.time));
  const clusters = timeClusters(pivotBars).slice(0, 5);

  const lastPivotBar = pivotBars[pivotBars.length - 1] ?? -1;
  const barsSinceLastPivot =
    lastPivotBar >= 0 && candles.length ? candles.length - 1 - lastPivotBar : null;

  const reasoning: string[] = [];
  let confidence: Confidence;

  if (hardFails.length) {
    confidence = "Invalid";
    reasoning.push(
      `${hardFails.length} hard rule${hardFails.length > 1 ? "s" : ""} broken — this count cannot stand as labelled.`
    );
    for (const f of hardFails) reasoning.push(f.detail);
  } else {
    // Fibonacci price relationships AND time relationships both count, per §5.
    const score = guidelinePasses.length + timeHits.length;
    confidence = score >= 5 ? "High" : score >= 3 ? "Medium" : "Low";
    reasoning.push("Every hard rule holds.");
    reasoning.push(
      `${guidelinePasses.length} of ${
        results.filter((r) => r.kind === "guideline" && r.status !== "not-applicable").length
      } guidelines land.`
    );
    reasoning.push(
      timeHits.length
        ? `${timeHits.length} leg${timeHits.length > 1 ? "s" : ""} span a clean Fibonacci or Lucas bar count.`
        : "No leg spans a clean Fibonacci or Lucas bar count — short legs are excluded because both series blanket the small numbers."
    );
    for (const g of results.filter((r) => r.kind === "guideline" && r.status === "fail")) {
      reasoning.push(g.detail);
    }
  }

  return {
    results,
    confidence,
    reasoning,
    invalidation: invalidationFor(drawing, up, hardFails),
    legs,
    clusters,
    barsSinceLastPivot,
    upcoming: barsSinceLastPivot === null ? [] : upcomingBarCounts(barsSinceLastPivot),
  };
}

/**
 * The single level at which this count is dead. §5 calls it the most
 * actionable output the app produces, so it is always present for a structure
 * that has one.
 */
function invalidationFor(
  drawing: Drawing,
  up: boolean,
  hardFails: RuleResult[]
): { price: number; rationale: string } | null {
  // If a hard rule is already broken, the level that would have saved it is
  // the honest thing to show.
  const withFix = hardFails.find((f) => f.fixPrice !== undefined);
  if (withFix?.fixPrice !== undefined) {
    return {
      price: withFix.fixPrice,
      rationale: `Already breached — ${withFix.label.toLowerCase()} needed ${money(withFix.fixPrice)}.`,
    };
  }

  const p = drawing.pivots;
  if (drawing.kind === "impulse" && p.length >= 5) {
    // After five waves the actionable level is wave 4's extreme: through it,
    // the impulse is over and the count needs revisiting.
    return {
      price: p[4].price,
      rationale: `A ${up ? "close below" : "close above"} wave 4 at ${money(
        p[4].price
      )} ends this impulse.`,
    };
  }
  if (drawing.kind === "correction" && p.length >= 4) {
    return {
      price: p[0].price,
      rationale: `A move ${up ? "below" : "above"} A's origin at ${money(
        p[0].price
      )} invalidates the correction.`,
    };
  }
  if (drawing.kind === "triangle" && p.length >= 6) {
    return {
      price: p[3].price,
      rationale: `Price beyond C at ${money(p[3].price)} breaks the triangle.`,
    };
  }
  return null;
}
