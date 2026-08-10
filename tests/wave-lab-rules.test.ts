import { describe, expect, it } from "vitest";
import {
  BAR_TOLERANCE,
  SIGNIFICANCE_FLOOR,
  matchBarCount,
  matchRatio,
  significantMatches,
  timeClusters,
  upcomingBarCounts,
} from "@/lib/wave-lab/analysis/fib";
import { analyse, barIndexAt } from "@/lib/wave-lab/analysis/rules";
import type { Drawing } from "@/lib/wave-lab/drawings/tools";
import { makeCandle } from "@/lib/wave-lab/candles";
import type { MarketCandle } from "@/lib/wave-lab/types";

/* ---------------------------------------------------------------- setup -- */

/** A daily series long enough to index pivots into. */
function series(count = 400): MarketCandle[] {
  const start = Date.UTC(2025, 0, 1) / 1000;
  return Array.from({ length: count }, (_, i) =>
    makeCandle(start + i * 86400, 100, 101, 99, 100, 1000)
  );
}

const CANDLES = series();
const tAt = (bar: number) => CANDLES[bar].time;

function impulse(
  prices: number[],
  bars: number[],
  variant: Drawing["variant"] = "standard"
): Drawing {
  return {
    id: "x",
    kind: "impulse",
    degree: "minor",
    variant,
    complete: true,
    pivots: prices.map((price, i) => ({ time: tAt(bars[i]), price })),
  };
}

/** A clean bullish impulse: rises, shallow 2, big 3, shallow 4, decent 5. */
const CLEAN_PRICES = [100, 150, 125, 231, 200, 250];
const CLEAN_BARS = [0, 21, 34, 55, 89, 144];

/* ------------------------------------------------------------ fib basics -- */

describe("bar-count matching", () => {
  it("hits an exact Fibonacci term", () => {
    expect(matchBarCount(34).some((m) => m.series === "fibonacci" && m.term === 34)).toBe(true);
  });

  it("hits an exact Lucas term", () => {
    expect(matchBarCount(47).some((m) => m.series === "lucas" && m.term === 47)).toBe(true);
  });

  it("honours the ±1 tolerance on both sides", () => {
    expect(matchBarCount(33).some((m) => m.term === 34)).toBe(true);
    expect(matchBarCount(35).some((m) => m.term === 34)).toBe(true);
    expect(matchBarCount(36).some((m) => m.term === 34)).toBe(false);
  });

  it("records the signed delta", () => {
    const m = matchBarCount(33).find((x) => x.term === 34);
    expect(m?.delta).toBe(-1);
  });

  it("reports every hit, not just the nearest", () => {
    // 21 is Fibonacci; 20 and 22 are within ±1 of nothing in Lucas, but 21
    // itself is not Lucas — so exactly one hit.
    expect(matchBarCount(21).filter((m) => m.term === 21)).toHaveLength(1);
  });

  it("returns nothing for a non-positive or non-finite count", () => {
    expect(matchBarCount(0)).toEqual([]);
    expect(matchBarCount(-5)).toEqual([]);
    expect(matchBarCount(Number.NaN)).toEqual([]);
  });
});

describe("the density trap §6 warns about", () => {
  it("still matches small counts, because arithmetically they do", () => {
    // Every integer up to 14 sits within ±1 of some Fibonacci or Lucas term.
    for (let n = 1; n <= 14; n++) {
      expect(matchBarCount(n).length).toBeGreaterThan(0);
    }
  });

  it("but marks them insignificant, so they cannot inflate confidence", () => {
    for (let n = 1; n < SIGNIFICANCE_FLOOR; n++) {
      expect(significantMatches(n)).toHaveLength(0);
    }
  });

  it("counts a large clean hit as significant", () => {
    expect(significantMatches(55).length).toBeGreaterThan(0);
    expect(significantMatches(89).length).toBeGreaterThan(0);
  });

  it("treats the floor itself as significant", () => {
    expect(significantMatches(SIGNIFICANCE_FLOOR).length).toBeGreaterThan(0);
  });
});

