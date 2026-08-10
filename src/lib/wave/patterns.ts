/**
 * The drawing tools.
 *
 * Five Elliott labelling tools matching the TradingView set, plus the
 * measurement tools a wave count needs to be validated: Fibonacci retracement
 * and extension, a trend line for channelling, and a horizontal level.
 *
 * Every Elliott tool is defined by the labels it stamps. The first click is the
 * pattern's origin and carries no label — clicking it is how you tell the tool
 * where wave 1 (or A, or W) began — and each later click is labelled in order.
 */

import type { DegreeKey, LabelKind } from "./degrees";

export type ToolId =
  | "cursor"
  | "impulse"
  | "correction"
  | "triangle"
  | "doubleCombo"
  | "tripleCombo"
  | "fibRetracement"
  | "fibExtension"
  | "trendline"
  | "hline";

export type ElliottToolId = "impulse" | "correction" | "triangle" | "doubleCombo" | "tripleCombo";

export interface PatternVariant {
  id: string;
  label: string;
  /** Shown in the inspector, and folded into the exported analysis. */
  description: string;
}

export interface ToolSpec {
  id: ToolId;
  label: string;
  /** Compact toolbar caption. */
  short: string;
  hint: string;
  /** Total clicks, origin included. */
  points: number;
  /** Labels for points 1..n-1; the origin is unlabelled. */
  labels: string[];
  kind: LabelKind | "measure";
  elliott: boolean;
  variants: PatternVariant[];
  /** Keyboard shortcut shown in the toolbar tooltip. */
  shortcut?: string;
}

const IMPULSE_VARIANTS: PatternVariant[] = [
  {
    id: "impulse",
    label: "Impulse",
    description:
      "Standard five-wave motive sequence. Wave 4 may not enter wave 1's price territory and wave 3 may not be the shortest of 1, 3 and 5.",
  },
  {
    id: "leadingDiagonal",
    label: "Leading diagonal",
    description:
      "Wedge in wave 1 or A position. Wave 4 is allowed to overlap wave 1, and the sub-waves may be 3-3-3-3-3 or 5-3-5-3-5.",
  },
  {
    id: "endingDiagonal",
    label: "Ending diagonal",
    description:
      "Wedge in wave 5 or C position only. Overlap between waves 1 and 4 is expected, waves contract (3 < 1, 5 < 3), and a sharp reversal normally follows.",
  },
  {
    id: "extendedThird",
    label: "Extended third",
    description: "Impulse whose third wave runs beyond 1.618 × wave 1; waves 1 and 5 tend towards equality.",
  },
  {
    id: "truncatedFifth",
    label: "Truncated fifth",
    description: "Wave 5 fails to exceed the end of wave 3 — a sign of exhaustion and a fast retracement.",
  },
];

const CORRECTION_VARIANTS: PatternVariant[] = [
  {
    id: "zigzag",
    label: "Zigzag (5-3-5)",
    description: "Sharp correction. B retraces well under 100% of A; C usually reaches 0.618–1.0 × A or more.",
  },
  {
    id: "flat",
    label: "Flat (3-3-5)",
    description: "Sideways correction. B retraces 90%+ of A and C ends near A's extreme.",
  },
  {
    id: "expandedFlat",
    label: "Expanded flat",
    description: "B exceeds the start of A, and C exceeds the end of A — commonly C ≈ 1.618 × A.",
  },
  {
    id: "runningFlat",
    label: "Running flat",
    description: "B exceeds the start of A but C falls short of A's extreme — a strong-trend signature.",
  },
];

const TRIANGLE_VARIANTS: PatternVariant[] = [
  {
    id: "contracting",
    label: "Contracting",
    description: "Converging boundary lines; each leg smaller than the one before. Thrust follows the E-wave.",
  },
  {
    id: "barrier",
    label: "Barrier",
    description: "B and D end at roughly the same level while A, C and E converge towards it.",
  },
  {
    id: "expanding",
    label: "Expanding",
    description: "Diverging boundary lines; each leg larger than the one before.",
  },
  {
    id: "running",
    label: "Running",
    description: "B exceeds the start of A; the pattern drifts with the larger trend.",
  },
];

const COMBO_VARIANTS: PatternVariant[] = [
  { id: "doubleZigzag", label: "Double zigzag", description: "Two zigzags joined by X. Y often equals W." },
  { id: "doubleFlat", label: "Double flat", description: "Two flats joined by X — sideways and time-consuming." },
  {
    id: "combination",
    label: "Combination",
    description: "Mixed structures (zigzag + flat, or either + triangle as the final leg).",
  },
];

