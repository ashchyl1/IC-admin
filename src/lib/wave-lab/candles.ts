/**
 * Pure operations on candle arrays: merging, freshness and aggregation.
 *
 * Kept free of I/O so the rules in §2.6 can be tested exhaustively — these are
 * the functions that decide whether a chart shows stale data, and getting the
 * merge wrong corrupts a dataset silently.
 */

import { INTERVAL_SECONDS, isIntraday, type Interval, type MarketCandle } from "./types";
import { toChartTime } from "./time";

/** Build a candle from a true instant, filling both time representations. */
export function makeCandle(
  epochSeconds: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume = 0
): MarketCandle {
  return {
    epochSeconds,
    time: toChartTime(epochSeconds),
    open: o,
    high: h,
    low: l,
    close: c,
    volume,
  };
}

/**
 * Merge freshly fetched bars into cached ones.
 *
 * On a timestamp collision the **incoming (broker) bar wins**: its copy of a
 * still-forming candle is by definition newer than anything already stored.
 * Getting this backwards freezes the current bar at whatever it looked like
 * the first time it was seen, which is invisible until someone notices the
 * last candle never updates.
 */
export function mergeCandles(cached: MarketCandle[], incoming: MarketCandle[]): MarketCandle[] {
  if (!cached.length) return [...incoming].sort(byTime);
  if (!incoming.length) return [...cached].sort(byTime);

  const merged = new Map<number, MarketCandle>();
  for (const c of cached) merged.set(c.epochSeconds, c);
  for (const c of incoming) merged.set(c.epochSeconds, c); // incoming wins
  return [...merged.values()].sort(byTime);
}

const byTime = (a: MarketCandle, b: MarketCandle) => a.epochSeconds - b.epochSeconds;

/**
 * How much staleness a given interval tolerates before we re-fetch (§2.6).
 *
 * Daily gets ~4 days of slack so a weekend plus a holiday does not trigger a
 * pointless request; intraday gets two intervals or 15 minutes, whichever is
 * longer, so a 1-minute chart is not hammering the endpoint every minute.
 */
export function freshnessWindowSeconds(interval: Interval): number {
  if (!isIntraday(interval)) return 4 * 86400;
  return Math.max(2 * INTERVAL_SECONDS[interval], 15 * 60);
}

/**
 * Is a cache entry fresh enough to serve without calling the broker?
 *
 * Judged on when the data was *fetched*, not on the last bar's timestamp — an
 * empty range legitimately has no bars, and a market that has been shut all
 * weekend has an old last bar while the cache is perfectly current.
 */
export function isFresh(fetchedAtSeconds: number, interval: Interval, now = Date.now() / 1000) {
  return now - fetchedAtSeconds <= freshnessWindowSeconds(interval);
}

/** Inclusive window filter, on true instants rather than chart coordinates. */
export function sliceRange(candles: MarketCandle[], fromSec: number, toSec: number) {
  return candles.filter((c) => c.epochSeconds >= fromSec && c.epochSeconds <= toSec);
}

/**
 * Fold daily bars into weekly or monthly ones.
 *
 * Kite has no weekly or monthly candle, so these are derived. Buckets are keyed
 * on the IST calendar (via the shifted chart time) so a week starts on the
 * right Monday rather than drifting by the host timezone.
 */
export function aggregateDaily(daily: MarketCandle[], target: "1W" | "1M"): MarketCandle[] {
  if (!daily.length) return [];
  const sorted = [...daily].sort(byTime);
  const buckets = new Map<string, MarketCandle[]>();

  for (const bar of sorted) {
    const key = target === "1W" ? istWeekKey(bar.epochSeconds) : istMonthKey(bar.epochSeconds);
    const list = buckets.get(key);
    if (list) list.push(bar);
    else buckets.set(key, [bar]);
  }

  const out: MarketCandle[] = [];
  for (const group of buckets.values()) {
    // The bucket carries the FIRST bar's timestamp: a weekly candle is dated by
    // the week it opens, and dating it by the close would place an in-progress
    // week in the future.
    out.push(
      makeCandle(
        group[0].epochSeconds,
        group[0].open,
        Math.max(...group.map((b) => b.high)),
        Math.min(...group.map((b) => b.low)),
        group[group.length - 1].close,
        group.reduce((sum, b) => sum + b.volume, 0)
      )
    );
  }
  return out.sort(byTime);
}

/** ISO-style year-week key in IST. Weeks start Monday. */
function istWeekKey(epochSeconds: number): string {
  const d = istDate(epochSeconds);
  // Shift to the Monday of this week, then key on that date.
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function istMonthKey(epochSeconds: number): string {
  const d = istDate(epochSeconds);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

/** A Date whose UTC fields read as IST wall-clock. Never expose this outward. */
function istDate(epochSeconds: number): Date {
  return new Date(toChartTime(epochSeconds) * 1000);
}
