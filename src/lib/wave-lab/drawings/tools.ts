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
  "parallel-channel",
  "triangle-channel",
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
  // Two clicks set the base line, the third places the parallel. This single
  // tool is both the plain "parallel channel" and the "custom three-point
  // channel" — they are the same construction.
  "parallel-channel": {
    kind: "parallel-channel",
    label: "Parallel channel",
    points: 3,
    labels: [],
    variants: [],
    defaultVariant: "none",
    hasDegree: false,
  },
  // Four clicks: A–C, then B–D. Converging, not parallel.
  "triangle-channel": {
    kind: "triangle-channel",
    label: "Triangle channel",
    points: 4,
    labels: [],
    variants: [],
    defaultVariant: "none",
    hasDegree: false,
  },
};

/** Per-drawing appearance. All optional, so older saved drawings still load. */
export interface DrawingStyle {
  color?: string;
  lineStyle?: "solid" | "dashed" | "dotted";
  thickness?: number;
  fill?: boolean;
  fillOpacity?: number;
}

export const DEFAULT_STYLE: Required<DrawingStyle> = {
  color: "#387ed1",
  lineStyle: "solid",
  thickness: 1.5,
  fill: true,
  fillOpacity: 0.07,
};

/** SVG dash pattern for a line style. Empty string means solid. */
export function dashArray(style: DrawingStyle["lineStyle"], thickness = 1.5): string | undefined {
  if (style === "dashed") return `${thickness * 4} ${thickness * 3}`;
  if (style === "dotted") return `${thickness} ${thickness * 2.5}`;
  return undefined;
}

export function isChannel(kind: ToolKind): boolean {
  return kind === "parallel-channel" || kind === "triangle-channel";
}

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
  style?: DrawingStyle;
  /** Locked drawings render normally but refuse selection and dragging. */
  locked?: boolean;
  /** Hidden drawings are kept but not drawn, and cannot be hit. */
  hidden?: boolean;
  /** Channels only: run the lines out to the pane edges. */
  extend?: boolean;
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
