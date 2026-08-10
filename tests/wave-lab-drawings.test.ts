import { describe, expect, it } from "vitest";
import {
  DEGREES,
  DEGREE_META,
  childDegree,
  decorateLabel,
  parentDegree,
} from "@/lib/wave-lab/drawings/degrees";
import {
  TOOL_SPECS,
  allowsOverlap,
  labelForPivot,
  type ToolKind,
} from "@/lib/wave-lab/drawings/tools";
import {
  CLICK_SLOP_PX,
  distanceToSegment,
  hitTest,
  isClick,
  type ScreenDrawing,
} from "@/lib/wave-lab/drawings/hit-test";

describe("degree notation", () => {
  // The exact table from §4.1.
  it.each([
    ["grand-supercycle", "1", "[I]"],
    ["supercycle", "1", "(I)"],
    ["cycle", "1", "I"],
    ["primary", "1", "①"],
    ["intermediate", "1", "(1)"],
    ["minor", "1", "1"],
    ["minute", "1", "[i]"],
    ["minuette", "1", "(i)"],
    ["subminuette", "1", "i"],
  ] as const)("motive wave 1 at %s reads %s", (degree, base, expected) => {
    expect(decorateLabel(base, degree)).toBe(expected);
  });

  it.each([
    ["grand-supercycle", "A", "[Ⓐ]"],
    ["supercycle", "A", "(Ⓐ)"],
    ["cycle", "A", "Ⓐ"],
    ["primary", "A", "Ⓐ"],
    ["intermediate", "A", "(A)"],
    ["minor", "A", "A"],
    ["minute", "A", "[a]"],
    ["minuette", "A", "(a)"],
    ["subminuette", "A", "a"],
  ] as const)("corrective A at %s reads %s", (degree, base, expected) => {
    expect(decorateLabel(base, degree)).toBe(expected);
  });

  it("numbers waves 3 and 5 correctly at every degree", () => {
    expect(decorateLabel("3", "cycle")).toBe("III");
    expect(decorateLabel("5", "primary")).toBe("⑤");
    expect(decorateLabel("4", "minute")).toBe("[iv]");
  });

  it("decorates the combo labels W X Y Z as corrective", () => {
    expect(decorateLabel("W", "primary")).toBe("Ⓦ");
    expect(decorateLabel("Y", "intermediate")).toBe("(Y)");
    expect(decorateLabel("Z", "subminuette")).toBe("z");
  });

  it("re-derives from the degree, so changing degree changes the glyph", () => {
    // §12.4 — this is the property that makes render-time decoration correct.
    const base = "3";
    const first = decorateLabel(base, "minor");
    const afterChange = decorateLabel(base, "primary");
    expect(first).toBe("3");
    expect(afterChange).toBe("③");
    expect(first).not.toBe(afterChange);
  });

  it("sizes higher degrees larger", () => {
    expect(DEGREE_META["grand-supercycle"].fontSize).toBeGreaterThan(
      DEGREE_META.subminuette.fontSize
    );
  });
});

describe("degree traversal", () => {
  it("steps one finer and one coarser", () => {
    expect(childDegree("primary")).toBe("intermediate");
    expect(parentDegree("primary")).toBe("cycle");
  });

  it("clamps rather than wrapping at both ends", () => {
    expect(parentDegree("grand-supercycle")).toBe("grand-supercycle");
    expect(childDegree("subminuette")).toBe("subminuette");
  });

  it("round-trips through the middle of the list", () => {
    for (const d of DEGREES.slice(1, -1)) {
      expect(childDegree(parentDegree(d))).toBe(d);
    }
  });
});

describe("tool specs", () => {
  it.each([
    ["impulse", 6, ["1", "2", "3", "4", "5"]],
    ["correction", 4, ["A", "B", "C"]],
    ["triangle", 6, ["A", "B", "C", "D", "E"]],
    ["double-combo", 4, ["W", "X", "Y"]],
    ["triple-combo", 6, ["W", "X", "Y", "X", "Z"]],
  ] as const)("%s takes %i clicks and labels %j", (kind, points, labels) => {
    const spec = TOOL_SPECS[kind as ToolKind];
    expect(spec.points).toBe(points);
    expect(spec.labels).toEqual(labels);
    // One unlabelled origin, then one label per remaining click.
    expect(spec.labels.length).toBe(spec.points - 1);
  });

  it("leaves the origin unlabelled and labels the rest in order", () => {
    expect(labelForPivot("impulse", 0)).toBeNull();
    expect(labelForPivot("impulse", 1)).toBe("1");
    expect(labelForPivot("impulse", 5)).toBe("5");
    expect(labelForPivot("impulse", 6)).toBeNull();
  });

  it("labels the triple combo's second X distinctly by position", () => {
    expect(labelForPivot("triple-combo", 2)).toBe("X");
    expect(labelForPivot("triple-combo", 4)).toBe("X");
    expect(labelForPivot("triple-combo", 5)).toBe("Z");
  });
});

