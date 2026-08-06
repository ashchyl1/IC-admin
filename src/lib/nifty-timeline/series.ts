/**
 * The daily Nifty series, and the join between a bar and the recommendation
 * that was live when it printed.
 *
 * The bars come from a committed JSON file rather than a request: the page is a
 * reading of one fixed document against one fixed window, so there is nothing
 * to fetch at runtime. `scripts/build-nifty-daily.mjs` rewrites that file --
 * with real ^NSEI data where the network allows it, and with a
 * casebook-anchored reconstruction otherwise. {@link DAILY_SOURCE} says which,
 * and the page prints it, because a reconstruction shown without that label is
 * just a wrong chart.
 */

import raw from "./nifty-daily.json";
import {
  RECOMMENDATIONS,
  recommendationForDate,
  type Recommendation,
} from "./recommendations";

export interface Bar {
  date: string; // yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type DailySource = "yahoo" | "reconstructed";

export const BARS: Bar[] = raw.bars;
export const DAILY_SOURCE = raw.source as DailySource;
export const DAILY_NOTE: string = raw.note;
export const DAILY_GENERATED_AT: string = raw.generatedAt;

/**
 * A bar plus the call it traded under.
 *
 * `rec` is null for the February-to-April bars: the window is six months, the
 * document starts on 3 May, and pretending otherwise would attribute a call to
 * days it was never made for.
 */
export interface DayPoint extends Bar {
  index: number;
  rec: Recommendation | null;
  /** Trading days since the call was published, 1 on its first session. */
  sessionOfCall: number;
  /** True when this is the first session after publication. */
  isFirstSession: boolean;
  changePoints: number;
  changePercent: number;
}

/** Bars decorated with their governing call. Order matches {@link BARS}. */
export const DAY_POINTS: DayPoint[] = BARS.map((bar, index) => {
  const rec = recommendationForDate(bar.date);
  const prev = index > 0 ? BARS[index - 1].close : bar.open;
  return {
    ...bar,
    index,
    rec,
    sessionOfCall: 0, // filled below, once the runs are known
    isFirstSession: false,
    changePoints: bar.close - prev,
    changePercent: prev ? ((bar.close - prev) / prev) * 100 : 0,
  };
});

{
  let currentDate: string | null = null;
  let n = 0;
  for (const point of DAY_POINTS) {
    if (point.rec?.date !== currentDate) {
      currentDate = point.rec?.date ?? null;
      n = 0;
    }
    n += 1;
    point.sessionOfCall = point.rec ? n : 0;
    point.isFirstSession = Boolean(point.rec) && n === 1;
  }
}

/** The contiguous run of sessions one call governed, for the chart's bands. */
export interface Regime {
  rec: Recommendation;
  fromIndex: number;
  toIndex: number;
}

export const REGIMES: Regime[] = (() => {
  const out: Regime[] = [];
  for (const point of DAY_POINTS) {
    if (!point.rec) continue;
    const last = out[out.length - 1];
    if (last && last.rec.date === point.rec.date) last.toIndex = point.index;
    else out.push({ rec: point.rec, fromIndex: point.index, toIndex: point.index });
  }
  return out;
})();

/**
 * The numbers inside a Target or Reversal string.
 *
 * The document writes these as prose -- "24,854", "23,392-23,100", "23,100
 * trigger", "No new weekly target" -- so the chart parses rather than assumes.
 * Four-digit-and-up numbers only, which is what keeps "Wave 2" and "61.8%"
 * from being read as index levels.
 */
export function parseLevels(text: string): number[] {
  const found = text.match(/\d[\d,]{3,}(?:\.\d+)?/g) ?? [];
  return found
    .map((n) => Number(n.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 1000);
}

/** Recommendations that have at least one session in the window. */
export const ACTIVE_RECOMMENDATIONS = RECOMMENDATIONS.filter((rec) =>
  REGIMES.some((r) => r.rec.date === rec.date)
);

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso}T00:00:00Z`));
}

export function formatWeekday(iso: string): string {
  return WEEKDAY_FMT.format(new Date(`${iso}T00:00:00Z`));
}

export function formatLevel(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
