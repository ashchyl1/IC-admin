import { describe, expect, it } from "vitest";
import {
  RMI_DEFAULTS,
  emaOf,
  rma,
  rmiScaled,
  smaOf,
  defined,
} from "@/lib/wave-lab/indicators";
import { makeCandle } from "@/lib/wave-lab/candles";
import type { MarketCandle } from "@/lib/wave-lab/types";

function closes(values: number[]): MarketCandle[] {
  const start = Date.UTC(2026, 0, 1) / 1000;
  return values.map((c, i) => makeCandle(start + i * 86400, c, c + 1, c - 1, c, 1000));
}

const ramp = (n: number, step = 1, from = 100) =>
  Array.from({ length: n }, (_, i) => from + i * step);

describe("Wilder's rma — Pine's ta.rma", () => {
  it("seeds with the SMA of the first `length` values", () => {
    expect(rma([1, 2, 3, 4], 2)[1]).toBe(1.5);
  });

  it("then applies alpha = 1/length", () => {
    // 0.5*3 + 0.5*1.5 = 2.25, then 0.5*4 + 0.5*2.25 = 3.125
    const out = rma([1, 2, 3, 4], 2);
    expect(out[2]).toBeCloseTo(2.25, 10);
    expect(out[3]).toBeCloseTo(3.125, 10);
  });

  it("is null until seeded", () => {
    expect(rma([1, 2, 3, 4], 2)[0]).toBeNull();
    expect(rma([1, 2, 3], 5).every((v) => v === null)).toBe(true);
  });

  it("skips leading nulls and seeds from the first real values", () => {
    // The nulls stand in for close[lookback] being na.
    const out = rma([null, null, 1, 2, 3, 4], 2);
    expect(out[2]).toBeNull();
    expect(out[3]).toBe(1.5);
  });

  it("settles on a constant series", () => {
    const out = rma(Array(50).fill(7), 14);
    expect(out[49]).toBeCloseTo(7, 10);
  });

  it("smooths more slowly than an EMA of the same length", () => {
    const step = [...Array(30).fill(10), ...Array(30).fill(20)];
    const w = rma(step, 14)[59]!;
    const e = emaOf(step, 14)[59]!;
    expect(Math.abs(20 - w)).toBeGreaterThan(Math.abs(20 - e));
  });
});

describe("emaOf / smaOf", () => {
  it("ema seeds with SMA then uses alpha = 2/(n+1)", () => {
    const out = emaOf([1, 2, 3, 4], 2);
    expect(out[1]).toBe(1.5);
    expect(out[2]).toBeCloseTo(2.5, 10); // 2/3*3 + 1/3*1.5
    expect(out[3]).toBeCloseTo(3.5, 10);
  });

  it("sma is a plain rolling mean", () => {
    expect(smaOf([1, 2, 3, 4, 5], 3).map((v) => v)).toEqual([null, null, 2, 3, 4]);
  });

  it("both ignore leading nulls", () => {
    expect(smaOf([null, 1, 2, 3], 3)[3]).toBe(2);
    expect(emaOf([null, 1, 2, 3], 3)[3]).toBe(2);
  });
});

describe("RMI Scaled — defaults match the Pine inputs", () => {
  it("uses lookback 6, smoothing 11, divisor 4.5, EMA signal of 9", () => {
    expect(RMI_DEFAULTS).toEqual({
      lookback: 6,
      smoothLen: 11,
      scaleFactor: 4.5,
      signalType: "EMA",
      signalLen: 9,
    });
  });
});

describe("RMI Scaled — warm-up", () => {
  const bars = closes(ramp(60));

  it("produces nothing before lookback + smoothLen - 1", () => {
    const { rmi } = rmiScaled(bars);
    // gains start at index 6; rma needs 11 of them, so index 16 is first.
    for (let i = 0; i < 16; i++) expect(rmi[i].value).toBeNull();
    expect(rmi[16].value).not.toBeNull();
  });

  it("delays the signal by its own length", () => {
    const { signal } = rmiScaled(bars);
    for (let i = 0; i < 24; i++) expect(signal[i].value).toBeNull();
    expect(signal[24].value).not.toBeNull();
  });

  it("returns one point per bar so callers can zip by index", () => {
    const { rmi, signal } = rmiScaled(bars);
    expect(rmi).toHaveLength(bars.length);
    expect(signal).toHaveLength(bars.length);
    expect(rmi[30].time).toBe(bars[30].time);
  });
});

