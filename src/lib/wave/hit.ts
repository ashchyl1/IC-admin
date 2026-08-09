/**
 * Pointer hit-testing for the drawing overlay.
 *
 * Done in JavaScript against the already-projected pixel geometry rather than
 * by the browser against the SVG. The overlay's root carries
 * `pointer-events: none` so that clicks reach the chart underneath, and
 * Chromium will not hit-test into an SVG subtree whose root is `none` — a
 * child that sets `pointer-events: auto` is still skipped. Testing the
 * coordinates ourselves sidesteps that entirely, behaves identically in every
 * browser, and keeps the overlay a pure render of the shapes.
 */

export interface HitPoint {
  x: number;
  y: number;
}

export interface HitShape {
  id: string;
  points: HitPoint[];
  /** Horizontal levels span the full width, so they are tested on y alone. */
  fullWidth?: boolean;
}

export interface HitResult {
  drawingId: string;
  /** Set when the pointer is on a pivot handle rather than on a leg. */
  pointIndex: number | null;
}

/** Pixels within which a pointer counts as being on a handle. */
export const HANDLE_RADIUS = 10;
/** Pixels within which a pointer counts as being on a line. */
export const LINE_RADIUS = 7;

/**
 * Topmost hit wins, so later-drawn shapes are picked first — the same order the
 * overlay paints in. Handles beat lines everywhere, because a handle sitting on
 * its own leg would otherwise be impossible to grab.
 */
export function hitTest(shapes: HitShape[], pointer: HitPoint): HitResult | null {
  for (let s = shapes.length - 1; s >= 0; s -= 1) {
    const shape = shapes[s];
    for (let i = shape.points.length - 1; i >= 0; i -= 1) {
      const point = shape.points[i];
      if (Math.hypot(pointer.x - point.x, pointer.y - point.y) <= HANDLE_RADIUS) {
        return { drawingId: shape.id, pointIndex: i };
      }
    }
  }

  for (let s = shapes.length - 1; s >= 0; s -= 1) {
    const shape = shapes[s];
    if (shape.fullWidth) {
      const point = shape.points[0];
      if (point && Math.abs(pointer.y - point.y) <= LINE_RADIUS) {
        return { drawingId: shape.id, pointIndex: null };
      }
      continue;
    }
    for (let i = 1; i < shape.points.length; i += 1) {
      if (distanceToSegment(pointer, shape.points[i - 1], shape.points[i]) <= LINE_RADIUS) {
        return { drawingId: shape.id, pointIndex: null };
      }
    }
  }

  return null;
}

/** Shortest distance from a point to a line segment. */
export function distanceToSegment(point: HitPoint, a: HitPoint, b: HitPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  // Project onto the segment and clamp, so the ends do not extend to infinity.
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
