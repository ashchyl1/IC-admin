/**
 * Shared shape for the Nifty weekly recommendation cards.
 *
 * Both the add form and the route handler import from here so the option lists
 * and the validation rules cannot drift apart. `parsePayload` is the single
 * gate: the route trusts nothing from the browser and re-derives every field
 * through it before touching the database.
 */

export const TRENDS = ["Bullish", "Bearish", "Sideways", "Neutral"] as const;
export const BIASES = ["BUY", "SELL", "HOLD", "AVOID"] as const;
export const SETUP_STATUSES = [
  "Watching",
  "Forming",
  "Confirmed",
  "Triggered",
  "Invalidated",
  "Completed",
] as const;

export type Trend = (typeof TRENDS)[number];
export type Bias = (typeof BIASES)[number];
export type SetupStatus = (typeof SETUP_STATUSES)[number];

/** A card as the UI consumes it: levels already narrowed to number arrays. */
export interface Recommendation {
  id: number;
  symbol: string;
  timeframe: string;
  weekEnding: string; // yyyy-mm-dd
  chartImagePath: string | null;
  chartImageUrl: string | null;
  trend: Trend;
  bias: Bias;
  setupStatus: SetupStatus;
  spotPrice: number | null;
  changePoints: number | null;
  changePercent: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  targetLevels: number[];
  invalidationLevels: number[];
  analysis: string;
  createdAt: string;
  updatedAt: string;
}

/** What the add form POSTs. Everything optional except the week. */
export interface RecommendationInput {
  weekEnding: string;
  trend: Trend;
  bias: Bias;
  setupStatus: SetupStatus;
  spotPrice: number | null;
  changePoints: number | null;
  changePercent: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  targetLevels: number[];
  invalidationLevels: number[];
  analysis: string;
  chartImagePath: string | null;
  chartImageUrl: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Coerce to a finite number, or null. Accepts the digit-grouped strings the
 * number inputs can produce when a user pastes "24,150" out of a chart.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Drop blanks and non-numbers; keeps author ordering (S1, S2, ...). */
function toNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toNumber)
    .filter((n): n is number => n !== null)
    .slice(0, 12); // a level list longer than this is a paste accident
}

export function parsePayload(
  body: unknown
): { ok: true; value: RecommendationInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object" };
  const b = body as Record<string, unknown>;

  const weekEnding = typeof b.weekEnding === "string" ? b.weekEnding.trim() : "";
  if (!ISO_DATE.test(weekEnding)) {
    return { ok: false, error: "weekEnding must be a yyyy-mm-dd date" };
  }
  // Reject things like 2026-02-31 that match the pattern but are not real days.
  const parsed = new Date(`${weekEnding}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== weekEnding) {
    return { ok: false, error: `${weekEnding} is not a real date` };
  }

  const analysis = typeof b.analysis === "string" ? b.analysis.trim().slice(0, 20000) : "";

  const chartImagePath =
    typeof b.chartImagePath === "string" && b.chartImagePath.trim() ? b.chartImagePath.trim() : null;
  const chartImageUrl =
    typeof b.chartImageUrl === "string" && b.chartImageUrl.trim() ? b.chartImageUrl.trim() : null;

  return {
    ok: true,
    value: {
      weekEnding,
      trend: oneOf(TRENDS, b.trend, "Neutral"),
      bias: oneOf(BIASES, b.bias, "HOLD"),
      setupStatus: oneOf(SETUP_STATUSES, b.setupStatus, "Watching"),
      spotPrice: toNumber(b.spotPrice),
      changePoints: toNumber(b.changePoints),
      changePercent: toNumber(b.changePercent),
      supportLevels: toNumberList(b.supportLevels),
      resistanceLevels: toNumberList(b.resistanceLevels),
      targetLevels: toNumberList(b.targetLevels),
      invalidationLevels: toNumberList(b.invalidationLevels),
      analysis,
      chartImagePath,
      chartImageUrl,
    },
  };
}

/** Row -> UI shape. jsonb comes back as `Json`, so the levels need narrowing. */
export function toRecommendation(row: {
  id: number;
  symbol: string;
  timeframe: string;
  week_ending: string;
  chart_image_path: string | null;
  chart_image_url: string | null;
  trend: string;
  bias: string;
  setup_status: string;
  spot_price: number | null;
  change_points: number | null;
  change_percent: number | null;
  support_levels: unknown;
  resistance_levels: unknown;
  target_levels: unknown;
  invalidation_levels: unknown;
  analysis: string;
  created_at: string;
  updated_at: string;
}): Recommendation {
  return {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    weekEnding: row.week_ending,
    chartImagePath: row.chart_image_path,
    chartImageUrl: row.chart_image_url,
    trend: oneOf(TRENDS, row.trend, "Neutral"),
    bias: oneOf(BIASES, row.bias, "HOLD"),
    setupStatus: oneOf(SETUP_STATUSES, row.setup_status, "Watching"),
    spotPrice: toNumber(row.spot_price),
    changePoints: toNumber(row.change_points),
    changePercent: toNumber(row.change_percent),
    supportLevels: toNumberList(row.support_levels),
    resistanceLevels: toNumberList(row.resistance_levels),
    targetLevels: toNumberList(row.target_levels),
    invalidationLevels: toNumberList(row.invalidation_levels),
    analysis: row.analysis,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Indian digit grouping, e.g. 2415075 -> "24,15,075". Matches Kite. */
export function formatIndex(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** The Saturday-or-later Friday that closes the week containing `d`. */
export function fridayOf(d: Date): string {
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // getUTCDay: 0 = Sunday .. 5 = Friday, 6 = Saturday.
  const shift = (5 - utc.getUTCDay() + 7) % 7;
  utc.setUTCDate(utc.getUTCDate() + shift);
  return utc.toISOString().slice(0, 10);
}
