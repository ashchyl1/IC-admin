/**
 * Hit-testing for the SVG overlay. §12.2.
 *
 * Why this exists at all: the overlay must be `pointer-events: none`, or the
 * chart underneath cannot be panned. That means the browser will never report
 * a hit on it — `elementFromPoint` returns the canvas beneath, and every
 * attempt to select or drag a drawing pans the chart instead. So the geometry
 * is tested here, in screen space, by hand.
 *
 * Order matters: **handles first**, then segments, and topmost drawing before
 * the ones under it. Testing segments first makes a handle sitting on its own
 * line unreachable, and the analyst can never grab the endpoint they can
 * plainly see.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A drawing flattened to screen coordinates, ready to test. */
export interface ScreenDrawing {
  id: string;
  points: ScreenPoint[];
  /** Horizontal lines extend across the pane, so they test differently. */
  kind: "polyline" | "horizontal";
}

export const HANDLE_RADIUS = 10;
export const SEGMENT_RADIUS = 7;

export type HitResult =
  | { type: "handle"; drawingId: string; pointIndex: number }
  | { type: "segment"; drawingId: string; segmentIndex: number }
  | null;

/** Squared distance — avoids a sqrt in the inner loop. */
function dist2(a: ScreenPoint, b: ScreenPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Shortest distance from a point to a finite segment.
 *
 * Clamping t to [0,1] is what makes it *finite*: without it a click far past
 * the end of a short leg still registers, because the infinite line passes
 * near the cursor.
 */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.sqrt(dist2(p, a));
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(dist2(p, { x: a.x + t * dx, y: a.y + t * dy }));
}

/**
 * Test a cursor position against drawings.
 *
 * `drawings` must be ordered bottom-to-top; the search runs in reverse so the
 * drawing rendered last — the one visually on top — wins a tie.
 */
export function hitTest(
  cursor: ScreenPoint,
  drawings: ScreenDrawing[],
  paneWidth: number
): HitResult {
  // Pass 1: handles, across every drawing, topmost first.
  for (let d = drawings.length - 1; d >= 0; d--) {
    const drawing = drawings[d];
    for (let i = drawing.points.length - 1; i >= 0; i--) {
      if (dist2(cursor, drawing.points[i]) <= HANDLE_RADIUS * HANDLE_RADIUS) {
        return { type: "handle", drawingId: drawing.id, pointIndex: i };
      }
    }
  }

  // Pass 2: only now, segments.
  for (let d = drawings.length - 1; d >= 0; d--) {
    const drawing = drawings[d];

    if (drawing.kind === "horizontal") {
      const y = drawing.points[0]?.y;
      if (y !== undefined && Math.abs(cursor.y - y) <= SEGMENT_RADIUS && cursor.x <= paneWidth) {
        return { type: "segment", drawingId: drawing.id, segmentIndex: 0 };
      }
      continue;
    }

    for (let i = 0; i < drawing.points.length - 1; i++) {
      if (distanceToSegment(cursor, drawing.points[i], drawing.points[i + 1]) <= SEGMENT_RADIUS) {
        return { type: "segment", drawingId: drawing.id, segmentIndex: i };
      }
    }
  }

  return null;
}

/**
 * Did this pointer interaction mean "click" or "drag"?
 *
 * §12.1: the charting library's click subscription swallows alternate single
 * clicks to discriminate double-clicks, so placing six pivots in a row loses
 * three of them. We track pointerdown/pointerup ourselves and call anything
 * under this threshold a click.
 */
export const CLICK_SLOP_PX = 5;

export function isClick(down: ScreenPoint, up: ScreenPoint): boolean {
  return dist2(down, up) <= CLICK_SLOP_PX * CLICK_SLOP_PX;
}
