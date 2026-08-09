/**
 * Deterministic synthetic price series.
 *
 * Client-safe and dependency-free, because two places need it: the server-side
 * `synthetic` provider (the offline fallback for `/api/market/*`) and the
 * standalone build of the workspace, which has no server at all.
 *
 * Rather than a random walk it lays down a genuine Elliott fractal — a five up
 * and a three down, nested to three degrees — and fills it with noise, so the
 * wave tools, the rule checks and the Fibonacci maths all have real structure
 * to bite on. The same symbol and interval always produce the same series, so a
 * count saved against it is reproducible.
 *
 * These prices are invented. Everything that renders them must say so.
 */

import { toChartTime } from "@/lib/scalper/time";
import { INTERVALS, type Instrument, type Interval, type MarketCandle } from "./types";

/** Nominal starting levels, so a NIFTY chart does not open at ₹100. */
const BASES: { match: RegExp; base: number; vol: number }[] = [
  { match: /BANKNIFTY|NIFTY BANK/i, base: 52_400, vol: 0.16 },
  { match: /FINNIFTY/i, base: 23_600, vol: 0.15 },
  { match: /SENSEX/i, base: 79_300, vol: 0.11 },
  { match: /NIFTY/i, base: 24_180, vol: 0.12 },
  { match: /VIX/i, base: 13.4, vol: 0.6 },
];

interface Leg {
  /** Signed fraction of the parent leg's price span. */
  move: number;
  /** Share of the parent leg's bar budget. */
  span: number;
  motive: boolean;
}

/** Classic proportions: an extended third, a shallow fourth, a fifth near wave one. */
const IMPULSE: Leg[] = [
  { move: 0.38, span: 0.16, motive: true },
  { move: -0.19, span: 0.14, motive: false },
  { move: 0.72, span: 0.3, motive: true },
  { move: -0.16, span: 0.18, motive: false },
  { move: 0.35, span: 0.22, motive: true },
];

/** Zigzag: C runs a shade past A, B holds around 0.5. */
const ZIGZAG: Leg[] = [
  { move: -0.58, span: 0.34, motive: true },
  { move: 0.29, span: 0.28, motive: false },
  { move: -0.71, span: 0.38, motive: true },
];

/**
 * Expand the fractal into a flat list of pivot-to-pivot legs. Motive legs
 * subdivide into fives, corrective legs into threes, until `depth` runs out.
 */
function expand(depth: number, motive: boolean, move: number, span: number): { move: number; span: number }[] {
  if (depth <= 0) return [{ move, span }];
  const template = motive ? IMPULSE : ZIGZAG;
  const netMove = template.reduce((sum, leg) => sum + leg.move, 0);
  const netSpan = template.reduce((sum, leg) => sum + leg.span, 0);
  const direction = move >= 0 ? 1 : -1;

  const out: { move: number; span: number }[] = [];
  for (const leg of template) {
    // Normalise so the children reproduce exactly the parent's net move, then
    // flip them when the parent runs the other way.
    const childMove = (leg.move / netMove) * Math.abs(move) * direction * (netMove >= 0 ? 1 : -1);
    const childSpan = (leg.span / netSpan) * span;
    out.push(...expand(depth - 1, leg.motive, childMove, childSpan));
  }
  return out;
}

function buildSeries(seed: number, bars: number, base: number, vol: number): MarketCandle[] {
  const rand = mulberry32(seed);
  const legs = [...expand(2, true, 1, 0.62), ...expand(2, false, -0.55, 0.38)];

  const totalSpan = legs.reduce((sum, leg) => sum + leg.span, 0) || 1;
  const amplitude = base * vol * 1.6;

  // Pivot ladder first: every leg contributes its endpoint price and bar count.
  const pivots: { bar: number; price: number }[] = [{ bar: 0, price: base }];
  let bar = 0;
  let price = base;
  for (const leg of legs) {
    const legBars = Math.max(3, Math.round((leg.span / totalSpan) * bars));
    bar += legBars;
    price += leg.move * amplitude * (0.85 + rand() * 0.3);
    pivots.push({ bar, price: Math.max(price, base * 0.15) });
  }

  const out: MarketCandle[] = [];
  const noise = base * vol * 0.012;

  for (let i = 1; i < pivots.length; i += 1) {
    const from = pivots[i - 1];
    const to = pivots[i];
    const steps = Math.max(1, to.bar - from.bar);
    let prevClose = from.price;

    for (let s = 1; s <= steps; s += 1) {
      // Ease the leg so pivots look like turns rather than corners.
      const t = s / steps;
      const eased = t * t * (3 - 2 * t);
      const target = from.price + (to.price - from.price) * eased;
      const close = target + (rand() - 0.5) * noise * 4;
      const open = prevClose;
      const wick = noise * (0.6 + rand() * 1.8);
      const high = Math.max(open, close) + wick * rand();
      const low = Math.min(open, close) - wick * rand();
      out.push({
        time: 0, // stamped by `stampTimes`
        open: round2(open),
        high: round2(high),
        low: round2(Math.max(low, 0.05)),
        close: round2(close),
        volume: Math.round(120_000 * (0.5 + rand()) * (1 + Math.abs(close - open) / (noise * 6 || 1))),
      });
      prevClose = close;
    }
  }
  return out;
}

