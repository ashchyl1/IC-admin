/**
 * Channel geometry and the Elliott-derived channels.
 *
 * Two shapes cover everything asked for, and the distinction matters:
 *
 *  - **parallel** — a base line plus a second line of identical slope through
 *    a third point. Covers the manual parallel/custom channel and the derived
 *    1–3, 2–4 and ABC channels.
 *  - **converging** — two independent lines that are *not* parallel. The
 *    triangle's A–C and B–D boundaries close on each other by definition, so
 *    forcing them parallel would draw something that is not the triangle.
 *
 * Treating the triangle as a parallel channel is the obvious shortcut and it
 * is wrong; hence two geometries rather than one.
 */

import type { Drawing, Pivot, ToolKind } from "./tools";

export interface ChannelSegment {
  from: Pivot;
  to: Pivot;
}

export interface ChannelGeometry {
  primary: ChannelSegment;
  secondary: ChannelSegment;
}

/** Price change per unit of chart time. Null for a vertical (zero-width) base. */
export function slopeOf(a: Pivot, b: Pivot): number | null {
  const dt = b.time - a.time;
  if (dt === 0) return null;
  return (b.price - a.price) / dt;
}

/**
 * The two lines a channel draws.
 *
 * For a parallel channel the second line is the base slope carried through the
 * third pivot, evaluated at the base's own endpoints so both lines span the
 * same time range and the fill between them is a clean quadrilateral.
 */
export function channelGeometry(drawing: Drawing): ChannelGeometry | null {
  const p = drawing.pivots;

  if (drawing.kind === "triangle-channel") {
    if (p.length < 4) return null;
    // A–C and B–D, exactly as drawn. No parallel assumption.
    return {
      primary: { from: p[0], to: p[1] },
      secondary: { from: p[2], to: p[3] },
    };
  }

  if (drawing.kind === "parallel-channel") {
    if (p.length < 3) return null;
    const m = slopeOf(p[0], p[1]);
    if (m === null) return null;
    const at = (time: number) => p[2].price + m * (time - p[2].time);
    return {
      primary: { from: p[0], to: p[1] },
      secondary: {
        from: { time: p[0].time, price: at(p[0].time) },
        to: { time: p[1].time, price: at(p[1].time) },
      },
    };
  }

  return null;
}

export const DERIVED_CHANNELS = [
  "wave-1-3",
  "wave-2-4",
  "abc",
  "triangle-boundaries",
] as const;

export type DerivedChannelKind = (typeof DERIVED_CHANNELS)[number];

export const DERIVED_LABEL: Record<DerivedChannelKind, string> = {
  "wave-1-3": "1–3 channel",
  "wave-2-4": "2–4 channel",
  abc: "ABC channel",
  "triangle-boundaries": "A–C / B–D",
};

/** Which structure each derived channel can be built from. */
export const DERIVED_SOURCE: Record<DerivedChannelKind, ToolKind> = {
  "wave-1-3": "impulse",
  "wave-2-4": "impulse",
  abc: "correction",
  "triangle-boundaries": "triangle",
};

export function canDerive(source: Drawing | null, kind: DerivedChannelKind): boolean {
  return !!source && source.complete && source.kind === DERIVED_SOURCE[kind];
}

/**
 * Build a channel from an existing count.
 *
 * Pivot indices assume the tool's unlabelled origin at index 0, so wave 1 ends
 * at index 1, wave 2 at index 2, and so on.
 *
 *   1–3  base through the ends of waves 1 and 3, parallel through wave 2
 *   2–4  base through the ends of waves 2 and 4, parallel through wave 3 —
 *        this is §5's channeling guideline made operational; the parallel
 *        projects where wave 5 should terminate
 *   ABC  base through the ends of A and C, parallel through B
 *   A–C / B–D  the triangle's two boundaries
 */
export function deriveChannel(
  source: Drawing,
  kind: DerivedChannelKind,
  id: string
): Drawing | null {
  if (!canDerive(source, kind)) return null;
  const p = source.pivots;

  const base = {
    id,
    degree: source.degree,
    variant: "none" as const,
    complete: true,
    style: source.style,
    extend: true,
  };

  switch (kind) {
    case "wave-1-3":
      if (p.length < 4) return null;
      return { ...base, kind: "parallel-channel", pivots: [p[1], p[3], p[2]] };
    case "wave-2-4":
      if (p.length < 5) return null;
      return { ...base, kind: "parallel-channel", pivots: [p[2], p[4], p[3]] };
    case "abc":
      if (p.length < 4) return null;
      return { ...base, kind: "parallel-channel", pivots: [p[1], p[3], p[2]] };
    case "triangle-boundaries":
      if (p.length < 5) return null;
      return { ...base, kind: "triangle-channel", pivots: [p[1], p[3], p[2], p[4]] };
    default:
      return null;
  }
}

export interface ScreenSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Stretch a segment to the pane's left and right edges.
 *
 * Done in screen space rather than chart space because "the edges" are a
 * property of the viewport, not the data — extending in chart space would
 * need re-deriving on every pan and would run past the plotted area.
 * A vertical segment is returned unchanged; there is nothing to extend.
 */
export function extendToEdges(seg: ScreenSegment, width: number): ScreenSegment {
  const dx = seg.x2 - seg.x1;
  if (dx === 0) return seg;
  const m = (seg.y2 - seg.y1) / dx;
  return {
    x1: 0,
    y1: seg.y1 + m * (0 - seg.x1),
    x2: width,
    y2: seg.y1 + m * (width - seg.x1),
  };
}
