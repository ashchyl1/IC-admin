import { describe, expect, it } from "vitest";
import { bollinger, defined, ema, sma } from "@/lib/wave-lab/indicators";
import { makeCandle } from "@/lib/wave-lab/candles";
import type { MarketCandle } from "@/lib/wave-lab/types";

/** Candles whose closes are exactly the numbers given. */
function closes(values: number[]): MarketCandle[] {
  const start = Date.UTC(2026, 0, 1) / 1000;
  return values.map((c, i) => makeCandle(start + i * 86400, c, c + 1, c - 1, c, 1000));
}

describe("simple moving average", () => {
  it("returns one point per bar, null until warmed up", () => {
    const out = sma(closes([1, 2, 3, 4, 5]), 3);
    expect(out).toHaveLength(5);
    expect(out.map((p) => p.value)).toEqual([null, null, 2, 3, 4]);
  });

  it("warms up exactly at the length-th bar, not one early or late", () => {
    const out = sma(closes([1, 2, 3, 4, 5]), 3);
    expect(out[1].value).toBeNull();
    expect(out[2].value).toBe(2);
  });

  it("keeps a rolling window rather than drifting", () => {
    // A long constant run must stay exactly on the constant — a running sum
    // that never subtracts would climb.
    const out = sma(closes(Array(100).fill(50)), 20);
    expect(out[99].value).toBeCloseTo(50, 10);
  });

  it("is all nulls for a length longer than the data", () => {
    expect(sma(closes([1, 2]), 5).every((p) => p.value === null)).toBe(true);
  });
});

describe("bollinger bands", () => {
  it("defaults to length 20 and 2 deviations", () => {
    const bars = closes(Array.from({ length: 40 }, (_, i) => 100 + i));
    const withDefaults = bollinger(bars);
    const explicit = bollinger(bars, 20, 2);
    expect(withDefaults.upper.map((p) => p.value)).toEqual(explicit.upper.map((p) => p.value));
  });

  it("uses the population deviation, matching Bollinger and Kite", () => {
    // closes 1,2,3 -> mean 2, population sd = sqrt(2/3) = 0.816497
    const b = bollinger(closes([1, 2, 3, 4, 5]), 3, 2);
    expect(b.middle[2].value).toBe(2);
    expect(b.upper[2].value).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 9);
    expect(b.lower[2].value).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3), 9);
  });

  it("would be wider with the sample deviation — the thing being avoided", () => {
    const b = bollinger(closes([1, 2, 3, 4, 5]), 3, 2);
    const sampleUpper = 2 + 2 * Math.sqrt(2 / 2); // n-1 divisor
    expect(b.upper[2].value!).toBeLessThan(sampleUpper);
  });

  it("collapses all three bands onto each other for a flat series", () => {
    const b = bollinger(closes(Array(30).fill(75)), 20, 2);
    expect(b.upper[25].value).toBeCloseTo(75, 9);
    expect(b.middle[25].value).toBeCloseTo(75, 9);
    expect(b.lower[25].value).toBeCloseTo(75, 9);
  });

  it("keeps upper above middle above lower once volatile", () => {
    const b = bollinger(closes(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 8)), 20, 2);
    for (let i = 25; i < 60; i++) {
      expect(b.upper[i].value!).toBeGreaterThan(b.middle[i].value!);
      expect(b.middle[i].value!).toBeGreaterThan(b.lower[i].value!);
    }
  });

  it("respects a non-default deviation multiple", () => {
    const bars = closes(Array.from({ length: 40 }, (_, i) => 100 + (i % 7)));
    const two = bollinger(bars, 20, 2).upper[30].value!;
    const three = bollinger(bars, 20, 3).upper[30].value!;
    const mid = bollinger(bars, 20, 2).middle[30].value!;
    expect(three - mid).toBeCloseTo(1.5 * (two - mid), 9);
  });

  it("nulls every band during warm-up", () => {
    const b = bollinger(closes([1, 2, 3, 4, 5]), 3, 2);
    expect(b.upper[1].value).toBeNull();
    expect(b.lower[1].value).toBeNull();
  });
});

describe("exponential moving average", () => {
  it("seeds from the SMA of the first period closes", () => {
    const out = ema(closes([1, 2, 3, 4, 5]), 3);
    expect(out[2].value).toBe(2); // (1+2+3)/3
  });

  it("applies the 2/(n+1) multiplier thereafter", () => {
    const out = ema(closes([1, 2, 3, 4, 5]), 3);
    // mult 0.5: (4-2)*0.5+2 = 3, then (5-3)*0.5+3 = 4
    expect(out[3].value).toBe(3);
    expect(out[4].value).toBe(4);
  });

  it("is null before the seed bar", () => {
    const out = ema(closes([1, 2, 3, 4, 5]), 3);
    expect(out[0].value).toBeNull();
    expect(out[1].value).toBeNull();
  });

  it("sits exactly on a flat series", () => {
    const out = ema(closes(Array(100).fill(42)), 20);
    expect(out[99].value).toBeCloseTo(42, 10);
  });

  it("tracks a faster period more closely than a slower one", () => {
    const bars = closes([...Array(50).fill(100), ...Array(20).fill(150)]);
    const fast = ema(bars, 20)[69].value!;
    const slow = ema(bars, 200 > bars.length ? 50 : 50)[69].value!;
    expect(Math.abs(150 - fast)).toBeLessThan(Math.abs(150 - slow));
  });

  it("returns all nulls when there are fewer bars than the period", () => {
    expect(ema(closes([1, 2, 3]), 20).every((p) => p.value === null)).toBe(true);
  });

  it("supports the four shipped periods without blowing up", () => {
    const bars = closes(Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 5) * 10));
    for (const period of [20, 50, 100, 200]) {
      const out = ema(bars, period);
      expect(out).toHaveLength(300);
      expect(out[299].value).not.toBeNull();
      expect(Number.isFinite(out[299].value!)).toBe(true);
    }
  });
});

describe("defined()", () => {
  it("drops the warm-up nulls and keeps order", () => {
    const points = ema(closes([1, 2, 3, 4, 5]), 3);
    const clean = defined(points);
    expect(clean).toHaveLength(3);
    expect(clean[0].value).toBe(2);
    expect(clean.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("returns nothing when the indicator never warmed up", () => {
    expect(defined(ema(closes([1, 2]), 20))).toEqual([]);
  });
});
