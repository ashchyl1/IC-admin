/**
 * OHLCV CSV parsing, validation and timezone normalisation.
 *
 * Pure functions with no I/O so the import rules can be unit tested and reused
 * by both the API route and the preview UI.
 */

export type ColumnMap = {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};

export type ParsedCsv = { headers: string[]; rows: Record<string, string>[] };

export type CandleRow = {
  ts: string; // UTC ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type RowProblem = { line: number; reason: string; raw: string };

export type ValidationReport = {
  valid: CandleRow[];
  problems: RowProblem[];
  duplicatesInFile: number;
  firstTs: string | null;
  lastTs: string | null;
  wasReordered: boolean;
};

/** Header aliases seen in exports from Kite, TradingView, Yahoo, NSE, etc. */
const ALIASES: Record<keyof ColumnMap, string[]> = {
  timestamp: ["timestamp", "date", "datetime", "time", "date_time", "candle_time"],
  open: ["open", "o", "open_price"],
  high: ["high", "h", "high_price"],
  low: ["low", "l", "low_price"],
  close: ["close", "c", "close_price", "last", "adj close"],
  volume: ["volume", "v", "vol", "qty", "quantity"],
};

/** RFC 4180 parser: handles quoted fields, embedded commas and doubled quotes. */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  return {
    headers,
    rows: nonEmpty.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
      return obj;
    }),
  };
}

/** Best-effort column mapping the user can override in the UI. */
export function guessColumns(headers: string[]): Partial<ColumnMap> {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const pick = (key: keyof ColumnMap) => {
    const idx = lower.findIndex((h) => ALIASES[key].includes(h));
    return idx >= 0 ? headers[idx] : undefined;
  };
  return {
    timestamp: pick("timestamp"),
    open: pick("open"),
    high: pick("high"),
    low: pick("low"),
    close: pick("close"),
    volume: pick("volume"),
  };
}

/**
 * Parse a timestamp cell to a UTC ISO string.
 *
 * A value carrying its own offset (or a Z) is authoritative. A naive value is
 * interpreted in `timeZone` -- which is why the importer asks for one.
 */
export function toUtcIso(value: string, timeZone: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();

  // A zone suffix only counts when it actually follows a time. Without the
  // time anchor, a day-first date like "01-02-2026" reads its own year as a
  // "-2026" UTC offset.
  const hasZone = /\d{1,2}:\d{2}(?::\d{2})?\s*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (hasZone) {
    const d = new Date(raw.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const parts = splitNaive(raw);
  if (!parts) return null;

  // Interpret the wall-clock reading in `timeZone`: assume UTC, measure how far
  // off that lands in the zone, then correct. Two passes settle DST boundaries.
  let guess = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s);
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(new Date(guess), timeZone);
    const corrected =
      Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s) - offset;
    if (corrected === guess) break;
    guess = corrected;
  }
  const out = new Date(guess);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

function splitNaive(raw: string) {
  const m =
    raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/) ??
    null;
  if (m) {
    return {
      y: +m[1], mo: +m[2], d: +m[3],
      h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0),
    };
  }
  // DD-MM-YYYY / DD/MM/YYYY
  const e = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (e) {
    return {
      y: +e[3], mo: +e[2], d: +e[1],
      h: +(e[4] ?? 0), mi: +(e[5] ?? 0), s: +(e[6] ?? 0),
    };
  }
  return null;
}

function zoneOffsetMs(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const g: Record<string, string> = {};
  for (const part of p) g[part.type] = part.value;
  const asUtc = Date.UTC(
    +g.year, +g.month - 1, +g.day,
    g.hour === "24" ? 0 : +g.hour, +g.minute, +g.second
  );
  return asUtc - date.getTime();
}

/**
 * Validate every row against the OHLC invariants and drop in-file duplicates
 * (last one wins). Rows are returned sorted ascending by timestamp.
 */
export function validateRows(
  rows: Record<string, string>[],
  columns: ColumnMap,
  timeZone: string
): ValidationReport {
  const problems: RowProblem[] = [];
  const byTs = new Map<string, CandleRow>();
  let duplicatesInFile = 0;

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based, +1 for the header
    const raw = JSON.stringify(row);

    const ts = toUtcIso(row[columns.timestamp] ?? "", timeZone);
    if (!ts) {
      problems.push({ line, reason: `Unrecognised timestamp "${row[columns.timestamp] ?? ""}"`, raw });
      return;
    }

    const open = Number(row[columns.open]);
    const high = Number(row[columns.high]);
    const low = Number(row[columns.low]);
    const close = Number(row[columns.close]);
    const volume = columns.volume ? Number(row[columns.volume] || 0) : 0;

    const nums = { open, high, low, close };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v)) {
        problems.push({ line, reason: `${k} is not a number`, raw });
        return;
      }
      if (v <= 0) {
        problems.push({ line, reason: `${k} must be positive (got ${v})`, raw });
        return;
      }
    }
    if (!Number.isFinite(volume) || volume < 0) {
      problems.push({ line, reason: `volume must be zero or positive`, raw });
      return;
    }
    if (high < open || high < low || high < close) {
      problems.push({ line, reason: `high (${high}) is below open/low/close`, raw });
      return;
    }
    if (low > open || low > high || low > close) {
      problems.push({ line, reason: `low (${low}) is above open/high/close`, raw });
      return;
    }

    if (byTs.has(ts)) duplicatesInFile++;
    byTs.set(ts, { ts, open, high, low, close, volume });
  });

  const valid = [...byTs.values()];
  const wasReordered = valid.some((c, i) => i > 0 && c.ts < valid[i - 1].ts);
  valid.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  return {
    valid,
    problems,
    duplicatesInFile,
    firstTs: valid.length ? valid[0].ts : null,
    lastTs: valid.length ? valid[valid.length - 1].ts : null,
    wasReordered,
  };
}