describe("price ratios", () => {
  it("lands an exact ratio", () => {
    expect(matchRatio(0.618)?.ratio).toBe(0.618);
  });

  it("accepts a near miss inside tolerance", () => {
    expect(matchRatio(0.62)?.ratio).toBe(0.618);
  });

  it("rejects a clear miss", () => {
    expect(matchRatio(0.7)).toBeNull();
  });

  it("scales tolerance with the ratio, so big extensions get a wider window", () => {
    // 2% of 4.236 is ~0.085; the same absolute miss on 0.236 would fail.
    expect(matchRatio(4.3)?.ratio).toBe(4.236);
    expect(matchRatio(0.30, [0.236])).toBeNull();
  });

  it("picks the nearest when two ratios are both in range", () => {
    expect(matchRatio(0.51, [0.5, 0.618])?.ratio).toBe(0.5);
  });
});

describe("time clusters", () => {
  it("ranks by how many independent pivots converge", () => {
    // Two pivots 13 apart both project onto the same later bar.
    const clusters = timeClusters([0, 8]);
    expect(clusters[0].convergence).toBeGreaterThanOrEqual(2);
  });

  it("does not let one prolific pivot masquerade as agreement", () => {
    const single = timeClusters([0]);
    expect(single).toHaveLength(0); // minConvergence is 2 independent pivots
  });

  it("collapses near-duplicate windows", () => {
    const clusters = timeClusters([0, 5, 10]);
    for (let i = 1; i < clusters.length; i++) {
      expect(Math.abs(clusters[i].barIndex - clusters[i - 1].barIndex)).toBeGreaterThan(
        BAR_TOLERANCE
      );
    }
  });
});

describe("upcoming counts", () => {
  it("lists the next significant terms only", () => {
    const next = upcomingBarCounts(20);
    expect(next[0]).toBeGreaterThan(20);
    expect(next.every((n) => n >= SIGNIFICANCE_FLOOR)).toBe(true);
    expect(next).toHaveLength(3);
  });
});

describe("bar indexing", () => {
  it("finds the exact bar", () => {
    expect(barIndexAt(CANDLES, tAt(42))).toBe(42);
  });

  it("snaps to the nearest bar for a pivot between bars", () => {
    expect(barIndexAt(CANDLES, tAt(42) + 100)).toBe(42);
    expect(barIndexAt(CANDLES, tAt(42) + 86000)).toBe(43);
  });

  it("returns -1 for an empty series", () => {
    expect(barIndexAt([], 123)).toBe(-1);
  });
});

/* --------------------------------------------------------- hard rules ---- */

describe("hard rules — the §13 diagonal scenario", () => {
  // Wave 4 (200 -> 140) drops into wave 1's territory, which tops at 150.
  const OVERLAP_PRICES = [100, 150, 125, 231, 140, 250];

  it("fails wave-4 overlap as a standard impulse, naming the fixing price", () => {
    const a = analyse(impulse(OVERLAP_PRICES, CLEAN_BARS), CANDLES)!;
    const rule = a.results.find((r) => r.id === "wave4-overlap")!;
    expect(rule.status).toBe("fail");
    expect(rule.kind).toBe("hard");
    expect(rule.fixPrice).toBe(150);
    expect(rule.detail).toMatch(/wave 4/i);
    expect(rule.detail).toContain("150.00");
    expect(a.confidence).toBe("Invalid");
  });

  it("does NOT fail the same count marked as an ending diagonal", () => {
    const a = analyse(impulse(OVERLAP_PRICES, CLEAN_BARS, "ending-diagonal"), CANDLES)!;
    const rule = a.results.find((r) => r.id === "wave4-overlap")!;
    expect(rule.status).toBe("not-applicable");
    expect(a.confidence).not.toBe("Invalid");
  });

  it("also exempts a leading diagonal", () => {
    const a = analyse(impulse(OVERLAP_PRICES, CLEAN_BARS, "leading-diagonal"), CANDLES)!;
    expect(a.results.find((r) => r.id === "wave4-overlap")!.status).toBe("not-applicable");
  });

  it("suggests the diagonal in the failure text, since that is the usual fix", () => {
    const a = analyse(impulse(OVERLAP_PRICES, CLEAN_BARS), CANDLES)!;
    expect(a.results.find((r) => r.id === "wave4-overlap")!.detail).toMatch(/diagonal/i);
  });
});

