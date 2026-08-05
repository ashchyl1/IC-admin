/**
 * Shared shape for the Nifty weekly recommendation cards.
 *
 * Both the add form and the route handler import from here so the option lists
 * and the validation rules cannot drift apart. `parsePayload` is the single
 * gate: the route trusts nothing from the browser and re-derives every field
 * through it before touching the database.
 */

export const TRENDS = ["Up", "Down", "Neutral"] as const;
export const BIASES = ["BUY", "SELL", "HOLD", "AVOID"] as const;
export const HORIZONS = ["Short Term", "Medium Term", "Long Term"] as const;
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
export type Horizon = (typeof HORIZONS)[number];
export type SetupStatus = (typeof SETUP_STATUSES)[number];

/**
 * A directional level band, e.g. target 25,150 -> 25,400 or reversal
 * 23,900 -> 23,750. Deliberately not min/max: on a long the reversal band
 * reads downward, so `from` may exceed `to`. Either end may be left blank.
 */
export interface Range {
  from: number | null;
  to: number | null;
}

/** A card as the UI consumes it: levels already narrowed to number arrays. */
export interface Recommendation {
  id: number;
  symbol: string;
  timeframe: string;
  weekEnding: string; // yyyy-mm-dd
  chartImagePath: string | null;
  chartImageUrl: string | null;
  horizon: Horizon;
  trend: Trend;
  bias: Bias;
  setupStatus: SetupStatus;
  spotPrice: number | null;
  changePoints: number | null;
  changePercent: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  target: Range;
  reversal: Range;
  explanatoryNote: string;
  recommendationText: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** What the add form POSTs. Everything optional except the week. */
export interface RecommendationInput {
  weekEnding: string;
  horizon: Horizon;
  trend: Trend;
  bias: Bias;
  setupStatus: SetupStatus;
  spotPrice: number | null;
  changePoints: number | null;
  changePercent: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  target: Range;
  reversal: Range;
  explanatoryNote: string;
  recommendationText: string;
  notes: string;
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

/** Both ends optional, so a one-sided band ("target above 25,150") is valid. */
function toRange(value: unknown): Range {
  if (!value || typeof value !== "object") return { from: null, to: null };
  const r = value as Record<string, unknown>;
  return { from: toNumber(r.from), to: toNumber(r.to) };
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

  // The explanatory note is meant to be a line or two on the card, so it is
  // capped much shorter than the free-form notes box.
  const explanatoryNote =
    typeof b.explanatoryNote === "string" ? b.explanatoryNote.trim().slice(0, 400) : "";
  const recommendationText =
    typeof b.recommendationText === "string" ? b.recommendationText.trim().slice(0, 4000) : "";
  const notes = typeof b.notes === "string" ? b.notes.trim().slice(0, 20000) : "";

  const chartImagePath =
    typeof b.chartImagePath === "string" && b.chartImagePath.trim() ? b.chartImagePath.trim() : null;
  const chartImageUrl =
    typeof b.chartImageUrl === "string" && b.chartImageUrl.trim() ? b.chartImageUrl.trim() : null;

  return {
    ok: true,
    value: {
      weekEnding,
      horizon: oneOf(HORIZONS, b.horizon, "Medium Term"),
      trend: oneOf(TRENDS, b.trend, "Neutral"),
      bias: oneOf(BIASES, b.bias, "HOLD"),
      setupStatus: oneOf(SETUP_STATUSES, b.setupStatus, "Watching"),
      spotPrice: toNumber(b.spotPrice),
      changePoints: toNumber(b.changePoints),
      changePercent: toNumber(b.changePercent),
      supportLevels: toNumberList(b.supportLevels),
      resistanceLevels: toNumberList(b.resistanceLevels),
      target: toRange(b.target),
      reversal: toRange(b.reversal),
      explanatoryNote,
      recommendationText,
      notes,
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
  horizon: string;
  trend: string;
  bias: string;
  setup_status: string;
  spot_price: number | null;
  change_points: number | null;
  change_percent: number | null;
  support_levels: unknown;
  resistance_levels: unknown;
  target_from: number | null;
  target_to: number | null;
  reversal_from: number | null;
  reversal_to: number | null;
  explanatory_note: string;
  recommendation_text: string;
  notes: string;
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
    horizon: oneOf(HORIZONS, row.horizon, "Medium Term"),
    trend: oneOf(TRENDS, row.trend, "Neutral"),
    bias: oneOf(BIASES, row.bias, "HOLD"),
    setupStatus: oneOf(SETUP_STATUSES, row.setup_status, "Watching"),
    spotPrice: toNumber(row.spot_price),
    changePoints: toNumber(row.change_points),
    changePercent: toNumber(row.change_percent),
    supportLevels: toNumberList(row.support_levels),
    resistanceLevels: toNumberList(row.resistance_levels),
    target: { from: toNumber(row.target_from), to: toNumber(row.target_to) },
    reversal: { from: toNumber(row.reversal_from), to: toNumber(row.reversal_to) },
    explanatoryNote: row.explanatory_note,
    recommendationText: row.recommendation_text,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validated input -> database columns. The inverse of `toRecommendation`, and
 * shared by the create and update routes so the two can never disagree about
 * which column a field lands in.
 */
export function toRowValues(v: RecommendationInput) {
  return {
    week_ending: v.weekEnding,
    horizon: v.horizon,
    trend: v.trend,
    bias: v.bias,
    setup_status: v.setupStatus,
    spot_price: v.spotPrice,
    change_points: v.changePoints,
    change_percent: v.changePercent,
    support_levels: v.supportLevels,
    resistance_levels: v.resistanceLevels,
    target_from: v.target.from,
    target_to: v.target.to,
    reversal_from: v.reversal.from,
    reversal_to: v.reversal.to,
    explanatory_note: v.explanatoryNote,
    recommendation_text: v.recommendationText,
    notes: v.notes,
    chart_image_path: v.chartImagePath,
    chart_image_url: v.chartImageUrl,
  };
}

/** "25,150 – 25,400", or a single number if only one end is set, else "—". */
export function formatRange(range: Range, decimals = 0): string {
  const { from, to } = range;
  if (from === null && to === null) return "—";
  if (from !== null && to !== null) {
    return `${formatIndex(from, decimals)} – ${formatIndex(to, decimals)}`;
  }
  return formatIndex(from ?? to, decimals);
}

/** True when neither end of the band was filled in. */
export function isRangeEmpty(range: Range): boolean {
  return range.from === null && range.to === null;
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
