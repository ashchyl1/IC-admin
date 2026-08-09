import { describe, expect, it } from "vitest";

import type { MarketCandle } from "@/lib/market/types";
import { decorateLabel, childDegree, parentDegree } from "@/lib/wave/degrees";
import {
  findTimeClusters,
  matchPriceNumber,
  matchRatio,
  matchTimeBars,
  upcomingTimeBars,
} from "@/lib/wave/fib";
import { bollinger, ema, heikinAshi, sma } from "@/lib/wave/indicators";
import { distanceToSegment, hitTest } from "@/lib/wave/hit";
import { computeMetrics } from "@/lib/wave/metrics";
import { validate } from "@/lib/wave/rules";
import { barIndexer, type Drawing, type WavePoint } from "@/lib/wave/types";
import { TOOLS } from "@/lib/wave/patterns";

/**
 * Daily bars on a flat 1-minute-apart grid. The rule engine only ever asks the
 * bar index for a position, so evenly spaced synthetic times keep the bar
 * counts in these tests exactly the numbers written in them.
 */
function candlesFor(points: WavePoint[], extra = 40): MarketCandle[] {
  const last = points[points.length - 1]?.time ?? 0;
  const first = points[0]?.time ?? 0;
  const out: MarketCandle[] = [];
  for (let t = first; t <= last + extra * 86_400; t += 86_400) {
    out.push({ time: t, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  return out;
}

const DAY = 86_400;

function drawing(
  tool: Drawing["tool"],
  prices: number[],
  options: { variant?: string; degree?: Drawing["degree"]; bars?: number[] } = {}
): Drawing {
  const bars = options.bars ?? prices.map((_, i) => i * 10);
  return {
    id: "test",
    tool,
    degree: options.degree ?? "intermediate",
    variant: options.variant,
    points: prices.map((price, i) => ({ time: bars[i] * DAY, price })),
    createdAt: 0,
    updatedAt: 0,
  };
}

function check(entry: Drawing) {
  const candles = candlesFor(entry.points);
  const metrics = computeMetrics(entry, candles, barIndexer(candles));
  if (!metrics) throw new Error("no metrics");
  return { metrics, validation: validate(entry, metrics) };
}

const idOf = (results: { id: string; status: string }[], id: string) =>
  results.find((result) => result.id === id);

// ---------------------------------------------------------------- impulse ---

describe("impulse rules", () => {
  // 0 → 1 up, 2 back, 3 extended, 4 shallow, 5 up. A textbook count.
  const CLEAN = [100, 130, 118, 170, 155, 185];

  it("passes a textbook impulse", () => {
    const { validation } = check(drawing("impulse", CLEAN));
    expect(validation.hardFailures).toBe(0);
    expect(idOf(validation.results, "impulse.wave2-retracement")?.status).toBe("pass");
    expect(idOf(validation.results, "impulse.wave3-not-shortest")?.status).toBe("pass");
    expect(idOf(validation.results, "impulse.wave4-overlap")?.status).toBe("pass");
    expect(validation.tier).not.toBe("Pass");
  });

  it("fails when wave 2 retraces past the start of wave 1", () => {
    const { validation } = check(drawing("impulse", [100, 130, 98, 170, 155, 185]));
    expect(idOf(validation.results, "impulse.wave2-retracement")?.status).toBe("fail");
    expect(validation.hardFailures).toBeGreaterThan(0);
    expect(validation.tier).toBe("Pass");
  });

  it("fails when wave 4 enters wave 1's territory", () => {
    // Wave 4 ends at 128, below wave 1's high of 130.
    const { validation } = check(drawing("impulse", [100, 130, 118, 170, 128, 185]));
    expect(idOf(validation.results, "impulse.wave4-overlap")?.status).toBe("fail");
    expect(validation.tier).toBe("Pass");
  });

  it("allows the same overlap when the variant is a diagonal", () => {
    const { validation } = check(
      drawing("impulse", [100, 130, 118, 170, 128, 185], { variant: "endingDiagonal" })
    );
    expect(idOf(validation.results, "impulse.wave4-overlap")?.status).toBe("pass");
    expect(validation.hardFailures).toBe(0);
  });

  it("fails when wave 3 is the shortest motive wave", () => {
    // 1 = 40, 3 = 20, 5 = 45.
    const { validation } = check(drawing("impulse", [100, 140, 130, 150, 145, 190]));
    expect(idOf(validation.results, "impulse.wave3-not-shortest")?.status).toBe("fail");
  });

  it("reads a bearish impulse the same way", () => {
    const { validation } = check(drawing("impulse", [200, 170, 182, 130, 145, 115]));
    expect(validation.hardFailures).toBe(0);
    expect(idOf(validation.results, "impulse.alternating-direction")?.status).toBe("pass");
  });

  it("flags a truncated fifth", () => {
    const { validation } = check(drawing("impulse", [100, 130, 118, 170, 155, 168]));
    expect(idOf(validation.results, "impulse.truncation")?.status).toBe("warn");
  });

  it("warns when waves 2 and 4 fail to alternate", () => {
    // Both corrections retrace ~38% over the same number of bars.
    const entry = drawing("impulse", [100, 140, 125, 190, 165, 205], {
      bars: [0, 10, 20, 30, 40, 50],
    });
    const { validation } = check(entry);
    expect(idOf(validation.results, "impulse.alternation")?.status).toBe("warn");
  });

  it("names the wave-1 high as the invalidation once wave 3 exists", () => {
    const { validation } = check(drawing("impulse", CLEAN));
    expect(validation.invalidation?.price).toBe(130);
  });
});

// ------------------------------------------------------------- correction ---

describe("correction rules", () => {
  it("passes a zigzag whose B holds inside A", () => {
    const { validation } = check(drawing("correction", [200, 150, 175, 130], { variant: "zigzag" }));
    expect(validation.hardFailures).toBe(0);
    expect(idOf(validation.results, "abc.zigzag-b")?.status).toBe("pass");
  });

  it("fails a zigzag whose B passes the origin of A", () => {
    const { validation } = check(drawing("correction", [200, 150, 210, 130], { variant: "zigzag" }));
    expect(idOf(validation.results, "abc.zigzag-b")?.status).toBe("fail");
  });

  it("wants a deep B in a flat", () => {
    const shallow = check(drawing("correction", [200, 150, 168, 140], { variant: "flat" }));
    expect(idOf(shallow.validation.results, "abc.flat-b")?.status).toBe("warn");

    const deep = check(drawing("correction", [200, 150, 197, 140], { variant: "flat" }));
    expect(idOf(deep.validation.results, "abc.flat-b")?.status).toBe("pass");
  });

  it("distinguishes an expanded flat from a running one", () => {
    const expanded = check(drawing("correction", [200, 150, 210, 130], { variant: "expandedFlat" }));
    expect(idOf(expanded.validation.results, "abc.expanded-c")?.status).toBe("pass");

    const running = check(drawing("correction", [200, 150, 210, 160], { variant: "runningFlat" }));
    expect(idOf(running.validation.results, "abc.running-c")?.status).toBe("pass");
  });

  it("rejects a three-leg shape whose C does not resume A's direction", () => {
    const { validation } = check(drawing("correction", [200, 150, 175, 190]));
    expect(idOf(validation.results, "abc.shape")?.status).toBe("fail");
  });
});

// --------------------------------------------------------------- triangle ---

describe("triangle rules", () => {
  // Contracting: legs 50, 30, 25, 15, 12 with alternating direction.
  const CONTRACTING = [200, 150, 180, 155, 170, 158];

  it("passes a contracting triangle", () => {
    const { validation } = check(drawing("triangle", CONTRACTING, { variant: "contracting" }));
    expect(validation.hardFailures).toBe(0);
    expect(idOf(validation.results, "triangle.alternating")?.status).toBe("pass");
    expect(idOf(validation.results, "triangle.contraction")?.status).toBe("pass");
  });

  it("fails when wave E breaks past wave C", () => {
    const { validation } = check(
      drawing("triangle", [200, 150, 180, 155, 170, 145], { variant: "contracting" })
    );
    expect(idOf(validation.results, "triangle.e-within-c")?.status).toBe("fail");
  });

  it("fails when two adjacent legs run the same way", () => {
    const { validation } = check(drawing("triangle", [200, 150, 140, 155, 170, 158]));
    expect(idOf(validation.results, "triangle.alternating")?.status).toBe("fail");
  });

  it("checks the barrier variant's flat side", () => {
    const { validation } = check(
      drawing("triangle", [200, 150, 180, 156, 180.5, 162], { variant: "barrier" })
    );
    expect(idOf(validation.results, "triangle.barrier")?.status).toBe("pass");
  });
});

// ------------------------------------------------------------ WXY / WXYXZ ---

describe("combination rules", () => {
  it("passes a double zigzag with Y near equality to W", () => {
    const { validation } = check(drawing("doubleCombo", [200, 150, 175, 126]));
    expect(validation.hardFailures).toBe(0);
    expect(idOf(validation.results, "combo.y-equals-w")?.status).toBe("pass");
  });

  it("fails when an X wave runs with the correction", () => {
    const { validation } = check(drawing("doubleCombo", [200, 150, 140, 120]));
    expect(idOf(validation.results, "combo.alternating")?.status).toBe("fail");
  });

  it("measures Z against W in a triple combination", () => {
    const { validation } = check(drawing("tripleCombo", [200, 150, 170, 130, 150, 100]));
    expect(idOf(validation.results, "combo.z-equals-w")?.status).toBe("pass");
  });
});

// ---------------------------------------------------------------- metrics ---

describe("metrics", () => {
  it("measures legs in price, percent and bars", () => {
    const entry = drawing("impulse", [100, 130, 118, 170, 155, 185], {
      bars: [0, 8, 13, 34, 42, 55],
    });
    const { metrics } = check(entry);

    expect(metrics.legs).toHaveLength(5);
    expect(metrics.legs[0].change).toBe(30);
    expect(metrics.legs[0].bars).toBe(8);
    expect(metrics.legs[1].direction).toBe(-1);
    expect(metrics.legs[2].bars).toBe(21);
    expect(metrics.totalBars).toBe(55);
    expect(metrics.totalRange).toBe(85);
    expect(metrics.direction).toBe(1);
  });

  it("finds the wave 3 ÷ wave 1 ratio and matches it to 1.618", () => {
    // wave 1 = 30, wave 3 = 48.54 ≈ 1.618 × 30.
    const { metrics } = check(drawing("impulse", [100, 130, 118, 166.54, 155, 185]));
    const ratio = metrics.ratios.find((entry) => entry.key === "price:3/1");
    expect(ratio?.match.target).toBe(1.618);
    expect(ratio?.match.hit).toBe(true);
  });

  it("clusters independent time counts that land on the same bar", () => {
    // Leg durations chosen so several counts land on 21.
    const entry = drawing("impulse", [100, 130, 118, 170, 155, 185], {
      bars: [0, 21, 34, 55, 68, 89],
    });
    const { metrics } = check(entry);
    expect(metrics.timeCounts.some((count) => count.bars === 21 && count.match.hit)).toBe(true);
    expect(metrics.clusters.length).toBeGreaterThan(0);
  });

  it("projects a channel through wave 3", () => {
    const { metrics } = check(drawing("impulse", [100, 130, 118, 170, 155, 185]));
    expect(metrics.channel).not.toBeNull();
    expect(metrics.channel?.base[0].price).toBe(118);
    expect(metrics.channel?.base[1].price).toBe(155);
  });

  it("returns null for a non-Elliott tool", () => {
    const candles = candlesFor([{ time: 0, price: 1 }]);
    expect(computeMetrics(drawing("trendline", [100, 120]), candles)).toBeNull();
  });
});

// -------------------------------------------------- Fibonacci and Lucas ---

describe("fibonacci and lucas tables", () => {
  it("matches a ratio inside its proportional tolerance", () => {
    expect(matchRatio(0.62).target).toBe(0.618);
    expect(matchRatio(0.62).hit).toBe(true);
    expect(matchRatio(0.55).hit).toBe(false);
    // Tolerance widens with the target, so 2.6 still reads as 2.618.
    expect(matchRatio(2.6).hit).toBe(true);
  });

  it("honours the ±1 bar tolerance on time counts", () => {
    expect(matchTimeBars(34).hit).toBe(true);
    expect(matchTimeBars(35).hit).toBe(true);
    // 26 falls in a genuine gap: 23 and 29 are the nearest entries either side.
    expect(matchTimeBars(26).hit).toBe(false);
    expect(matchTimeBars(47).hits.some((hit) => hit.series === "lucas")).toBe(true);
  });

  it("separates a Fibonacci/Lucas hit from a generic key-bar hit", () => {
    // The master list is dense below ~60, so "landed on some key bar" is weak
    // evidence; the tier logic only counts named-series hits for this reason.
    expect(matchTimeBars(36).hits.every((hit) => hit.series === "master")).toBe(true);
    expect(matchTimeBars(55).hits.some((hit) => hit.series === "fibonacci")).toBe(true);
  });

  it("does not double-count a number present in two tables", () => {
    const match = matchTimeBars(89);
    const values = match.hits.map((hit) => hit.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("needs two counts before calling something a cluster", () => {
    const one = findTimeClusters([{ label: "a", bars: 34, match: matchTimeBars(34) }]);
    expect(one).toHaveLength(0);

    const two = findTimeClusters([
      { label: "a", bars: 34, match: matchTimeBars(34) },
      { label: "b", bars: 35, match: matchTimeBars(35) },
    ]);
    expect(two).toHaveLength(1);
    expect(two[0].strength).toBe(2);
  });

  it("spots a Fibonacci or Lucas price completion at any scale", () => {
    expect(matchPriceNumber(144)?.value).toBe(144);
    expect(matchPriceNumber(4.7)?.value).toBe(47);
    expect(matchPriceNumber(101.3)).toBeNull();
  });

  it("lists the next key bars to watch", () => {
    expect(upcomingTimeBars(30, 3)).toEqual([34, 36, 38]);
  });
});

// ------------------------------------------------------------- indicators ---

describe("indicators", () => {
  const flat: MarketCandle[] = Array.from({ length: 30 }, (_, i) => ({
    time: i * DAY,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 10,
  }));

  it("pads a moving average until its period fills", () => {
    const values = sma([1, 2, 3, 4, 5], 3);
    expect(values[0]).toBeNull();
    expect(values[1]).toBeNull();
    expect(values[2]).toBe(2);
    expect(values[4]).toBe(4);
  });

  it("collapses Bollinger Bands onto the basis when price does not move", () => {
    const bands = bollinger(flat, { period: 20, stdDev: 2, source: "close" });
    expect(bands.basis[19]).toBe(100);
    expect(bands.upper[19]).toBe(100);
    expect(bands.lower[19]).toBe(100);
    expect(bands.bandwidth[19]).toBe(0);
  });

  it("puts price at the upper band when it closes there", () => {
    const rising = flat.map((candle, i) => ({ ...candle, close: 100 + i, high: 100 + i, low: 100 + i }));
    const bands = bollinger(rising, { period: 20, stdDev: 2, source: "close" });
    const last = bands.percentB[rising.length - 1];
    expect(last).not.toBeNull();
    expect(last!).toBeGreaterThan(0.9);
  });

  it("uses HLC/3 when asked", () => {
    const shaped = flat.map((candle) => ({ ...candle, high: 110, low: 90, close: 100 }));
    const close = bollinger(shaped, { period: 20, stdDev: 2, source: "close" });
    const hlc3 = bollinger(shaped, { period: 20, stdDev: 2, source: "hlc3" });
    expect(close.basis[19]).toBe(100);
    expect(hlc3.basis[19]).toBeCloseTo(100, 6);
  });

  it("seeds an EMA only once its period has closed", () => {
    const values = ema([1, 2, 3, 4, 5, 6], 3);
    expect(values[1]).toBeNull();
    expect(values[2]).toBe(2);
    expect(values[5]).toBeGreaterThan(4);
  });

  it("derives Heikin-Ashi bars from the real ones", () => {
    const source: MarketCandle[] = [
      { time: 0, open: 100, high: 110, low: 95, close: 105, volume: 1 },
      { time: DAY, open: 105, high: 115, low: 100, close: 112, volume: 1 },
    ];
    const ha = heikinAshi(source);
    expect(ha[0].close).toBe((100 + 110 + 95 + 105) / 4);
    expect(ha[1].open).toBe((ha[0].open + ha[0].close) / 2);
    expect(ha[1].high).toBeGreaterThanOrEqual(ha[1].close);
  });
});

// ----------------------------------------------------------------- degrees ---

describe("degree notation", () => {
  it("decorates numerals per degree tier", () => {
    expect(decorateLabel("3", "grandSupercycle")).toBe("[III]");
    expect(decorateLabel("3", "supercycle")).toBe("(III)");
    expect(decorateLabel("3", "cycle")).toBe("III");
    expect(decorateLabel("3", "primary")).toBe("③");
    expect(decorateLabel("3", "intermediate")).toBe("(3)");
    expect(decorateLabel("3", "minor")).toBe("3");
    expect(decorateLabel("3", "minute")).toBe("[iii]");
    expect(decorateLabel("3", "minuette")).toBe("(iii)");
    expect(decorateLabel("3", "subminuette")).toBe("iii");
  });

  it("keeps letters as letters and only changes their case and wrapper", () => {
    expect(decorateLabel("B", "supercycle")).toBe("(B)");
    expect(decorateLabel("B", "primary")).toBe("Ⓑ");
    expect(decorateLabel("B", "minuette")).toBe("(b)");
    expect(decorateLabel("W", "minor")).toBe("W");
  });

  it("walks the degree ladder without running off either end", () => {
    expect(childDegree("primary")).toBe("intermediate");
    expect(parentDegree("primary")).toBe("cycle");
    expect(parentDegree("grandSupercycle")).toBe("grandSupercycle");
    expect(childDegree("subminuette")).toBe("subminuette");
  });
});

// ------------------------------------------------------------------ tools ---

describe("tool definitions", () => {
  it("matches the TradingView Elliott set, origin click included", () => {
    expect(TOOLS.impulse.labels).toEqual(["1", "2", "3", "4", "5"]);
    expect(TOOLS.impulse.points).toBe(6);
    expect(TOOLS.correction.labels).toEqual(["A", "B", "C"]);
    expect(TOOLS.triangle.labels).toEqual(["A", "B", "C", "D", "E"]);
    expect(TOOLS.doubleCombo.labels).toEqual(["W", "X", "Y"]);
    expect(TOOLS.tripleCombo.labels).toEqual(["W", "X", "Y", "X", "Z"]);
  });

  it("gives every Elliott tool at least one variant to validate against", () => {
    for (const tool of Object.values(TOOLS)) {
      if (tool.elliott) expect(tool.variants.length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------- incomplete ---

describe("partial counts", () => {
  it("validates what it can and refuses to grade an unfinished count", () => {
    const { validation, metrics } = check(drawing("impulse", [100, 130, 118]));
    expect(metrics.complete).toBe(false);
    expect(validation.tier).toBe("Low");
    expect(idOf(validation.results, "impulse.wave2-retracement")?.status).toBe("pass");
    expect(idOf(validation.results, "impulse.wave3-not-shortest")).toBeUndefined();
  });
});

// ------------------------------------------------------------ hit-testing ---

describe("pointer hit-testing", () => {
  const shapes = [
    { id: "a", points: [{ x: 10, y: 100 }, { x: 60, y: 40 }, { x: 120, y: 90 }] },
    { id: "b", points: [{ x: 200, y: 50 }], fullWidth: true },
  ];

  it("prefers a handle over the leg it sits on", () => {
    expect(hitTest(shapes, { x: 60, y: 42 })).toEqual({ drawingId: "a", pointIndex: 1 });
  });

  it("finds a leg between its pivots", () => {
    expect(hitTest(shapes, { x: 35, y: 70 })).toEqual({ drawingId: "a", pointIndex: null });
  });

  it("misses when the pointer is clear of everything", () => {
    expect(hitTest(shapes, { x: 35, y: 140 })).toBeNull();
  });

  it("treats a horizontal level as spanning the full width", () => {
    expect(hitTest(shapes, { x: 900, y: 52 })).toEqual({ drawingId: "b", pointIndex: null });
    expect(hitTest(shapes, { x: 900, y: 80 })).toBeNull();
  });

  it("picks the topmost shape when two overlap", () => {
    const stacked = [
      { id: "under", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: "over", points: [{ x: 0, y: 2 }, { x: 100, y: 2 }] },
    ];
    expect(hitTest(stacked, { x: 50, y: 1 })?.drawingId).toBe("over");
  });

  it("does not extend a segment past its endpoints", () => {
    const segment = [{ id: "s", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];
    expect(hitTest(segment, { x: 140, y: 0 })).toBeNull();
    expect(distanceToSegment({ x: 140, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(40);
  });
});