export const TOOLS: Record<ToolId, ToolSpec> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    short: "Select",
    hint: "Select, move and delete existing drawings.",
    points: 0,
    labels: [],
    kind: "measure",
    elliott: false,
    variants: [],
    shortcut: "Esc",
  },
  impulse: {
    id: "impulse",
    label: "Elliott Impulse Wave (12345)",
    short: "12345",
    hint: "Five-wave motive sequence. Click the origin, then each of 1, 2, 3, 4, 5.",
    points: 6,
    labels: ["1", "2", "3", "4", "5"],
    kind: "motive",
    elliott: true,
    variants: IMPULSE_VARIANTS,
    shortcut: "1",
  },
  correction: {
    id: "correction",
    label: "Elliott Correction Wave (ABC)",
    short: "ABC",
    hint: "Three-leg corrective sequence. Click the origin, then A, B, C.",
    points: 4,
    labels: ["A", "B", "C"],
    kind: "corrective",
    elliott: true,
    variants: CORRECTION_VARIANTS,
    shortcut: "2",
  },
  triangle: {
    id: "triangle",
    label: "Elliott Triangle Wave (ABCDE)",
    short: "ABCDE",
    hint: "Five internal legs of a contracting or expanding triangle.",
    points: 6,
    labels: ["A", "B", "C", "D", "E"],
    kind: "corrective",
    elliott: true,
    variants: TRIANGLE_VARIANTS,
    shortcut: "3",
  },
  doubleCombo: {
    id: "doubleCombo",
    label: "Elliott Double Combo Wave (WXY)",
    short: "WXY",
    hint: "Complex correction: double zigzag, double flat or a mixed combination.",
    points: 4,
    labels: ["W", "X", "Y"],
    kind: "corrective",
    elliott: true,
    variants: COMBO_VARIANTS,
    shortcut: "4",
  },
  tripleCombo: {
    id: "tripleCombo",
    label: "Elliott Triple Combo Wave (WXYXZ)",
    short: "WXYXZ",
    hint: "Extended combination — three corrective structures joined by two X waves.",
    points: 6,
    labels: ["W", "X", "Y", "X", "Z"],
    kind: "corrective",
    elliott: true,
    variants: COMBO_VARIANTS,
    shortcut: "5",
  },
  fibRetracement: {
    id: "fibRetracement",
    label: "Fibonacci retracement",
    short: "Fib R",
    hint: "Two clicks along the wave being retraced — swing start to swing end.",
    points: 2,
    labels: [],
    kind: "measure",
    elliott: false,
    variants: [],
    shortcut: "F",
  },
  fibExtension: {
    id: "fibExtension",
    label: "Fibonacci extension",
    short: "Fib E",
    hint: "Three clicks: wave start, wave end, retracement end. Projects the next leg.",
    points: 3,
    labels: [],
    kind: "measure",
    elliott: false,
    variants: [],
    shortcut: "E",
  },
  trendline: {
    id: "trendline",
    label: "Trend line",
    short: "Trend",
    hint: "Two clicks. Use across 2–4 for the base channel line.",
    points: 2,
    labels: [],
    kind: "measure",
    elliott: false,
    variants: [],
    shortcut: "T",
  },
  hline: {
    id: "hline",
    label: "Horizontal level",
    short: "Level",
    hint: "One click. Invalidation levels, prior pivots, round numbers.",
    points: 1,
    labels: [],
    kind: "measure",
    elliott: false,
    variants: [],
    shortcut: "H",
  },
};

export const TOOL_ORDER: ToolId[] = [
  "cursor",
  "impulse",
  "correction",
  "triangle",
  "doubleCombo",
  "tripleCombo",
  "fibRetracement",
  "fibExtension",
  "trendline",
  "hline",
];

export const ELLIOTT_TOOLS: ElliottToolId[] = [
  "impulse",
  "correction",
  "triangle",
  "doubleCombo",
  "tripleCombo",
];

export function isElliottTool(tool: ToolId): tool is ElliottToolId {
  return TOOLS[tool].elliott;
}

export function defaultVariant(tool: ToolId): string | undefined {
  return TOOLS[tool].variants[0]?.id;
}

export function variantSpec(tool: ToolId, variant: string | undefined): PatternVariant | undefined {
  return TOOLS[tool].variants.find((entry) => entry.id === variant);
}

/**
 * The label a given point carries, decorated for its degree. Point 0 is the
 * origin and returns an empty string.
 */
export function labelAt(tool: ToolId, index: number): string {
  return index <= 0 ? "" : (TOOLS[tool].labels[index - 1] ?? "");
}

/** Human-readable sequence, e.g. `(1)-(2)-(3)-(4)-(5)` — used by the export. */
export function sequenceFor(tool: ToolId, degree: DegreeKey, decorate: (base: string, degree: DegreeKey) => string): string {
  return TOOLS[tool].labels.map((base) => decorate(base, degree)).join("-");
}
