import { describe, expect, it } from "vitest";
import {
  canDerive,
  channelGeometry,
  deriveChannel,
  extendToEdges,
  slopeOf,
} from "@/lib/wave-lab/drawings/channels";
import { dashArray, isChannel, type Drawing } from "@/lib/wave-lab/drawings/tools";
import { snapToExtreme } from "@/lib/wave-lab/drawings/snap";
import { makeCandle } from "@/lib/wave-lab/candles";

const pivot = (time: number, price: number) => ({ time, price });

function drawing(kind: Drawing["kind"], pivots: { time: number; price: number }[]): Drawing {
  return { id: "d", kind, degree: "minor", variant: "none", complete: true, pivots };
}

/* ------------------------------------------------------------- geometry -- */

describe("slope", () => {
  it("is price change per unit time", () => {
    expect(slopeOf(pivot(0, 100), pivot(10, 120))).toBe(2);
  });

  it("is null for a zero-width base rather than Infinity", () => {
    expect(slopeOf(pivot(5, 100), pivot(5, 120))).toBeNull();
  });
});

describe("parallel channel geometry", () => {
  // Base rises 100 -> 200 over 100 time units; third point sits 50 below.
  const d = drawing("parallel-channel", [pivot(0, 100), pivot(100, 200), pivot(0, 50)]);

  it("keeps the base line exactly as drawn", () => {
    const g = channelGeometry(d)!;
    expect(g.primary.from).toEqual(pivot(0, 100));
    expect(g.primary.to).toEqual(pivot(100, 200));
  });

  it("gives the second line the same slope as the base", () => {
    const g = channelGeometry(d)!;
    expect(slopeOf(g.secondary.from, g.secondary.to)).toBeCloseTo(
      slopeOf(g.primary.from, g.primary.to)!,
      9
    );
  });

  it("passes the second line through the third pivot", () => {
    const g = channelGeometry(d)!;
    expect(g.secondary.from.price).toBeCloseTo(50, 9);
  });

  it("spans both lines over the same time range, so the fill is a clean quad", () => {
    const g = channelGeometry(d)!;
    expect(g.secondary.from.time).toBe(g.primary.from.time);
    expect(g.secondary.to.time).toBe(g.primary.to.time);
  });

  it("handles a third pivot placed at an unrelated time", () => {
    const off = drawing("parallel-channel", [pivot(0, 100), pivot(100, 200), pivot(60, 210)]);
    const g = channelGeometry(off)!;
    // At t=60 the second line must equal the third pivot's price.
    const m = slopeOf(g.secondary.from, g.secondary.to)!;
    expect(g.secondary.from.price + m * 60).toBeCloseTo(210, 9);
  });

  it("returns null when the base is vertical", () => {
    expect(channelGeometry(drawing("parallel-channel", [pivot(5, 1), pivot(5, 9), pivot(0, 3)]))).toBeNull();
  });

  it("returns null before the third click", () => {
    expect(channelGeometry(drawing("parallel-channel", [pivot(0, 1), pivot(1, 2)]))).toBeNull();
  });
});

describe("triangle channel geometry", () => {
  const d = drawing("triangle-channel", [
    pivot(0, 200),
    pivot(100, 150), // A–C, falling
    pivot(0, 50),
    pivot(100, 120), // B–D, rising
  ]);

  it("uses the two boundaries exactly as drawn", () => {
    const g = channelGeometry(d)!;
    expect(g.primary).toEqual({ from: pivot(0, 200), to: pivot(100, 150) });
    expect(g.secondary).toEqual({ from: pivot(0, 50), to: pivot(100, 120) });
  });

  it("does NOT force the boundaries parallel — they converge", () => {
    const g = channelGeometry(d)!;
    const m1 = slopeOf(g.primary.from, g.primary.to)!;
    const m2 = slopeOf(g.secondary.from, g.secondary.to)!;
    expect(m1).not.toBeCloseTo(m2, 6);
    // Falling upper, rising lower: a contracting triangle.
    expect(m1).toBeLessThan(0);
    expect(m2).toBeGreaterThan(0);
  });
});

