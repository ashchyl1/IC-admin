import { describe, expect, it, beforeEach } from "vitest";
import {
  aggregateDaily,
  freshnessWindowSeconds,
  isFresh,
  makeCandle,
  mergeCandles,
  sliceRange,
  toHeikinAshi,
} from "@/lib/wave-lab/candles";
import { CandleStore } from "@/lib/wave-lab/store";
import { SyntheticProvider } from "@/lib/wave-lab/providers/synthetic";
import { toEpochSeconds } from "@/lib/wave-lab/time";

const at = (iso: string, o = 100, h = 110, l = 90, c = 105, v = 1000) =>
  makeCandle(toEpochSeconds(iso), o, h, l, c, v);

describe("merging", () => {
  it("gives the incoming bar priority on a timestamp collision", () => {
    // The forming candle: cached copy is older than the broker's.
    const cached = [at("2026-08-03T09:15:00+05:30", 100, 101, 99, 100)];
    const incoming = [at("2026-08-03T09:15:00+05:30", 100, 108, 99, 107)];
    const merged = mergeCandles(cached, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].close).toBe(107);
    expect(merged[0].high).toBe(108);
  });

  it("unions disjoint ranges and keeps them ordered", () => {
    const a = [at("2026-08-03T09:15:00+05:30"), at("2026-08-03T09:16:00+05:30")];
    const b = [at("2026-08-03T09:14:00+05:30")];
    const merged = mergeCandles(a, b);
    expect(merged).toHaveLength(3);
    // The earlier bar from `b` must sort to the front, not append.
    expect(merged[0].epochSeconds).toBe(b[0].epochSeconds);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].epochSeconds).toBeGreaterThan(merged[i - 1].epochSeconds);
    }
  });

  it("handles either side being empty", () => {
    const one = [at("2026-08-03T09:15:00+05:30")];
    expect(mergeCandles([], one)).toHaveLength(1);
    expect(mergeCandles(one, [])).toHaveLength(1);
    expect(mergeCandles([], [])).toHaveLength(0);
  });
});

describe("freshness", () => {
  it("gives daily four days of slack for weekends and holidays", () => {
    expect(freshnessWindowSeconds("1D")).toBe(4 * 86400);
  });

  it("gives intraday two intervals or 15 minutes, whichever is longer", () => {
    expect(freshnessWindowSeconds("1m")).toBe(15 * 60); // 2 min < 15 min
    expect(freshnessWindowSeconds("1h")).toBe(2 * 3600); // 2h > 15 min
  });

  it("is inclusive exactly at the boundary and stale one second later", () => {
    const now = 1_800_000_000;
    const window = freshnessWindowSeconds("1h");
    expect(isFresh(now - window, "1h", now)).toBe(true);
    expect(isFresh(now - window - 1, "1h", now)).toBe(false);
  });
});

describe("range slicing", () => {
  it("includes both endpoints", () => {
    const bars = [
      at("2026-08-03T09:15:00+05:30"),
      at("2026-08-03T09:16:00+05:30"),
      at("2026-08-03T09:17:00+05:30"),
    ];
    const from = bars[0].epochSeconds;
    const to = bars[2].epochSeconds;
    expect(sliceRange(bars, from, to)).toHaveLength(3);
    expect(sliceRange(bars, from + 1, to - 1)).toHaveLength(1);
  });
});

describe("aggregation to weekly", () => {
  // Mon 3 Aug 2026 .. Fri 7 Aug, then Mon 10 Aug.
  const week1 = [
    at("2026-08-03T00:00:00+05:30", 100, 105, 98, 102, 10),
    at("2026-08-04T00:00:00+05:30", 102, 112, 101, 110, 20),
    at("2026-08-07T00:00:00+05:30", 110, 111, 95, 97, 30),
  ];
  const week2 = [at("2026-08-10T00:00:00+05:30", 97, 99, 90, 92, 40)];

  it("folds a trading week into one bar", () => {
    const weekly = aggregateDaily([...week1, ...week2], "1W");
    expect(weekly).toHaveLength(2);
  });

  it("takes first open, last close, max high, min low and summed volume", () => {
    const [bar] = aggregateDaily(week1, "1W");
    expect(bar.open).toBe(100);
    expect(bar.close).toBe(97);
    expect(bar.high).toBe(112);
    expect(bar.low).toBe(95);
    expect(bar.volume).toBe(60);
  });

  it("dates the bar by the week's first trading day, not its last", () => {
    const [bar] = aggregateDaily(week1, "1W");
    expect(bar.epochSeconds).toBe(week1[0].epochSeconds);
  });

  it("splits across a month boundary when aggregating monthly", () => {
    const bars = [
      at("2026-08-28T00:00:00+05:30", 100, 100, 100, 100, 1),
      at("2026-09-01T00:00:00+05:30", 200, 200, 200, 200, 2),
    ];
    expect(aggregateDaily(bars, "1M")).toHaveLength(2);
  });

  it("returns nothing for no input", () => {
    expect(aggregateDaily([], "1W")).toEqual([]);
  });
});