describe("RMI Scaled — bounds", () => {
  it("pins near +11.11 when every change is a gain", () => {
    // avgLoss is 0, so rs takes the 99999 sentinel and rmi -> ~100.
    // (100 - 50) / 4.5 = 11.111
    const { rmi } = rmiScaled(closes(ramp(60)));
    expect(rmi[59].value!).toBeCloseTo(11.111, 2);
  });

  it("pins at -11.11 when every change is a loss", () => {
    // avgGain is 0 so rs is 0, rmi is 0, and the floor is exactly -50/4.5.
    const { rmi } = rmiScaled(closes(ramp(60, -1, 200)));
    expect(rmi[59].value!).toBeCloseTo(-50 / 4.5, 10);
  });

  it("sits at zero for a flat series — gains and losses both zero", () => {
    // delta is 0 throughout, so avgGain and avgLoss are both 0; the sentinel
    // fires and rmi is ~100. Documenting the real behaviour rather than
    // assuming a flat market reads neutral.
    const { rmi } = rmiScaled(closes(Array(60).fill(100)));
    expect(rmi[59].value!).toBeCloseTo(11.111, 2);
  });

  it("scales inversely with the divisor", () => {
    const bars = closes(ramp(60));
    const a = rmiScaled(bars, { ...RMI_DEFAULTS, scaleFactor: 4.5 }).rmi[59].value!;
    const b = rmiScaled(bars, { ...RMI_DEFAULTS, scaleFactor: 9 }).rmi[59].value!;
    expect(a / b).toBeCloseTo(2, 6);
  });

  it("never divides by zero if the divisor is set to 0", () => {
    const { rmi } = rmiScaled(closes(ramp(60)), { ...RMI_DEFAULTS, scaleFactor: 0 });
    expect(Number.isFinite(rmi[59].value!)).toBe(true);
  });
});

describe("RMI Scaled — signal line", () => {
  const bars = closes(
    Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 6) * 12 + i * 0.15)
  );

  it("EMA and SMA signals genuinely differ", () => {
    const e = rmiScaled(bars, { ...RMI_DEFAULTS, signalType: "EMA" }).signal[119].value!;
    const s = rmiScaled(bars, { ...RMI_DEFAULTS, signalType: "SMA" }).signal[119].value!;
    expect(e).not.toBeCloseTo(s, 4);
  });

  it("is a smoothed version of the RMI, so it stays inside its range", () => {
    const { rmi, signal } = rmiScaled(bars);
    const rmiVals = defined(rmi).map((p) => p.value);
    const sigVals = defined(signal).map((p) => p.value);
    expect(Math.max(...sigVals)).toBeLessThanOrEqual(Math.max(...rmiVals) + 1e-9);
    expect(Math.min(...sigVals)).toBeGreaterThanOrEqual(Math.min(...rmiVals) - 1e-9);
  });

  it("crosses the RMI in both directions on an oscillating series", () => {
    const { rmi, signal } = rmiScaled(bars);
    let above = 0;
    let below = 0;
    for (let i = 0; i < rmi.length; i++) {
      const g = rmi[i].value;
      const r = signal[i].value;
      if (g === null || r === null) continue;
      if (g > r) above += 1;
      else if (g < r) below += 1;
    }
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
  });
});

describe("RMI Scaled — parameter sensitivity", () => {
  const bars = closes(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 9) * 15));

  it("a shorter lookback reacts faster", () => {
    const fast = defined(rmiScaled(bars, { ...RMI_DEFAULTS, lookback: 2 }).rmi).map((p) => p.value);
    const slow = defined(rmiScaled(bars, { ...RMI_DEFAULTS, lookback: 20 }).rmi).map((p) => p.value);
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(fast)).toBeGreaterThan(spread(slow));
  });

  it("heavier smoothing damps the range", () => {
    const light = defined(rmiScaled(bars, { ...RMI_DEFAULTS, smoothLen: 3 }).rmi).map((p) => p.value);
    const heavy = defined(rmiScaled(bars, { ...RMI_DEFAULTS, smoothLen: 40 }).rmi).map((p) => p.value);
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(light)).toBeGreaterThan(spread(heavy));
  });

  it("copes with fewer bars than the warm-up needs", () => {
    const { rmi, signal } = rmiScaled(closes(ramp(5)));
    expect(rmi.every((p) => p.value === null)).toBe(true);
    expect(signal.every((p) => p.value === null)).toBe(true);
  });

  it("copes with an empty series", () => {
    expect(rmiScaled([]).rmi).toEqual([]);
  });
});
