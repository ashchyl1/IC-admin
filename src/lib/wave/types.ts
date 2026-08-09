/**
 * Wave Lab domain types.
 *
 * The drawing model is deliberately thin: a tool id, a degree, a variant and an
 * ordered list of (time, price) points. Everything else — labels, leg lengths,
 * ratios, rule verdicts — is derived, so a saved analysis stays valid when the
 * maths improves and there is exactly one source of truth to export to Claude.
 */

import type { Interval, MarketCandle, ProviderInfo, Seconds } from "@/lib/market/types";
import type { DegreeKey } from "./degrees";
import type { ToolId } from "./patterns";

export interface WavePoint {
  time: Seconds;
  price: number;
}

export interface Drawing {
  id: string;
  tool: ToolId;
  degree: DegreeKey;
  /** Pattern sub-type — decides which rules apply. See `patterns.ts`. */
  variant?: string;
  points: WavePoint[];
  /** Analyst's own note, carried through to the export. */
  note?: string;
  /** Overrides the degree colour when set. */
  color?: string;
  hidden?: boolean;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ChartType = "candles" | "bars" | "line" | "area" | "heikin";

export interface ChartTypeSpec {
  id: ChartType;
  label: string;
  hint: string;
}

/**
 * Candles are the default because wave pivots live at the extremes and a line
 * chart hides them. The line option is kept because some analysts prefer to
 * count on closing prices only, which removes overlap ambiguity in diagonals.
 */
export const CHART_TYPES: ChartTypeSpec[] = [
  { id: "candles", label: "Candles", hint: "Pivot highs and lows are visible — the default for wave counting." },
  { id: "bars", label: "OHLC bars", hint: "Same information as candles with less ink; easier on dense charts." },
  { id: "line", label: "Line (close)", hint: "Close-only. Removes intrabar noise and overlap ambiguity." },
  { id: "area", label: "Area", hint: "Close-only with a filled body — good for presenting a finished count." },
  { id: "heikin", label: "Heikin-Ashi", hint: "Smoothed. Reads trend persistence; do not take pivots from it." },
];

export type PriceScaleKind = "linear" | "log";

export interface EmaLine {
  id: string;
  period: number;
  color: string;
  enabled: boolean;
}

export interface BollingerSettings {
  enabled: boolean;
  period: number;
  stdDev: number;
  source: "close" | "hlc3";
  showBasis: boolean;
  fill: boolean;
}

export interface IndicatorSettings {
  emas: EmaLine[];
  bollinger: BollingerSettings;
  vwap: boolean;
  volume: boolean;
}

export const DEFAULT_INDICATORS: IndicatorSettings = {
  emas: [
    { id: "ema20", period: 20, color: "#facc15", enabled: true },
    { id: "ema50", period: 50, color: "#38bdf8", enabled: true },
    { id: "ema200", period: 200, color: "#f472b6", enabled: false },
  ],
  bollinger: { enabled: true, period: 20, stdDev: 2, source: "close", showBasis: true, fill: true },
  vwap: false,
  volume: true,
};

/** One chart terminal's complete state. Two of these make the workspace. */
export interface TerminalState {
  id: string;
  symbol: string;
  /** Display name — falls back to the symbol when the provider gave no name. */
  title: string;
  instrumentToken?: number;
  interval: Interval;
  chartType: ChartType;
  scale: PriceScaleKind;
  indicators: IndicatorSettings;
  drawings: Drawing[];
  /** Currently selected drawing, for the inspector and the delete key. */
  selectedId: string | null;
  activeTool: ToolId;
  degree: DegreeKey;
  variant?: string;
  magnet: boolean;
  showLabels: boolean;
  showRules: boolean;
}

export interface TerminalData {
  candles: MarketCandle[];
  provider: ProviderInfo | null;
  /** Set when a provider failed and a fallback answered. */
  warning?: string;
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful load. */
  loadedAt: number | null;
}

/** Index lookups between chart time and bar number, used by every measurement. */
export interface BarIndex {
  length: number;
  /** Nearest bar index for a chart time; extrapolates past the last bar. */
  indexOf(time: Seconds): number;
  timeAt(index: number): Seconds;
  candleAt(index: number): MarketCandle | null;
}

export function barIndexer(candles: MarketCandle[]): BarIndex {
  const times = candles.map((candle) => candle.time);
  const spacing =
    times.length > 1 ? Math.max(1, (times[times.length - 1] - times[0]) / (times.length - 1)) : 60;

  return {
    length: candles.length,
    indexOf(time: Seconds): number {
      if (times.length === 0) return 0;
      if (time <= times[0]) return Math.round((time - times[0]) / spacing);
      const last = times.length - 1;
      if (time >= times[last]) return last + Math.round((time - times[last]) / spacing);

      let lo = 0;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= time) lo = mid;
        else hi = mid;
      }
      // Snap to whichever neighbour is closer in time.
      return time - times[lo] <= times[hi] - time ? lo : hi;
    },
    timeAt(index: number): Seconds {
      if (times.length === 0) return 0;
      if (index < 0) return times[0] + index * spacing;
      if (index >= times.length) return times[times.length - 1] + (index - times.length + 1) * spacing;
      return times[index];
    },
    candleAt(index: number): MarketCandle | null {
      return candles[index] ?? null;
    },
  };
}

export function isComplete(drawing: Drawing, requiredPoints: number): boolean {
  return drawing.points.length >= requiredPoints;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