describe("extend to pane edges", () => {
  it("stretches a sloped segment across the full width", () => {
    const out = extendToEdges({ x1: 100, y1: 100, x2: 200, y2: 200 }, 500);
    expect(out.x1).toBe(0);
    expect(out.x2).toBe(500);
    expect(out.y1).toBeCloseTo(0, 9);
    expect(out.y2).toBeCloseTo(500, 9);
  });

  it("preserves a horizontal line's level", () => {
    const out = extendToEdges({ x1: 10, y1: 60, x2: 90, y2: 60 }, 400);
    expect(out.y1).toBeCloseTo(60, 9);
    expect(out.y2).toBeCloseTo(60, 9);
  });

  it("leaves a vertical segment alone rather than dividing by zero", () => {
    const seg = { x1: 50, y1: 10, x2: 50, y2: 90 };
    expect(extendToEdges(seg, 400)).toEqual(seg);
  });
});

/* --------------------------------------------------------- derivation --- */

describe("derived channels", () => {
  // origin, 1, 2, 3, 4, 5
  const impulse = drawing("impulse", [
    pivot(0, 100),
    pivot(10, 150),
    pivot(20, 125),
    pivot(30, 230),
    pivot(40, 200),
    pivot(50, 260),
  ]);
  const correction = drawing("correction", [
    pivot(0, 200),
    pivot(10, 150),
    pivot(20, 180),
    pivot(30, 130),
  ]);
  const triangle = drawing("triangle", [
    pivot(0, 200),
    pivot(10, 100),
    pivot(20, 180),
    pivot(30, 120),
    pivot(40, 160),
    pivot(50, 140),
  ]);

  it("builds a 1–3 channel through waves 1 and 3, parallel through wave 2", () => {
    const ch = deriveChannel(impulse, "wave-1-3", "c1")!;
    expect(ch.kind).toBe("parallel-channel");
    expect(ch.pivots[0]).toEqual(pivot(10, 150)); // end of wave 1
    expect(ch.pivots[1]).toEqual(pivot(30, 230)); // end of wave 3
    expect(ch.pivots[2]).toEqual(pivot(20, 125)); // end of wave 2
  });

  it("builds a 2–4 channel through waves 2 and 4, parallel through wave 3", () => {
    const ch = deriveChannel(impulse, "wave-2-4", "c2")!;
    expect(ch.pivots[0]).toEqual(pivot(20, 125));
    expect(ch.pivots[1]).toEqual(pivot(40, 200));
    expect(ch.pivots[2]).toEqual(pivot(30, 230));
  });

  it("projects wave 5 — the 2–4 parallel sits above wave 3's end", () => {
    // §5's channeling guideline: the parallel from 3 is where 5 should finish.
    const ch = deriveChannel(impulse, "wave-2-4", "c3")!;
    const g = channelGeometry(ch)!;
    const m = slopeOf(g.secondary.from, g.secondary.to)!;
    const atWave5Time = g.secondary.from.price + m * (50 - g.secondary.from.time);
    expect(atWave5Time).toBeGreaterThan(230);
  });

  it("builds an ABC channel through A and C, parallel through B", () => {
    const ch = deriveChannel(correction, "abc", "c4")!;
    expect(ch.pivots[0]).toEqual(pivot(10, 150));
    expect(ch.pivots[1]).toEqual(pivot(30, 130));
    expect(ch.pivots[2]).toEqual(pivot(20, 180));
  });

  it("builds the triangle's A–C and B–D boundaries as a converging channel", () => {
    const ch = deriveChannel(triangle, "triangle-boundaries", "c5")!;
    expect(ch.kind).toBe("triangle-channel");
    expect(ch.pivots).toEqual([pivot(10, 100), pivot(30, 120), pivot(20, 180), pivot(40, 160)]);
  });

  it("inherits the source's degree and extends by default", () => {
    const ch = deriveChannel(impulse, "wave-1-3", "c6")!;
    expect(ch.degree).toBe(impulse.degree);
    expect(ch.extend).toBe(true);
  });

  it("refuses a derivation the source cannot support", () => {
    expect(deriveChannel(correction, "wave-2-4", "x")).toBeNull();
    expect(deriveChannel(impulse, "abc", "x")).toBeNull();
    expect(deriveChannel(impulse, "triangle-boundaries", "x")).toBeNull();
  });

  it("refuses an incomplete source", () => {
    expect(canDerive({ ...impulse, complete: false }, "wave-1-3")).toBe(false);
    expect(canDerive(null, "wave-1-3")).toBe(false);
  });
});

