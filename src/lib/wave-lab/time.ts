/**
 * Exchange-time conversion. §2.5 of the brief, and the first thing to get right.
 *
 * NSE trades 09:15–15:30 IST. Kite returns timestamps carrying a `+0530`
 * offset. `lightweight-charts` has no timezone concept at all: it formats a
 * UNIX timestamp as if it were UTC. Pass a real epoch through untouched and the
 * opening bar renders at 03:45, and every intraday wave count is 5h30m wrong.
 *
 * The fix is to hand the chart a *shifted* epoch whose UTC rendering equals the
 * IST wall clock, and to shift back at every boundary going the other way.
 * Never do this arithmetic inline — that is how one boundary gets missed.
 */

/** IST is a fixed +05:30. India has no DST, so a constant is correct here. */
export const IST_OFFSET_MINUTES = 330;
const OFFSET_SECONDS = IST_OFFSET_MINUTES * 60;

/** Seconds past IST midnight for the NSE equity session. */
export const NSE_SESSION = {
  openSeconds: 9 * 3600 + 15 * 60, // 09:15
  closeSeconds: 15 * 3600 + 30 * 60, // 15:30
} as const;

/** What `lightweight-charts` accepts for a time-scale point. */
export type ChartTime = number;

/**
 * Real instant -> chart coordinate.
 *
 * The returned number is deliberately NOT a valid epoch: it is offset so that
 * formatting it as UTC yields IST wall-clock. Only ever feed it to the chart.
 */
export function toChartTime(instant: Date | number | string): ChartTime {
  return Math.floor(toEpochSeconds(instant)) + OFFSET_SECONDS;
}

/** Chart coordinate -> real instant. The exact inverse of `toChartTime`. */
export function fromChartTime(chartTime: ChartTime): Date {
  return new Date((chartTime - OFFSET_SECONDS) * 1000);
}

/** Anything Kite or our own code might hand us -> epoch seconds (UTC). */
export function toEpochSeconds(instant: Date | number | string): number {
  if (instant instanceof Date) return instant.getTime() / 1000;
  if (typeof instant === "number") {
    // Tolerate milliseconds: any plausible epoch in seconds is < 1e11.
    return instant > 1e11 ? instant / 1000 : instant;
  }
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unparseable timestamp: ${instant}`);
  }
  return parsed / 1000;
}

/**
 * `YYYY-MM-DD HH:MM:SS` in IST, which is the format Kite's historical endpoint
 * expects for from/to. Built from UTC parts of a shifted copy so the host
 * machine's own timezone cannot leak in.
 */
export function toKiteDateTime(instant: Date | number | string): string {
  const shifted = new Date((toEpochSeconds(instant) + OFFSET_SECONDS) * 1000);
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${p(shifted.getUTCFullYear(), 4)}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    ` ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`
  );
}

/** Seconds past IST midnight for an instant — used for session-hours checks. */
export function istSecondsOfDay(instant: Date | number | string): number {
  const shifted = toEpochSeconds(instant) + OFFSET_SECONDS;
  return ((shifted % 86400) + 86400) % 86400;
}

/** IST day-of-week, 0 = Sunday. */
export function istDayOfWeek(instant: Date | number | string): number {
  const shifted = new Date((toEpochSeconds(instant) + OFFSET_SECONDS) * 1000);
  return shifted.getUTCDay();
}

/**
 * Is the NSE equity session open at this instant?
 *
 * Weekday and clock only — this does not know the trading-holiday calendar, so
 * treat it as "polling is worth attempting", never as "the market is certainly
 * open". Used to pause quote polling out of hours (§2.6).
 */
export function isMarketOpen(instant: Date | number | string = new Date()): boolean {
  const day = istDayOfWeek(instant);
  if (day === 0 || day === 6) return false;
  const secs = istSecondsOfDay(instant);
  return secs >= NSE_SESSION.openSeconds && secs <= NSE_SESSION.closeSeconds;
}
