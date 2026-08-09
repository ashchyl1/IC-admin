/**
 * Shape-tolerant parsing of broker payloads.
 *
 * Kite Connect, the Kite MCP server and a hand-rolled bridge all return the
 * same numbers in three different shapes, and MCP tool output in particular is
 * only loosely specified — sometimes structured JSON, sometimes JSON inside a
 * text block. Rather than pin each provider to one exact schema and break the
 * moment a version bumps, every provider funnels its raw payload through here.
 */

import { toChartTime } from "@/lib/scalper/time";
import { INTERVALS, type Instrument, type Interval, type MarketCandle, type MarketQuote } from "./types";

type Json = unknown;

function asRecord(value: Json): Record<string, Json> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function num(value: Json): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Epoch ms from whatever the provider called a timestamp: an ISO string with an
 * offset (`2024-05-02T09:15:00+0530`), a bare date, epoch seconds, or epoch ms.
 */
export function parseTimestamp(value: Json): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Anything below ~Sep 2001 in ms is far more likely to be seconds.
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // Kite writes +0530 without a colon, which older JS engines reject.
  const iso = trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const direct = Date.parse(iso);
  if (Number.isFinite(direct)) return direct;

  // `2024-05-02 09:15:00` — no zone marker. Kite means IST when it does this.
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0) - 5.5 * 3_600_000;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    // Stamp a daily bar at the session open so the chart axis reads sensibly.
    return Date.UTC(+y, +mo - 1, +d, 9, 15, 0) - 5.5 * 3_600_000;
  }
  return null;
}

/** `[timestamp, o, h, l, c, volume, oi?]` — the Kite historical row. */
function candleFromArray(row: Json[]): MarketCandle | null {
  const ms = parseTimestamp(row[0]);
  const open = num(row[1]);
  const high = num(row[2]);
  const low = num(row[3]);
  const close = num(row[4]);
  if (ms === null || open === null || high === null || low === null || close === null) return null;
  const candle: MarketCandle = {
    time: toChartTime(ms),
    open,
    high,
    low,
    close,
    volume: num(row[5]) ?? 0,
  };
  const oi = num(row[6]);
  if (oi !== null) candle.oi = oi;
  return candle;
}

function candleFromObject(row: Record<string, Json>): MarketCandle | null {
  const ms = parseTimestamp(row.date ?? row.timestamp ?? row.time ?? row.datetime ?? row.t);
  const open = num(row.open ?? row.o);
  const high = num(row.high ?? row.h);
  const low = num(row.low ?? row.l);
  const close = num(row.close ?? row.c);
  if (ms === null || open === null || high === null || low === null || close === null) return null;
  const candle: MarketCandle = {
    time: toChartTime(ms),
    open,
    high,
    low,
    close,
    volume: num(row.volume ?? row.v) ?? 0,
  };
  const oi = num(row.oi ?? row.open_interest ?? row.openInterest);
  if (oi !== null) candle.oi = oi;
  return candle;
}

/**
 * Dig the candle list out of any of the wrappers a provider might use, then
 * parse each row. Returns bars sorted oldest-first with duplicate timestamps
 * collapsed — a re-request that overlaps an earlier page is normal, and two
 * bars on one timestamp would make Lightweight Charts throw.
 */
export function toCandles(payload: Json): MarketCandle[] {
  const rows = findCandleRows(payload);
  const out: MarketCandle[] = [];
  for (const row of rows) {
    const parsed = Array.isArray(row) ? candleFromArray(row) : parseObjectRow(row);
    if (parsed) out.push(parsed);
  }
  return dedupe(out);
}

function parseObjectRow(row: Json): MarketCandle | null {
  const record = asRecord(row);
  return record ? candleFromObject(record) : null;
}

