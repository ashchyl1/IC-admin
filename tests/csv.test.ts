import { describe, expect, it } from "vitest";
import { guessColumns, parseCsv, toUtcIso, validateRows, type ColumnMap } from "@/lib/paper/csv";

const COLS: ColumnMap = {
  timestamp: "date",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
};

describe("parseCsv", () => {
  it("parses a plain file", () => {
    const { headers, rows } = parseCsv("date,open\n2026-01-01,100\n2026-01-02,101\n");
    expect(headers).toEqual(["date", "open"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ date: "2026-01-02", open: "101" });
  });

  it("handles quoted fields, embedded commas and doubled quotes", () => {
    const { rows } = parseCsv('name,note\n"ACME, Inc.","he said ""hi"""\n');
    expect(rows[0].name).toBe("ACME, Inc.");
    expect(rows[0].note).toBe('he said "hi"');
  });

  it("strips a UTF-8 BOM and tolerates CRLF", () => {
    const { headers, rows } = parseCsv("﻿date,open\r\n2026-01-01,100\r\n");
    expect(headers[0]).toBe("date");
    expect(rows).toHaveLength(1);
  });
});

describe("guessColumns", () => {
  it("recognises common export headers", () => {
    expect(guessColumns(["Date", "Open", "High", "Low", "Close", "Volume"])).toEqual({
      timestamp: "Date", open: "Open", high: "High", low: "Low", close: "Close", volume: "Volume",
    });
  });

  it("leaves unknown headers unmapped rather than guessing wrong", () => {
    expect(guessColumns(["t", "px"]).timestamp).toBeUndefined();
  });
});

describe("toUtcIso", () => {
  it("treats a naive timestamp as market-local", () => {
    // 09:15 IST == 03:45 UTC
    expect(toUtcIso("2026-01-01 09:15:00", "Asia/Kolkata")).toBe("2026-01-01T03:45:00.000Z");
  });

  it("honours an explicit offset over the chosen zone", () => {
    expect(toUtcIso("2026-01-01T09:15:00+05:30", "UTC")).toBe("2026-01-01T03:45:00.000Z");
  });

  it("accepts the offset form without a colon", () => {
    expect(toUtcIso("2026-01-01T09:15:00+0530", "UTC")).toBe("2026-01-01T03:45:00.000Z");
  });

  it("handles a DST boundary in a zone that has one", () => {
    // 2026-03-08 is the US spring-forward date; 09:30 EDT == 13:30 UTC.
    expect(toUtcIso("2026-03-08 09:30:00", "America/New_York")).toBe("2026-03-08T13:30:00.000Z");
  });

  it("parses epoch seconds and milliseconds", () => {
    expect(toUtcIso("1767225600", "UTC")).toBe("2026-01-01T00:00:00.000Z");
    expect(toUtcIso("1767225600000", "UTC")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("parses day-first dates", () => {
    expect(toUtcIso("01-02-2026", "UTC")).toBe("2026-02-01T00:00:00.000Z");
  });

  it("returns null for junk", () => {
    expect(toUtcIso("not a date", "UTC")).toBeNull();
    expect(toUtcIso("", "UTC")).toBeNull();
  });
});

describe("validateRows", () => {
  const row = (over: Partial<Record<string, string>> = {}) => ({
    date: "2026-01-01", open: "100", high: "102", low: "98", close: "101", volume: "500", ...over,
  });

  it("accepts a well-formed row", () => {
    const r = validateRows([row()], COLS, "UTC");
    expect(r.problems).toEqual([]);
    expect(r.valid[0]).toEqual({
      ts: "2026-01-01T00:00:00.000Z", open: 100, high: 102, low: 98, close: 101, volume: 500,
    });
  });

  it("rejects a high below open/low/close", () => {
    const r = validateRows([row({ high: "99" })], COLS, "UTC");
    expect(r.valid).toHaveLength(0);
    expect(r.problems[0].reason).toMatch(/high .* below/);
  });

  it("rejects a low above open/high/close", () => {
    const r = validateRows([row({ low: "101.5" })], COLS, "UTC");
    expect(r.problems[0].reason).toMatch(/low .* above/);
  });

  it("rejects non-positive prices", () => {
    expect(validateRows([row({ low: "0", open: "0" })], COLS, "UTC").problems[0].reason)
      .toMatch(/must be positive/);
  });

  it("rejects negative volume", () => {
    expect(validateRows([row({ volume: "-1" })], COLS, "UTC").problems[0].reason)
      .toMatch(/volume/);
  });

  it("rejects an unparseable timestamp and reports its line number", () => {
    const r = validateRows([row(), row({ date: "junk" })], COLS, "UTC");
    expect(r.valid).toHaveLength(1);
    expect(r.problems[0].line).toBe(3); // header is line 1
  });

  it("collapses duplicate timestamps, keeping the last", () => {
    const r = validateRows([row({ close: "101" }), row({ close: "105", high: "106" })], COLS, "UTC");
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].close).toBe(105);
    expect(r.duplicatesInFile).toBe(1);
  });

  it("sorts out-of-order rows and flags that it did", () => {
    const r = validateRows([row({ date: "2026-01-03" }), row({ date: "2026-01-02" })], COLS, "UTC");
    expect(r.wasReordered).toBe(true);
    expect(r.valid.map((c) => c.ts)).toEqual([
      "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z",
    ]);
  });

  it("defaults volume to 0 when the column is not mapped", () => {
    const { volume, ...noVol } = COLS;
    void volume;
    expect(validateRows([row()], noVol as ColumnMap, "UTC").valid[0].volume).toBe(0);
  });
});