/**
 * Lay the generated bars onto a plausible exchange calendar ending at the last
 * completed bar before now: weekdays only, and 09:15–15:30 for intraday.
 */
function stampTimes(series: MarketCandle[], interval: Interval, nowMs: number): MarketCandle[] {
  const spec = INTERVALS[interval] ?? INTERVALS.day;
  const daily = spec.minutes >= 375;
  const stamps: number[] = [];

  if (daily) {
    const cursor = new Date(nowMs);
    const day = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
    while (stamps.length < series.length) {
      const weekday = day.getUTCDay();
      // 09:15 IST is 03:45 UTC.
      if (weekday !== 0 && weekday !== 6) {
        stamps.push(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 3, 45));
      }
      day.setUTCDate(day.getUTCDate() - 1);
    }
  } else {
    const stepMs = spec.minutes * 60_000;
    let probe = nowMs - (nowMs % stepMs);
    while (stamps.length < series.length) {
      const d = new Date(probe);
      const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes();
      const weekday = d.getUTCDay();
      const inSession = minutesUtc >= 225 && minutesUtc <= 600;
      if (weekday !== 0 && weekday !== 6 && inSession) stamps.push(probe);
      probe -= stepMs;
    }
  }

  stamps.reverse();
  return series.map((candle, i) => ({ ...candle, time: toChartTime(stamps[i]) }));
}

export function barsForRange(from: string, to: string, minutes: number): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T23:59:59Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 400;
  const tradingDays = ((end - start) / 86_400_000) * (5 / 7);
  return Math.round(minutes >= 375 ? tradingDays : (tradingDays * 375) / minutes);
}

export function profileFor(key: string): { base: number; vol: number } {
  for (const row of BASES) if (row.match.test(key)) return { base: row.base, vol: row.vol };
  // Deterministic per-symbol level so INFY and TCS do not draw the same chart.
  const seed = hashString(key);
  return { base: 300 + (seed % 3_400), vol: 0.18 + ((seed >> 8) % 20) / 200 };
}

/** The one entry point: a full synthetic series for a symbol and interval. */
export function syntheticCandles(
  key: string,
  interval: Interval,
  bars: number,
  nowMs = Date.now()
): MarketCandle[] {
  const count = Math.min(2_000, Math.max(220, bars));
  const { base, vol } = profileFor(key);
  return stampTimes(buildSeries(hashString(`${key}|${interval}`), count, base, vol), interval, nowMs);
}

export const DEMO_SYMBOLS: Instrument[] = [
  { instrumentToken: 256265, tradingSymbol: "NIFTY 50", name: "NIFTY 50", exchange: "NSE", segment: "INDICES", key: "NSE:NIFTY 50" },
  { instrumentToken: 260105, tradingSymbol: "NIFTY BANK", name: "NIFTY BANK", exchange: "NSE", segment: "INDICES", key: "NSE:NIFTY BANK" },
  { instrumentToken: 257801, tradingSymbol: "FINNIFTY", name: "NIFTY FIN SERVICE", exchange: "NSE", segment: "INDICES", key: "NSE:FINNIFTY" },
  { instrumentToken: 265, tradingSymbol: "SENSEX", name: "SENSEX", exchange: "BSE", segment: "INDICES", key: "BSE:SENSEX" },
  { instrumentToken: 408065, tradingSymbol: "INFY", name: "INFOSYS", exchange: "NSE", instrumentType: "EQ", key: "NSE:INFY" },
  { instrumentToken: 2953217, tradingSymbol: "TCS", name: "TATA CONSULTANCY SERV LT", exchange: "NSE", instrumentType: "EQ", key: "NSE:TCS" },
  { instrumentToken: 341249, tradingSymbol: "HDFCBANK", name: "HDFC BANK", exchange: "NSE", instrumentType: "EQ", key: "NSE:HDFCBANK" },
  { instrumentToken: 1270529, tradingSymbol: "ICICIBANK", name: "ICICI BANK", exchange: "NSE", instrumentType: "EQ", key: "NSE:ICICIBANK" },
  { instrumentToken: 738561, tradingSymbol: "RELIANCE", name: "RELIANCE INDUSTRIES", exchange: "NSE", instrumentType: "EQ", key: "NSE:RELIANCE" },
  { instrumentToken: 1510401, tradingSymbol: "TATAMOTORS", name: "TATA MOTORS", exchange: "NSE", instrumentType: "EQ", key: "NSE:TATAMOTORS" },
  { instrumentToken: 895745, tradingSymbol: "SBIN", name: "STATE BANK OF INDIA", exchange: "NSE", instrumentType: "EQ", key: "NSE:SBIN" },
  { instrumentToken: 2939649, tradingSymbol: "SUNPHARMA", name: "SUN PHARMACEUTICAL IND L", exchange: "NSE", instrumentType: "EQ", key: "NSE:SUNPHARMA" },
];

export function searchDemoSymbols(query: string, limit: number): Instrument[] {
  const term = query.replace(/^[A-Z]+:/i, "").trim().toUpperCase();
  return DEMO_SYMBOLS.filter(
    (row) =>
      term === "" ||
      row.tradingSymbol.toUpperCase().includes(term) ||
      (row.name ?? "").toUpperCase().includes(term)
  ).slice(0, limit);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