/* ------------------------------------------------------------ snapping -- */

describe("magnetic snapping", () => {
  const candles = [
    makeCandle(1000, 100, 110, 90, 105, 1),
    makeCandle(2000, 105, 130, 100, 120, 1),
    makeCandle(3000, 120, 125, 95, 100, 1),
  ];
  // makeCandle stores `time` already shifted into chart space, so anchor the
  // fixtures to the candles' own times rather than to the epochs passed in.
  const T = candles.map((c) => c.time);

  // A projector where one price unit is 1px and bars sit 100px apart.
  const project = {
    toScreen: (p: { time: number; price: number }) => ({
      x: (p.time - T[0]) / 10,
      y: 200 - p.price,
    }),
  };

  it("snaps to a candle high within the radius", () => {
    const r = snapToExtreme({ time: T[1], price: 128 }, candles, project);
    expect(r.snapped).toBe(true);
    expect(r.target).toBe("high");
    expect(r.pivot.price).toBe(130);
  });

  it("snaps to a candle low within the radius", () => {
    const r = snapToExtreme({ time: T[2], price: 97 }, candles, project);
    expect(r.snapped).toBe(true);
    expect(r.target).toBe("low");
    expect(r.pivot.price).toBe(95);
  });

  it("leaves the point alone when nothing is close", () => {
    const r = snapToExtreme({ time: T[1], price: 60 }, candles, project);
    expect(r.snapped).toBe(false);
    expect(r.pivot.price).toBe(60);
  });

  it("picks the nearer of two candidates", () => {
    // 111 is 1px from the high at 110 and 21px from the low at 90.
    const r = snapToExtreme({ time: T[0], price: 111 }, candles, project);
    expect(r.pivot.price).toBe(110);
  });

  it("reaches a neighbouring bar's extreme, not only the bar underneath", () => {
    // Sits between bars 1 and 2, nearest to bar 2's high of 130.
    const r = snapToExtreme({ time: T[1] - 100, price: 129 }, candles, project);
    expect(r.snapped).toBe(true);
    expect(r.pivot.time).toBe(T[1]);
    expect(r.pivot.price).toBe(130);
  });

  it("uses a pixel radius, so zoom changes what is reachable", () => {
    // Identical price gap; this projector squashes price 10x, bringing the
    // candle low at 100 within reach of a cursor at 60.
    const squashed = {
      toScreen: (p: { time: number; price: number }) => ({
        x: (p.time - T[0]) / 10,
        y: 200 - p.price / 10,
      }),
    };
    expect(snapToExtreme({ time: T[1], price: 60 }, candles, project).snapped).toBe(false);
    expect(snapToExtreme({ time: T[1], price: 60 }, candles, squashed).snapped).toBe(true);
  });

  it("does nothing without candles", () => {
    expect(snapToExtreme({ time: T[0], price: 1 }, [], project).snapped).toBe(false);
  });
});

/* --------------------------------------------------------------- style -- */

describe("style helpers", () => {
  it("identifies channels", () => {
    expect(isChannel("parallel-channel")).toBe(true);
    expect(isChannel("triangle-channel")).toBe(true);
    expect(isChannel("impulse")).toBe(false);
  });

  it("returns no dash pattern for solid", () => {
    expect(dashArray("solid")).toBeUndefined();
    expect(dashArray(undefined)).toBeUndefined();
  });

  it("scales the dash pattern with thickness", () => {
    expect(dashArray("dashed", 1)).toBe("4 3");
    expect(dashArray("dashed", 2)).toBe("8 6");
    expect(dashArray("dotted", 2)).toBe("2 5");
  });
});