describe("heikin-ashi", () => {
  const bars = [
    at("2026-08-03T00:00:00+05:30", 100, 110, 95, 105),
    at("2026-08-04T00:00:00+05:30", 105, 118, 103, 115),
    at("2026-08-05T00:00:00+05:30", 115, 116, 100, 102),
  ];

  it("closes at the average of OHLC", () => {
    const ha = toHeikinAshi(bars);
    expect(ha[0].close).toBeCloseTo((100 + 110 + 95 + 105) / 4, 6);
  });

  it("seeds the first bar's open from its own open and close", () => {
    expect(toHeikinAshi(bars)[0].open).toBeCloseTo((100 + 105) / 2, 6);
  });

  it("opens each later bar at the midpoint of the previous HA bar", () => {
    const ha = toHeikinAshi(bars);
    expect(ha[1].open).toBeCloseTo((ha[0].open + ha[0].close) / 2, 6);
  });

  it("keeps high above and low below its own open and close", () => {
    for (const b of toHeikinAshi(bars)) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
  });

  it("preserves bar count, timestamps and volume", () => {
    const ha = toHeikinAshi(bars);
    expect(ha).toHaveLength(bars.length);
    expect(ha.map((b) => b.epochSeconds)).toEqual(bars.map((b) => b.epochSeconds));
    expect(ha.map((b) => b.volume)).toEqual(bars.map((b) => b.volume));
  });

  it("returns nothing for no input", () => {
    expect(toHeikinAshi([])).toEqual([]);
  });
});

describe("cache store", () => {
  beforeEach(() => CandleStore.clear());

  it("round-trips and reports freshness", () => {
    const bars = [at("2026-08-03T00:00:00+05:30")];
    CandleStore.put("NSE:INFY", "1D", bars, "kite-mcp", 1000);
    const read = CandleStore.read("NSE:INFY", "1D", 1000);
    expect(read?.candles).toHaveLength(1);
    expect(read?.fresh).toBe(true);
  });

  it("reports stale once past the window", () => {
    CandleStore.put("NSE:INFY", "1D", [at("2026-08-03T00:00:00+05:30")], "kite-mcp", 1000);
    const read = CandleStore.read("NSE:INFY", "1D", 1000 + 5 * 86400);
    expect(read?.fresh).toBe(false);
    expect(read?.candles).toHaveLength(1); // still served, just flagged
  });

  it("is keyed per interval, so 1D and 1h never collide", () => {
    CandleStore.put("NSE:INFY", "1D", [at("2026-08-03T00:00:00+05:30")], "kite-mcp");
    expect(CandleStore.read("NSE:INFY", "1h")).toBeNull();
  });

  it("is case-insensitive on the symbol", () => {
    CandleStore.put("nse:infy", "1D", [at("2026-08-03T00:00:00+05:30")], "kite-mcp");
    expect(CandleStore.read("NSE:INFY", "1D")).not.toBeNull();
  });

  it("REFUSES synthetic data — it must never enter a shared store", () => {
    expect(() =>
      CandleStore.put("NSE:INFY", "1D", [at("2026-08-03T00:00:00+05:30")], "synthetic")
    ).toThrow(/synthetic/i);
    expect(CandleStore.read("NSE:INFY", "1D")).toBeNull();
  });

  it("returns null for an unknown series rather than an empty array", () => {
    expect(CandleStore.read("NSE:NOTHING", "1D")).toBeNull();
  });
});

