/**
 * Tool specifications: how many clicks, which labels, which variants. §4, §4.2.
 *
 * Every structure tool takes an **unlabelled origin first**, then one click per
 * label. That matches TradingView and matches how a count is actually drawn —
 * wave 1 is a leg from somewhere, and that somewhere is a point on the chart,
 * not a label.
 */

import type { Degree } from "./degrees";

export const TOOL_KINDS = [
  "impulse",
  "correction",
  "triangle",
  "double-combo",
  "triple-combo",
  "trendline",
  "horizontal",
] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];

/**
 * Variants change which rules apply (§4.2).
 *
 * Diagonals permit wave-4/wave-1 overlap and everything else does not, which
 * makes this the single most consequential switch in the app — hence it lives
 * in the inspector, not behind a menu.
 */
export const IMPULSE_VARIANTS = [
  "standard",
  "leading-diagonal",
  "ending-diagonal",
  "extended-third",
  "extended-fifth",
  "truncated-fifth",
] as const;

export const CORRECTION_VARIANTS = ["zigzag", "regular-flat", "expanded-flat", "running-flat"] as const;

export const TRIANGLE_VARIANTS = ["contracting", "barrier", "expanding", "running"] as const;

export type ImpulseVariant = (typeof IMPULSE_VARIANTS)[number];
export type CorrectionVariant = (typeof CORRECTION_VARIANTS)[number];
export type TriangleVariant = (typeof TRIANGLE_VARIANTS)[number];
export type Variant = ImpulseVariant | CorrectionVariant | TriangleVariant | "none";

export interface ToolSpec {
  kind: ToolKind;
  label: string;
  /** Total clicks, origin included. */
  points: number;
  /** Labels for points 1..n-1; the origin at index 0 is unlabelled. */
  labels: string[];
  variants: readonly string[];
  defaultVariant: Variant;
  /** Structure tools carry a degree; a plain trendline does not. */
  hasDegree: boolean;
}

export const TOOL_SPECS: Record<ToolKind, ToolSpec> = {
  impulse: {
    kind: "impulse",
    label: "Impulse",
    points: 6,
    labels: ["1", "2", "3", "4", "5"],
    variants: IMPULSE_VARIANTS,
    defaultVariant: "standard",
    hasDegree: true,
  },
  correction: {
    kind: "correction",
    label: "Correction",
    points: 4,
    labels: ["A", "B", "C"],
    variants: CORRECTION_VARIANTS,
    defaultVariant: "zigzag",
    hasDegree: true,
  },
  triangle: {
    kind: "triangle",
    label: "Triangle",
    points: 6,
    labels: ["A", "B", "C", "D", "E"],
    variants: TRIANGLE_VARIANTS,
    defaultVariant: "contracting",
    hasDegree: true,
  },
  "double-combo": {
    kind: "double-combo",
    label: "Double Combo",
    points: 4,
    labels: ["W", "X", "Y"],
    variants: [],
    defaultVariant: "none",
    hasDegree: true,
  },
  "triple-combo": {
    kind: "triple-combo",
    label: "Triple Combo",
    points: 6,
    // X appears twice by design — the second X is a distinct pivot at the
    // same notation, exactly as Elliott labels it.
    labels: ["W", "X", "Y", "X", "Z"],
    variants: [],
    defaultVariant: "none",
    hasDegree: true,
  },
  trendline: {
    kind: "trendline",
    label: "Trendline",
    points: 2,
    labels: [],
    variants: [],
    defaultVariant: "none",
    hasDegree: false,
  },
  horizontal: {
    kind: "horizontal",
    label: "Horizontal",
    points: 1,
    labels: [],
    variants: [],
    defaultVariant: "none",
    hasDegree: false,
  },
};

/** A point in chart space: chart time on x, price on y. */
export interface Pivot {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: ToolKind;
  degree: Degree;
  variant: Variant;
  pivots: Pivot[];
  /** False while still being placed. */
  complete: boolean;
}

/** Does this variant permit wave 4 to overlap wave 1? Only diagonals do. */
export function allowsOverlap(drawing: Pick<Drawing, "kind" | "variant">): boolean {
  return (
    drawing.kind === "impulse" &&
    (drawing.variant === "leading-diagonal" || drawing.variant === "ending-diagonal")
  );
}

/** The bare label for a pivot index, or null for the unlabelled origin. */
export function labelForPivot(kind: ToolKind, pivotIndex: number): string | null {
  const spec = TOOL_SPECS[kind];
  if (pivotIndex <= 0) return null;
  return spec.labels[pivotIndex - 1] ?? null;
}

export function isStructureTool(kind: ToolKind): boolean {
  return TOOL_SPECS[kind].hasDegree;
}