describe("overlap permission", () => {
  it("permits wave 4 into wave 1 only for diagonals", () => {
    expect(allowsOverlap({ kind: "impulse", variant: "leading-diagonal" })).toBe(true);
    expect(allowsOverlap({ kind: "impulse", variant: "ending-diagonal" })).toBe(true);
  });

  it("refuses it for every other impulse variant", () => {
    for (const variant of ["standard", "extended-third", "extended-fifth", "truncated-fifth"] as const) {
      expect(allowsOverlap({ kind: "impulse", variant })).toBe(false);
    }
  });

  it("is meaningless for non-impulse structures", () => {
    expect(allowsOverlap({ kind: "correction", variant: "zigzag" })).toBe(false);
    expect(allowsOverlap({ kind: "triangle", variant: "contracting" })).toBe(false);
  });
});

describe("segment distance", () => {
  it("measures perpendicular distance to the line", () => {
    expect(distanceToSegment({ x: 5, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
  });

  it("clamps past the ends, so a short leg is not infinitely long", () => {
    // Without clamping this would be ~0: the infinite line runs through y=0.
    expect(distanceToSegment({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
  });

  it("handles a degenerate zero-length segment", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("hit testing", () => {
  const line: ScreenDrawing = {
    id: "line",
    kind: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };

  it("finds a handle at the endpoint", () => {
    expect(hitTest({ x: 2, y: 2 }, [line], 500)).toEqual({
      type: "handle",
      drawingId: "line",
      pointIndex: 0,
    });
  });

  it("finds the segment between handles", () => {
    expect(hitTest({ x: 50, y: 3 }, [line], 500)).toEqual({
      type: "segment",
      drawingId: "line",
      segmentIndex: 0,
    });
  });

  it("prefers a handle over a segment that passes through it", () => {
    // The cursor is on the line AND on the endpoint. Handle must win, or an
    // endpoint sitting on its own line can never be grabbed.
    const hit = hitTest({ x: 100, y: 0 }, [line], 500);
    expect(hit?.type).toBe("handle");
    expect(hit).toMatchObject({ pointIndex: 1 });
  });

  it("prefers the topmost drawing when two overlap", () => {
    const under: ScreenDrawing = { ...line, id: "under" };
    const over: ScreenDrawing = { ...line, id: "over" };
    // Ordered bottom-to-top, so the last one drawn wins.
    expect(hitTest({ x: 50, y: 0 }, [under, over], 500)?.drawingId).toBe("over");
  });

  it("prefers a handle on a lower drawing over a segment on a higher one", () => {
    const lower: ScreenDrawing = {
      id: "lower",
      kind: "polyline",
      points: [
        { x: 50, y: 0 },
        { x: 60, y: 40 },
      ],
    };
    const higher: ScreenDrawing = {
      id: "higher",
      kind: "polyline",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    // Handles are tested across ALL drawings before any segment is considered.
    expect(hitTest({ x: 50, y: 0 }, [lower, higher], 500)).toMatchObject({
      type: "handle",
      drawingId: "lower",
    });
  });

  it("misses when the cursor is beyond the tolerance", () => {
    expect(hitTest({ x: 50, y: 40 }, [line], 500)).toBeNull();
  });

  it("treats a horizontal line as spanning the pane", () => {
    const h: ScreenDrawing = { id: "h", kind: "horizontal", points: [{ x: 10, y: 50 }] };
    expect(hitTest({ x: 480, y: 52 }, [h], 500)).toMatchObject({ type: "segment" });
    expect(hitTest({ x: 480, y: 90 }, [h], 500)).toBeNull();
  });

  it("returns null for no drawings", () => {
    expect(hitTest({ x: 1, y: 1 }, [], 500)).toBeNull();
  });
});

describe("click versus drag", () => {
  it("calls a still pointer a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it("tolerates a small wobble", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(true);
  });

  it("calls real movement a drag", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10 + CLICK_SLOP_PX + 3, y: 10 })).toBe(false);
  });
});
