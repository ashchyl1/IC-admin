/**
 * Exchange-clock helpers.
 *
 * Everything in the app reasons in Asia/Kolkata wall-clock, but timestamps are
 * stored as epoch ms. These helpers convert without pulling in a date library,
 * and stay correct if the user's machine sits in another timezone.
 */

import { MARKET_TIMEZONE, SESSION } from "./config";
import type { MarketPhase, Seconds, Timeframe } from "./types";
import { TIMEFRAME_MINUTES } from "./config";

const partsCache = new Map<number, ZoneParts>();

export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

/** Break an instant into Asia/Kolkata calendar parts. */
export function istParts(epochMs: number, timeZone = MARKET_TIMEZONE): ZoneParts {
  // Cache to the minute — this runs on every tick for several components.
  const bucket = Math.floor(epochMs / 1000) * 1000;
  const cached = partsCache.get(bucket);
  if (cached && timeZone === MARKET_TIMEZONE) return cached;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) map[p.type] = p.value;

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const parts: ZoneParts = {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "00" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: Math.max(0, weekdays.indexOf(map.weekday)),
  };

  if (timeZone === MARKET_TIMEZONE) {
    if (partsCache.size > 512) partsCache.clear();
    partsCache.set(bucket, parts);
  }
  return parts;
}

/** Offset of the market timezone at `epochMs`, in seconds. */
export function zoneOffsetSeconds(epochMs: number, timeZone = MARKET_TIMEZONE): number {
  const p = istParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 1000);
}

/**
 * Lightweight Charts plots on a UTC axis. Shifting each point by the exchange
 * offset makes the axis read 09:15 rather than 03:45 without any per-chart
 * timezone plumbing.
 */
export function toChartTime(epochMs: number): Seconds {
  return Math.floor(epochMs / 1000) + zoneOffsetSeconds(epochMs);
}

/**
 * Inverse of `toChartTime`. One correction pass is enough: the first guess is
 * at most a few hours off, which never changes the IST offset (India has no
 * DST), and stays correct for any zone whose offset is stable over that window.
 */
export function fromChartTime(seconds: Seconds): number {
  const guess = seconds * 1000;
  return (seconds - zoneOffsetSeconds(guess)) * 1000;
}

/** Minutes past midnight, exchange local. */
export function minutesOfDay(epochMs: number): number {
  const p = istParts(epochMs);
  return p.hour * 60 + p.minute;
}

export function isWeekend(epochMs: number): boolean {
  const wd = istParts(epochMs).weekday;
  return wd === 0 || wd === 6;
}

export function marketPhase(epochMs: number): MarketPhase {
  if (isWeekend(epochMs)) return "CLOSED";
  const m = minutesOfDay(epochMs);
  if (m >= SESSION.preOpenStart && m < SESSION.open) return "PRE_OPEN";
  if (m >= SESSION.open && m <= SESSION.close) return "OPEN";
  return "CLOSED";
}

/** Epoch ms of 09:15 on the exchange day containing `epochMs`. */
export function sessionOpenMs(epochMs: number): number {
  const p = istParts(epochMs);
  const midnightUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const offset = zoneOffsetSeconds(epochMs) * 1000;
  return midnightUtc - offset + SESSION.open * 60_000;
}

export function sessionCloseMs(epochMs: number): number {
  return sessionOpenMs(epochMs) + (SESSION.close - SESSION.open) * 60_000;
}

/** Walk back `n` trading days (skipping weekends) from `epochMs`. */
export function previousTradingDay(epochMs: number, n = 1): number {
  let cursor = epochMs;
  let left = n;
  while (left > 0) {
    cursor -= 86_400_000;
    if (!isWeekend(cursor)) left -= 1;
  }
  return cursor;
}

/** Next occurrence of `weekday` at or after `epochMs`, as a yyyy-mm-dd string. */
export function nextWeekday(epochMs: number, weekday: number): string {
  let cursor = epochMs;
  for (let i = 0; i < 14; i += 1) {
    const p = istParts(cursor);
    if (p.weekday === weekday) return isoDate(cursor);
    cursor += 86_400_000;
  }
  return isoDate(epochMs);
}

export function isoDate(epochMs: number): string {
  const p = istParts(epochMs);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Trading-days between now and an expiry date, floored at a fraction of a day. */
export function yearsToExpiry(nowMs: number, expiryIso: string): number {
  const [y, m, d] = expiryIso.split("-").map(Number);
  // Expiry settles at 15:30 IST.
  const expiryMs = Date.UTC(y, m - 1, d, 10, 0, 0); // 15:30 IST == 10:00 UTC
  const ms = Math.max(expiryMs - nowMs, 30 * 60_000);
  return ms / (365 * 86_400_000);
}

/** Snap an instant down to the start of its `timeframe` bucket. */
export function bucketStart(epochMs: number, timeframe: Timeframe, anchorMs: number): number {
  const size = TIMEFRAME_MINUTES[timeframe] * 60_000;
  if (timeframe === "1d") return anchorMs;
  return anchorMs + Math.floor((epochMs - anchorMs) / size) * size;
}

// ------------------------------------------------------------ display ---

const clockFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: MARKET_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function clock(epochMs: number): string {
  return clockFmt.format(new Date(epochMs));
}

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: MARKET_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function hhmmss(epochMs: number): string {
  return timeFmt.format(new Date(epochMs));
}

const expiryFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: MARKET_TIMEZONE,
  day: "2-digit",
  month: "short",
});

export function expiryLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return expiryFmt.format(new Date(Date.UTC(y, m - 1, d, 6, 0, 0))).toUpperCase();
}

/** `2m 14s` style duration for the journal. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