describe("hard rules — wave 2", () => {
  it("fails when wave 2 retraces past wave 1's origin", () => {
    const a = analyse(impulse([100, 150, 95, 231, 200, 250], CLEAN_BARS), CANDLES)!;
    const rule = a.results.find((r) => r.id === "wave2-100")!;
    expect(rule.status).toBe("fail");
    expect(rule.fixPrice).toBe(100);
    expect(a.confidence).toBe("Invalid");
  });

  it("passes a deep but legal retracement", () => {
    const a = analyse(impulse([100, 150, 101, 231, 200, 250], CLEAN_BARS), CANDLES)!;
    expect(a.results.find((r) => r.id === "wave2-100")!.status).toBe("pass");
  });
});

describe("hard rules — wave 3", () => {
  it("fails when wave 3 is the shortest of 1, 3 and 5", () => {
    // 1 spans 50, 3 spans 20, 5 spans 60.
    const a = analyse(impulse([100, 150, 130, 150, 140, 200], CLEAN_BARS), CANDLES)!;
    const rule = a.results.find((r) => r.id === "wave3-shortest")!;
    expect(rule.status).toBe("fail");
    expect(rule.fixPrice).toBeDefined();
    expect(a.confidence).toBe("Invalid");
  });

  it("passes when wave 3 is merely shorter than one of them", () => {
    // 1 spans 50, 3 spans 40, 5 spans 20 — not the shortest.
    const a = analyse(impulse([100, 150, 130, 170, 160, 180], CLEAN_BARS), CANDLES)!;
    expect(a.results.find((r) => r.id === "wave3-shortest")!.status).toBe("pass");
  });
});

describe("hard rules — direction", () => {
  it("catches a leg running the wrong way", () => {
    // Wave 2 continues up instead of retracing.
    const a = analyse(impulse([100, 150, 160, 231, 200, 250], CLEAN_BARS), CANDLES)!;
    expect(a.results.find((r) => r.id === "alternation")!.status).toBe("fail");
  });

  it("handles a bearish impulse with the same rules", () => {
    const a = analyse(impulse([250, 200, 225, 119, 150, 100], CLEAN_BARS), CANDLES)!;
    expect(a.results.find((r) => r.id === "alternation")!.status).toBe("pass");
    expect(a.results.find((r) => r.id === "wave4-overlap")!.status).toBe("pass");
  });

  it("fails a bearish count whose wave 4 rises into wave 1", () => {
    const a = analyse(impulse([250, 200, 225, 119, 210, 100], CLEAN_BARS), CANDLES)!;
    expect(a.results.find((r) => r.id === "wave4-overlap")!.status).toBe("fail");
    expect(a.results.find((r) => r.id === "wave4-overlap")!.fixPrice).toBe(200);
  });
});

/* --------------------------------------------------------- verdicts ------ */

describe("verdict", () => {
  it("is Invalid the moment any hard rule breaks, whatever the guidelines say", () => {
    const a = analyse(impulse([100, 150, 95, 231, 200, 250], CLEAN_BARS), CANDLES)!;
    expect(a.confidence).toBe("Invalid");
    expect(a.reasoning[0]).toMatch(/hard rule/i);
  });

  it("gives sentences rather than a bare score", () => {
    const a = analyse(impulse(CLEAN_PRICES, CLEAN_BARS), CANDLES)!;
    expect(a.reasoning.length).toBeGreaterThan(1);
    for (const line of a.reasoning) expect(line).toMatch(/[a-z]/);
  });

  it("rates a clean, Fibonacci-proportioned count above a sloppy one", () => {
    const clean = analyse(impulse(CLEAN_PRICES, CLEAN_BARS), CANDLES)!;
    // Same rules kept, but no ratio lands and the legs are short.
    const sloppy = analyse(
      impulse([100, 150, 148, 300, 299, 305], [0, 3, 5, 8, 10, 12]),
      CANDLES
    )!;
    const rank = { Invalid: 0, Low: 1, Medium: 2, High: 3 } as const;
    expect(rank[clean.confidence]).toBeGreaterThan(rank[sloppy.confidence]);
  });

  it("returns null for an incomplete drawing rather than inventing a verdict", () => {
    const partial: Drawing = { ...impulse(CLEAN_PRICES, CLEAN_BARS), complete: false };
    expect(analyse(partial, CANDLES)).toBeNull();
  });
});

