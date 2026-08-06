import { describe, expect, it } from "vitest";
import {
  COVERAGE_START,
  RECOMMENDATIONS,
  daysSince,
  recommendationForDate,
} from "@/lib/nifty-timeline/recommendations";
import {
  BARS,
  DAY_POINTS,
  REGIMES,
  parseLevels,
} from "@/lib/nifty-timeline/series";

describe("recommendations transcribed from the casebook", () => {
  it("holds all fifteen entries in ascending date order", () => {
    expect(RECOMMENDATIONS).toHaveLength(15);
    const dates = RECOMMENDATIONS.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("carries the published view, reason and risk for every entry", () => {
    for (const rec of RECOMMENDATIONS) {
      expect(rec.publishedView, rec.date).not.toBe("");
      expect(rec.reason, rec.date).not.toBe("");
      expect(rec.confirmation, rec.date).not.toBe("");
    }
  });

  it("marks 12 May as the only mid-week note", () => {
    expect(RECOMMENDATIONS.filter((r) => r.midWeek).map((r) => r.date)).toEqual(["2026-05-12"]);
  });
});

describe("recommendationForDate", () => {
  it("returns nothing before the timeline opens", () => {
    expect(recommendationForDate("2026-04-30")).toBeNull();
    expect(recommendationForDate(COVERAGE_START)).not.toBeNull();
  });

  it("keeps a call in force until the next one is published", () => {
    // 3 May governs the week that follows it, right up to the 12 May note.
    expect(recommendationForDate("2026-05-04")?.date).toBe("2026-05-03");
    expect(recommendationForDate("2026-05-11")?.date).toBe("2026-05-10");
    expect(recommendationForDate("2026-05-12")?.date).toBe("2026-05-12");
    expect(recommendationForDate("2026-05-15")?.date).toBe("2026-05-12");
    expect(recommendationForDate("2026-05-18")?.date).toBe("2026-05-17");
  });

  it("holds the last call open past the end of the document", () => {
    expect(recommendationForDate("2026-08-05")?.date).toBe("2026-08-02");
  });

  it("counts calendar days from publication", () => {
    expect(daysSince("2026-05-03", "2026-05-04")).toBe(1);
    expect(daysSince("2026-07-26", "2026-08-02")).toBe(7);
  });
});

describe("daily series", () => {
  it("is chronological, and every bar is a valid OHLC", () => {
    const dates = BARS.map((b) => b.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);

    for (const bar of BARS) {
      expect(bar.low, bar.date).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high, bar.date).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
    }
  });

  it("numbers the sessions under each call, restarting on publication", () => {
    const firstOfCall = DAY_POINTS.filter((p) => p.isFirstSession);
    expect(firstOfCall.length).toBe(REGIMES.length);
    for (const point of firstOfCall) expect(point.sessionOfCall).toBe(1);

    for (const point of DAY_POINTS) {
      if (!point.rec) expect(point.sessionOfCall).toBe(0);
      // A call can never govern a session that printed before it was published.
      else expect(point.rec.date <= point.date, point.date).toBe(true);
    }
  });

  it("covers every bar from 3 May onward and none before it", () => {
    for (const point of DAY_POINTS) {
      expect(Boolean(point.rec), point.date).toBe(point.date >= COVERAGE_START);
    }
  });

  it("splits regimes into contiguous, non-overlapping runs", () => {
    for (let i = 1; i < REGIMES.length; i++) {
      expect(REGIMES[i].fromIndex).toBe(REGIMES[i - 1].toIndex + 1);
      expect(REGIMES[i].rec.date).not.toBe(REGIMES[i - 1].rec.date);
    }
  });
});

describe("parseLevels", () => {
  it("reads single levels, ranges and trailing words", () => {
    expect(parseLevels("24,854")).toEqual([24854]);
    expect(parseLevels("23,392-23,100")).toEqual([23392, 23100]);
    expect(parseLevels("23,100 trigger")).toEqual([23100]);
  });

  it("returns nothing when the document quotes no level", () => {
    expect(parseLevels("No new weekly target")).toEqual([]);
    expect(parseLevels("")).toEqual([]);
  });

  it("ignores wave numbers and percentages", () => {
    expect(parseLevels("Wave 2 of 3, a 61.8% retracement")).toEqual([]);
  });
});
