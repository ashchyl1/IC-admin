import { describe, expect, it } from "vitest";
import {
  IST_OFFSET_MINUTES,
  fromChartTime,
  isMarketOpen,
  istSecondsOfDay,
  toChartTime,
  toEpochSeconds,
  toKiteDateTime,
} from "@/lib/wave-lab/time";

/**
 * §2.5 — the whole point of these helpers is that the opening bar reads 09:15
 * and not 03:45, so the fixtures are all real +0530 timestamps.
 */
describe("exchange time", () => {
  // 2026-08-03 09:15:00 +0530 — a Monday NSE open.
  const OPEN_IST = "2026-08-03T09:15:00+05:30";

  it("renders the NSE open as 09:15 when a chart formats it as UTC", () => {
    const chartTime = toChartTime(OPEN_IST);
    const asIfUtc = new Date(chartTime * 1000);
    expect(asIfUtc.getUTCHours()).toBe(9);
    expect(asIfUtc.getUTCMinutes()).toBe(15);
  });

  it("would render 03:45 without the shift — the bug being prevented", () => {
    const naive = new Date(Date.parse(OPEN_IST));
    expect(naive.getUTCHours()).toBe(3);
    expect(naive.getUTCMinutes()).toBe(45);
  });

  it("round-trips exactly", () => {
    const original = new Date(OPEN_IST);
    const back = fromChartTime(toChartTime(original));
    expect(back.getTime()).toBe(original.getTime());
  });

  it("shifts by exactly the IST offset", () => {
    const epoch = toEpochSeconds(OPEN_IST);
    expect(toChartTime(OPEN_IST) - epoch).toBe(IST_OFFSET_MINUTES * 60);
  });

  it("accepts Date, epoch seconds, epoch millis and ISO strings alike", () => {
    const d = new Date(OPEN_IST);
    const secs = d.getTime() / 1000;
    const expected = toChartTime(d);
    expect(toChartTime(secs)).toBe(expected);
    expect(toChartTime(d.getTime())).toBe(expected);
    expect(toChartTime(OPEN_IST)).toBe(expected);
  });

  it("rejects an unparseable timestamp rather than silently returning NaN", () => {
    expect(() => toEpochSeconds("not a date")).toThrow(/Unparseable/);
  });

  it("formats Kite's from/to in IST regardless of host timezone", () => {
    expect(toKiteDateTime(OPEN_IST)).toBe("2026-08-03 09:15:00");
    // Same instant expressed in UTC must format identically.
    expect(toKiteDateTime("2026-08-03T03:45:00Z")).toBe("2026-08-03 09:15:00");
  });

  it("computes IST seconds-of-day across the UTC midnight boundary", () => {
    // 00:30 IST is 19:00 UTC the previous day — the case naive maths breaks on.
    expect(istSecondsOfDay("2026-08-03T00:30:00+05:30")).toBe(30 * 60);
  });
});

describe("market hours", () => {
  it("is open during the Monday session", () => {
    expect(isMarketOpen("2026-08-03T10:00:00+05:30")).toBe(true);
  });

  it("is shut before the open and after the close", () => {
    expect(isMarketOpen("2026-08-03T09:14:59+05:30")).toBe(false);
    expect(isMarketOpen("2026-08-03T15:30:01+05:30")).toBe(false);
  });

  it("includes both boundary instants", () => {
    expect(isMarketOpen("2026-08-03T09:15:00+05:30")).toBe(true);
    expect(isMarketOpen("2026-08-03T15:30:00+05:30")).toBe(true);
  });

  it("is shut at the weekend", () => {
    expect(isMarketOpen("2026-08-01T10:00:00+05:30")).toBe(false); // Saturday
    expect(isMarketOpen("2026-08-02T10:00:00+05:30")).toBe(false); // Sunday
  });
});