describe("invalidation level", () => {
  it("is always present for a valid impulse", () => {
    const a = analyse(impulse(CLEAN_PRICES, CLEAN_BARS), CANDLES)!;
    expect(a.invalidation).not.toBeNull();
    expect(a.invalidation!.price).toBe(200); // wave 4's extreme
    expect(a.invalidation!.rationale).toMatch(/wave 4/i);
  });

  it("points at the breached level when a rule already failed", () => {
    const a = analyse(impulse([100, 150, 125, 231, 140, 250], CLEAN_BARS), CANDLES)!;
    expect(a.invalidation!.price).toBe(150);
    expect(a.invalidation!.rationale).toMatch(/breached/i);
  });
});

/* ------------------------------------------------------- corrections ----- */

describe("corrections", () => {
  const correction = (prices: number[], variant: Drawing["variant"] = "zigzag"): Drawing => ({
    id: "c",
    kind: "correction",
    degree: "minor",
    variant,
    complete: true,
    pivots: prices.map((price, i) => ({ time: tAt([0, 21, 34, 55][i]), price })),
  });

  it("fails a zigzag whose B passes A's origin", () => {
    const a = analyse(correction([200, 150, 205, 130]), CANDLES)!;
    const rule = a.results.find((r) => r.id === "zigzag-b")!;
    expect(rule.status).toBe("fail");
    expect(rule.fixPrice).toBe(200);
    expect(a.confidence).toBe("Invalid");
  });

  it("exempts an expanded flat, where B beyond A is expected", () => {
    const a = analyse(correction([200, 150, 205, 130], "expanded-flat"), CANDLES)!;
    expect(a.results.find((r) => r.id === "zigzag-b")!.status).toBe("not-applicable");
    expect(a.confidence).not.toBe("Invalid");
  });

  it("passes a well-formed zigzag", () => {
    const a = analyse(correction([200, 150, 180, 130]), CANDLES)!;
    expect(a.results.find((r) => r.id === "zigzag-b")!.status).toBe("pass");
    expect(a.confidence).not.toBe("Invalid");
  });
});

/* --------------------------------------------------------- triangles ----- */

describe("triangles", () => {
  const triangle = (prices: number[], variant: Drawing["variant"] = "contracting"): Drawing => ({
    id: "t",
    kind: "triangle",
    degree: "minor",
    variant,
    complete: true,
    pivots: prices.map((price, i) => ({ time: tAt([0, 13, 21, 34, 47, 55][i]), price })),
  });

  it("passes a properly contracting triangle", () => {
    const a = analyse(triangle([200, 100, 180, 120, 160, 140]), CANDLES)!;
    expect(a.results.find((r) => r.id === "triangle-contraction")!.status).toBe("pass");
  });

  it("fails one whose legs widen", () => {
    const a = analyse(triangle([200, 100, 220, 80, 240, 60]), CANDLES)!;
    expect(a.results.find((r) => r.id === "triangle-contraction")!.status).toBe("fail");
    expect(a.confidence).toBe("Invalid");
  });

  it("exempts an expanding triangle from the contraction rule", () => {
    const a = analyse(triangle([200, 100, 220, 80, 240, 60], "expanding"), CANDLES)!;
    expect(a.results.find((r) => r.id === "triangle-contraction")!.status).toBe("not-applicable");
  });
});
