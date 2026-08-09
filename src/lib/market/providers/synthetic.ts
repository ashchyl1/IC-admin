import "server-only";

/**
 * Offline fallback provider.
 *
 * Exists so the Wave Lab is usable — and demonstrable — with no broker
 * credentials at all. Rather than a random walk, it lays down a genuine
 * Elliott fractal (5-3 nested to three degrees) and fills it with noise, so the
 * wave tools, the rule checks and the Fibonacci maths all have real structure
 * to bite on.
 *
 * It is deterministic: the same symbol and interval always produce the same
 * series, which makes the wave counts you save against it reproducible. Every
 * response is flagged `live: false` and the workspace shows a simulated-data
 * ribbon — these prices must never be mistaken for the market.
 */

import { toChartTime } from "@/lib/scalper/time";
import { aggregateCandles } from "../normalize";
import {
  INTERVALS,
  type CandleRequest,
  type Instrument,
  type MarketCandle,
  type MarketProvider,
  type MarketQuote,
  type ProviderInfo,
} from "../types";

const PROVIDER = "synthetic" as const;

/** Nominal starting levels, so a NIFTY chart does not open at ₹100. */
const BASES: { match: RegExp; base: number; vol: number }[] = [
  { match: /BANKNIFTY|NIFTY BANK/i, base: 52_400, vol: 0.16 },
  { match: /FINNIFTY/i, base: 23_600, vol: 0.15 },
  { match: /SENSEX/i, base: 79_300, vol: 0.11 },
  { match: /NIFTY/i, base: 24_180, vol: 0.12 },
  { match: /VIX/i, base: 13.4, vol: 0.6 },
];

export class SyntheticProvider implements MarketProvider {
  readonly info: ProviderInfo = {
    id: PROVIDER,
    label: "Simulated data",
    live: false,
    detail: "No broker configured — Elliott-shaped synthetic series",
  };

  async candles(request: CandleRequest): Promise<{
    candles: MarketCandle[];
    instrument: Instrument | null;
  }> {
    const spec = INTERVALS[request.interval];
    const bars = Math.min(2_000, Math.max(220, barsForRange(request, spec.minutes)));
    const { base, vol } = profileFor(request.key);
    const series = buildSeries(hashString(`${request.key}|${request.interval}`), bars, base, vol);
    const stamped = stampTimes(series, request.interval);
    return { candles: aggregateCandles(stamped, request.interval), instrument: null };
  }

  async quotes(keys: string[]): Promise<MarketQuote[]> {
    return keys.map((key) => {
      const { base, vol } = profileFor(key);
      const series = buildSeries(hashString(`${key}|day`), 260, base, vol);
      const last = series[series.length - 1];
      const prev = series[series.length - 2] ?? last;
      return {
        key,
        last: last.close,
        open: last.open,
        high: last.high,
        low: last.low,
        prevClose: prev.close,
        change: last.close - prev.close,
        changePct: ((last.close - prev.close) / prev.close) * 100,
        volume: last.volume,
        oi: null,
        ts: Date.now(),
      };
    });
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    const term = query.replace(/^[A-Z]+:/, "").toUpperCase();
    return DEMO_SYMBOLS.filter(
      (row) => term === "" || row.tradingSymbol.includes(term) || (row.name ?? "").toUpperCase().includes(term)
    ).slice(0, limit);
  }
}

// ------------------------------------------------------- Elliott skeleton ---

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
  // One full cycle: a five up, then a three down, at three degrees of detail.
  const legs = [
    ...expand(2, true, 1, 0.62),
    ...expand(2, false, -0.55, 0.38),
  ];

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
function stampTimes(series: MarketCandle[], interval: string): MarketCandle[] {
  const spec = INTERVALS[interval as keyof typeof INTERVALS] ?? INTERVALS.day;
  const daily = spec.minutes >= 375;
  const stamps: number[] = [];
  const cursor = new Date();
  cursor.setUTCSeconds(0, 0);

  if (daily) {
    // Walk back weekday by weekday, stamping each at the session open.
    const day = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
    while (stamps.length < series.length) {
      const weekday = day.getUTCDay();
      if (weekday !== 0 && weekday !== 6) {
        stamps.push(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 3, 45) );
      }
      day.setUTCDate(day.getUTCDate() - 1);
    }
  } else {
    const stepMs = spec.minutes * 60_000;
    // 09:15 IST == 03:45 UTC; the session is 375 minutes long.
    let probe = Date.now() - (Date.now() % stepMs);
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

function barsForRange(request: CandleRequest, minutes: number): number {
  const from = Date.parse(`${request.from}T00:00:00Z`);
  const to = Date.parse(`${request.to}T23:59:59Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 400;
  const days = (to - from) / 86_400_000;
  const tradingDays = days * (5 / 7);
  return Math.round(minutes >= 375 ? tradingDays : (tradingDays * 375) / minutes);
}

function profileFor(key: string): { base: number; vol: number } {
  for (const row of BASES) if (row.match.test(key)) return { base: row.base, vol: row.vol };
  // Deterministic per-symbol level so INFY and TCS do not draw the same chart.
  const seed = hashString(key);
  return { base: 300 + (seed % 3_400), vol: 0.18 + ((seed >> 8) % 20) / 200 };
}

const DEMO_SYMBOLS: Instrument[] = [
  { instrumentToken: 256265, tradingSymbol: "NIFTY 50", name: "NIFTY 50", exchange: "NSE", segment: "INDICES", key: "NSE:NIFTY 50" },
  { instrumentToken: 260105, tradingSymbol: "NIFTY BANK", name: "NIFTY BANK", exchange: "NSE", segment: "INDICES", key: "NSE:NIFTY BANK" },
  { instrumentToken: 265, tradingSymbol: "SENSEX", name: "SENSEX", exchange: "BSE", segment: "INDICES", key: "BSE:SENSEX" },
  { instrumentToken: 408065, tradingSymbol: "INFY", name: "INFOSYS", exchange: "NSE", instrumentType: "EQ", key: "NSE:INFY" },
  { instrumentToken: 2953217, tradingSymbol: "TCS", name: "TATA CONSULTANCY SERV LT", exchange: "NSE", instrumentType: "EQ", key: "NSE:TCS" },
  { instrumentToken: 341249, tradingSymbol: "HDFCBANK", name: "HDFC BANK", exchange: "NSE", instrumentType: "EQ", key: "NSE:HDFCBANK" },
  { instrumentToken: 1270529, tradingSymbol: "ICICIBANK", name: "ICICI BANK", exchange: "NSE", instrumentType: "EQ", key: "NSE:ICICIBANK" },
  { instrumentToken: 738561, tradingSymbol: "RELIANCE", name: "RELIANCE INDUSTRIES", exchange: "NSE", instrumentType: "EQ", key: "NSE:RELIANCE" },
  { instrumentToken: 1510401, tradingSymbol: "TATAMOTORS", name: "TATA MOTORS", exchange: "NSE", instrumentType: "EQ", key: "NSE:TATAMOTORS" },
  { instrumentToken: 895745, tradingSymbol: "SBIN", name: "STATE BANK OF INDIA", exchange: "NSE", instrumentType: "EQ", key: "NSE:SBIN" },
];

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