describe("synthetic provider", () => {
  const provider = new SyntheticProvider();

  it("is labelled as not live so every surface can warn", () => {
    expect(provider.info.live).toBe(false);
    expect(provider.info.id).toBe("synthetic");
  });

  it("is deterministic for a symbol, so a drawn count survives a reload", async () => {
    const req = {
      symbol: "NSE:INFY",
      interval: "1D" as const,
      from: new Date("2026-01-01T00:00:00+05:30"),
      to: new Date("2026-03-01T00:00:00+05:30"),
    };
    const a = await provider.candles(req);
    const b = await provider.candles(req);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it("produces coherent OHLC on every bar", async () => {
    const bars = await provider.candles({
      symbol: "NSE:NIFTY 50",
      interval: "1D",
      from: new Date("2026-01-01T00:00:00+05:30"),
      to: new Date("2026-04-01T00:00:00+05:30"),
    });
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
      expect(b.low).toBeGreaterThan(0);
      expect(b.volume).toBeGreaterThanOrEqual(0);
    }
  });

  it("emits no weekend bars", async () => {
    const bars = await provider.candles({
      symbol: "NSE:INFY",
      interval: "1D",
      from: new Date("2026-08-01T00:00:00+05:30"),
      to: new Date("2026-08-31T00:00:00+05:30"),
    });
    for (const b of bars) {
      const istDay = new Date(b.time * 1000).getUTCDay();
      expect(istDay).not.toBe(0);
      expect(istDay).not.toBe(6);
    }
  });

  it("dates daily bars at IST midnight, not UTC midnight", async () => {
    // Regression: stepping raw epoch seconds aligns to UTC midnight, which
    // renders a "daily" candle at 05:30 IST.
    const bars = await provider.candles({
      symbol: "NSE:NIFTY 50",
      interval: "1D",
      from: new Date("2026-08-01T00:00:00+05:30"),
      to: new Date("2026-08-31T00:00:00+05:30"),
    });
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      const d = new Date(b.time * 1000);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
    }
  });

  it("starts the intraday grid at the 09:15 session open", async () => {
    const bars = await provider.candles({
      symbol: "NSE:INFY",
      interval: "1h",
      from: new Date("2026-08-03T00:00:00+05:30"),
      to: new Date("2026-08-04T00:00:00+05:30"),
    });
    const first = new Date(bars[0].time * 1000);
    expect(first.getUTCHours()).toBe(9);
    expect(first.getUTCMinutes()).toBe(15);
  });

  it("keeps intraday bars inside 09:15–15:30 IST", async () => {
    const bars = await provider.candles({
      symbol: "NSE:INFY",
      interval: "15m",
      from: new Date("2026-08-03T00:00:00+05:30"),
      to: new Date("2026-08-04T00:00:00+05:30"),
    });
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      const d = new Date(b.time * 1000);
      const secs = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60;
      expect(secs).toBeGreaterThanOrEqual(9 * 3600 + 15 * 60);
      expect(secs).toBeLessThanOrEqual(15 * 3600 + 30 * 60);
    }
  });

  it("folds 1W into weekly bars rather than emitting one per weekday", async () => {
    // Regression: 14 months of "weekly" once returned 302 bars — the daily grid
    // relabelled. A year should be ~52.
    const range = {
      symbol: "NSE:NIFTY 50",
      from: new Date("2025-01-01T00:00:00+05:30"),
      to: new Date("2026-01-01T00:00:00+05:30"),
    };
    const weekly = await provider.candles({ ...range, interval: "1W" });
    const daily = await provider.candles({ ...range, interval: "1D" });
    expect(weekly.length).toBeGreaterThan(45);
    expect(weekly.length).toBeLessThan(56);
    expect(daily.length).toBeGreaterThan(240);
    // A weekly bar must span its days, so its range contains the dailies'.
    expect(Math.max(...weekly.map((b) => b.high))).toBeCloseTo(
      Math.max(...daily.map((b) => b.high)),
      6
    );
  });

  it("finds instruments by symbol and by name", async () => {
    expect((await provider.search("INFY")).length).toBeGreaterThan(0);
    expect((await provider.search("reliance"))[0].key).toBe("NSE:RELIANCE");
    expect(await provider.search("")).toEqual([]);
  });
});