function findCandleRows(payload: Json): Json[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["candles", "data", "result", "records", "bars", "ohlc", "history"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value !== undefined) {
      const nested = findCandleRows(value);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export function dedupe(candles: MarketCandle[]): MarketCandle[] {
  const byTime = new Map<number, MarketCandle>();
  for (const candle of candles) byTime.set(candle.time, candle);
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/**
 * Roll native bars up into a coarser interval. Only used for week and month,
 * which Kite does not serve — everything else comes back already bucketed.
 */
export function aggregateCandles(candles: MarketCandle[], interval: Interval): MarketCandle[] {
  if (INTERVALS[interval].native || candles.length === 0) return candles;

  const out: MarketCandle[] = [];
  let bucket: MarketCandle | null = null;
  let bucketKey = "";

  for (const candle of candles) {
    const key = interval === "week" ? weekKey(candle.time) : monthKey(candle.time);
    if (!bucket || key !== bucketKey) {
      if (bucket) out.push(bucket);
      bucketKey = key;
      bucket = { ...candle };
    } else {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
      if (candle.oi !== undefined) bucket.oi = candle.oi;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

/** ISO week bucket. Chart times are already exchange-local, so UTC maths is right. */
function weekKey(seconds: number): string {
  const date = new Date(seconds * 1000);
  const day = date.getUTCDay();
  // Monday-anchored: Sunday (0) belongs to the week that started six days ago.
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
    ((day + 6) % 7) * 86_400_000;
  return String(monday);
}

function monthKey(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

// ---------------------------------------------------------------- quotes ---

export function toQuotes(payload: Json, requested: string[]): MarketQuote[] {
  const container = unwrapData(payload);
  const out: MarketQuote[] = [];
  const record = asRecord(container);

  if (record) {
    for (const [key, value] of Object.entries(record)) {
      const quote = quoteFrom(key, value);
      if (quote) out.push(quote);
    }
  } else if (Array.isArray(container)) {
    container.forEach((value, index) => {
      const row = asRecord(value);
      const key =
        (typeof row?.instrument === "string" && row.instrument) ||
        (typeof row?.symbol === "string" && row.symbol) ||
        (typeof row?.tradingsymbol === "string" && row.tradingsymbol) ||
        requested[index] ||
        `#${index}`;
      const quote = quoteFrom(key, value);
      if (quote) out.push(quote);
    });
  }
  return out;
}

function quoteFrom(key: string, value: Json): MarketQuote | null {
  const row = asRecord(value);
  if (!row) {
    // `get_ltp` style: { "NSE:INFY": 1523.4 }
    const last = num(value);
    return last === null
      ? null
      : {
          key,
          last,
          open: null,
          high: null,
          low: null,
          prevClose: null,
          change: null,
          changePct: null,
          volume: null,
          oi: null,
          ts: Date.now(),
        };
  }

  const last = num(row.last_price ?? row.lastPrice ?? row.ltp ?? row.last ?? row.price ?? row.close);
  if (last === null) return null;

  const ohlc = asRecord(row.ohlc) ?? {};
  const prevClose = num(ohlc.close ?? row.prev_close ?? row.previousClose ?? row.close);
  const change = num(row.net_change ?? row.change) ?? (prevClose !== null ? last - prevClose : null);

  return {
    key,
    last,
    open: num(ohlc.open ?? row.open),
    high: num(ohlc.high ?? row.high),
    low: num(ohlc.low ?? row.low),
    prevClose,
    change,
    changePct:
      prevClose !== null && prevClose !== 0 && change !== null ? (change / prevClose) * 100 : null,
    volume: num(row.volume ?? row.volume_traded ?? row.last_quantity),
    oi: num(row.oi ?? row.open_interest),
    ts: parseTimestamp(row.timestamp ?? row.last_trade_time) ?? Date.now(),
  };
}

function unwrapData(payload: Json): Json {
  const record = asRecord(payload);
  if (!record) return payload;
  if (record.data !== undefined) return unwrapData(record.data);
  if (record.result !== undefined) return unwrapData(record.result);
  return record;
}

// ----------------------------------------------------------- instruments ---

export function toInstruments(payload: Json): Instrument[] {
  const container = unwrapData(payload);
  const rows = Array.isArray(container)
    ? container
    : Array.isArray(asRecord(container)?.instruments)
      ? (asRecord(container)!.instruments as Json[])
      : [];

  const out: Instrument[] = [];
  for (const value of rows) {
    const instrument = instrumentFrom(value);
    if (instrument) out.push(instrument);
  }
  return out;
}

export function instrumentFrom(value: Json): Instrument | null {
  const row = asRecord(value);
  if (!row) return null;

  const tradingSymbol =
    (typeof row.tradingsymbol === "string" && row.tradingsymbol) ||
    (typeof row.trading_symbol === "string" && row.trading_symbol) ||
    (typeof row.symbol === "string" && row.symbol) ||
    "";
  const exchange = (typeof row.exchange === "string" && row.exchange) || "NSE";
  const token = num(row.instrument_token ?? row.instrumentToken ?? row.token);
  if (!tradingSymbol || token === null) return null;

  return {
    instrumentToken: token,
    exchangeToken: num(row.exchange_token) ?? undefined,
    tradingSymbol,
    name: typeof row.name === "string" ? row.name : undefined,
    exchange,
    segment: typeof row.segment === "string" ? row.segment : undefined,
    instrumentType:
      (typeof row.instrument_type === "string" && row.instrument_type) ||
      (typeof row.instrumentType === "string" && row.instrumentType) ||
      undefined,
    expiry: typeof row.expiry === "string" && row.expiry !== "" ? row.expiry : null,
    strike: num(row.strike),
    lotSize: num(row.lot_size ?? row.lotSize),
    tickSize: num(row.tick_size ?? row.tickSize),
    key: `${exchange}:${tradingSymbol}`,
  };
}

/** Kite's `/instruments` CSV dump, used by the REST provider's symbol search. */
export function parseInstrumentCsv(csv: string): Instrument[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const out: Instrument[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < header.length) continue;
    const row: Record<string, Json> = {};
    header.forEach((name, index) => {
      row[name] = cells[index];
    });
    const instrument = instrumentFrom(row);
    if (instrument) out.push(instrument);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}
