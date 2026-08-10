import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loginChecksum, nextTokenExpiry } from "@/lib/market/kite-session";
import { isFresh, mergeCandles, splitKey, timeframeFor } from "@/lib/market/supabase-store";
import type { MarketCandle } from "@/lib/market/types";
import { toChartTime } from "@/lib/scalper/time";

describe("Kite Connect login", () => {
  it("signs the request token the way Kite Connect v3 specifies", () => {
    // sha256(api_key + request_token + api_secret) — anything else is rejected
    // at /session/token with no useful message, so this is worth pinning.
    const expected = createHash("sha256").update("abc123token456secret789").digest("hex");
    expect(loginChecksum("abc123", "token456", "secret789")).toBe(expected);
  });

  it("produces a stable 64-character hex digest", () => {
    const checksum = loginChecksum("k", "r", "s");
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(loginChecksum("k", "r", "s")).toBe(checksum);
  });

  it("changes when any component changes", () => {
    const base = loginChecksum("k", "r", "s");
    expect(loginChecksum("K", "r", "s")).not.toBe(base);
    expect(loginChecksum("k", "R", "s")).not.toBe(base);
    expect(loginChecksum("k", "r", "S")).not.toBe(base);
  });
});

describe("token expiry", () => {
  // Zerodha invalidates access tokens at the next pre-open, about 06:00 IST.
  const istNoon = new Date("2026-08-10T06:30:00Z"); // 12:00 IST
  const istEarly = new Date("2026-08-10T00:00:00Z"); // 05:30 IST

  it("expires at tomorrow's pre-open when issued during the session", () => {
    const expiry = nextTokenExpiry(istNoon);
    expect(expiry.toISOString()).toBe("2026-08-11T00:30:00.000Z"); // 06:00 IST next day
    expect(expiry.getTime()).toBeGreaterThan(istNoon.getTime());
  });

  it("expires this morning when issued before the pre-open", () => {
    const expiry = nextTokenExpiry(istEarly);
    expect(expiry.toISOString()).toBe("2026-08-10T00:30:00.000Z"); // 06:00 IST same day
  });

  it("is always in the future", () => {
    for (const hour of [0, 3, 6, 9, 15, 21]) {
      const now = new Date(Date.UTC(2026, 7, 10, hour, 0, 0));
      expect(nextTokenExpiry(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("instrument keys and timeframes", () => {
  it("splits an exchange-qualified key and defaults to NSE", () => {
    expect(splitKey("NSE:NIFTY 50")).toEqual({ exchange: "NSE", symbol: "NIFTY 50" });
    expect(splitKey("BSE:SENSEX")).toEqual({ exchange: "BSE", symbol: "SENSEX" });
    expect(splitKey("infy")).toEqual({ exchange: "NSE", symbol: "INFY" });
  });

  it("maps every interval to one timeframe spelling", () => {
    // Two spellings of the same timeframe would split one series into two in
    // the shared table, so the mapping has to be total and unambiguous.
    expect(timeframeFor("minute")).toBe("1m");
    expect(timeframeFor("60minute")).toBe("1h");
    expect(timeframeFor("day")).toBe("1d");
    expect(timeframeFor("week")).toBe("1w");
    expect(timeframeFor("month")).toBe("1M");
  });
});

describe("cache freshness", () => {
  const now = Date.parse("2026-08-10T10:00:00+05:30");
  const at = (iso: string): MarketCandle => ({
    time: toChartTime(Date.parse(iso)),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  });

  it("treats an empty series as stale", () => {
    expect(isFresh([], "day", now)).toBe(false);
  });

  it("accepts a daily series that is a long weekend old", () => {
    expect(isFresh([at("2026-08-07T09:15:00+05:30")], "day", now)).toBe(true);
  });

  it("rejects a daily series that is a week old", () => {
    expect(isFresh([at("2026-08-01T09:15:00+05:30")], "day", now)).toBe(false);
  });

  it("holds intraday to a much tighter window", () => {
    expect(isFresh([at("2026-08-10T09:50:00+05:30")], "5minute", now)).toBe(true);
    expect(isFresh([at("2026-08-10T08:00:00+05:30")], "5minute", now)).toBe(false);
  });
});

describe("merging cached and fresh bars", () => {
  const bar = (seconds: number, close: number): MarketCandle => ({
    time: seconds,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  });

  it("returns the other side when one is empty", () => {
    expect(mergeCandles([], [bar(1, 10)])).toEqual([bar(1, 10)]);
    expect(mergeCandles([bar(1, 10)], [])).toEqual([bar(1, 10)]);
  });

  it("keeps the fresh bar when both hold the same timestamp", () => {
    // The broker's copy of a forming bar is newer than whatever was stored.
    const merged = mergeCandles([bar(1, 10), bar(2, 20)], [bar(2, 25), bar(3, 30)]);
    expect(merged.map((candle) => candle.close)).toEqual([10, 25, 30]);
  });

  it("returns a chronologically ordered series with no duplicates", () => {
    const merged = mergeCandles([bar(5, 1), bar(1, 2)], [bar(3, 3), bar(5, 4)]);
    expect(merged.map((candle) => candle.time)).toEqual([1, 3, 5]);
  });
});
