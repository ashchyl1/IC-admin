import { afterEach, describe, expect, it, vi } from "vitest";

import { MockAdapter } from "@/lib/scalper/adapters/mock";
import { CHAIN_DEPTH, UNDERLYINGS } from "@/lib/scalper/config";
import { seedPortfolio } from "@/lib/scalper/mock/seedTrades";
import { DEFAULT_COST_MODEL } from "@/lib/scalper/config";
import { fromChartTime, marketPhase } from "@/lib/scalper/time";
import type { AdapterSnapshot } from "@/lib/scalper/adapters/types";

const adapters: MockAdapter[] = [];

function makeAdapter() {
  const adapter = new MockAdapter({ tickIntervalMs: 10_000 });
  adapters.push(adapter);
  return adapter;
}

afterEach(() => {
  while (adapters.length) adapters.pop()?.disconnect();
  vi.useRealTimers();
});

describe("MockAdapter", () => {
  it("publishes a usable snapshot on connect", async () => {
    const adapter = makeAdapter();
    const seen: AdapterSnapshot[] = [];
    adapter.onSnapshot((s) => seen.push(s));

    await adapter.connect();

    expect(seen.length).toBeGreaterThan(0);
    const snapshot = adapter.snapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.chain).toHaveLength(CHAIN_DEPTH * 2 + 1);
    expect(snapshot!.expiries.length).toBeGreaterThan(0);
    expect(snapshot!.spot.ltp).toBeGreaterThan(0);
    expect(snapshot!.indices).toHaveLength(4);
    expect(snapshot!.simulated).toBe(true);
  });

  it("centres the chain on ATM and marks exactly one row", () => {
    const adapter = makeAdapter();
    adapter.connect();
    const snapshot = adapter.snapshot()!;

    expect(snapshot.chain.filter((r) => r.isAtm)).toHaveLength(1);
    expect(snapshot.chain.find((r) => r.isAtm)!.strike).toBe(snapshot.atmStrike);

    const step = UNDERLYINGS.NIFTY.strikeStep;
    for (let i = 1; i < snapshot.chain.length; i += 1) {
      expect(snapshot.chain[i].strike - snapshot.chain[i - 1].strike).toBe(step);
    }
  });

  it("quotes a bid below the ask on every leg", () => {
    const adapter = makeAdapter();
    adapter.connect();
    for (const row of adapter.snapshot()!.chain) {
      for (const leg of [row.call, row.put]) {
        expect(leg.bid).toBeGreaterThan(0);
        expect(leg.ask).toBeGreaterThan(leg.bid);
        expect(leg.ltp).toBeGreaterThan(0);
      }
    }
  });

  it("builds intraday candles for the current session and aggregates them", () => {
    const adapter = makeAdapter();
    adapter.connect();

    const oneMinute = adapter.spotCandles("NIFTY", "1m");
    const threeMinute = adapter.spotCandles("NIFTY", "3m");
    const daily = adapter.spotCandles("NIFTY", "1d");

    expect(oneMinute.length).toBeGreaterThan(100);
    expect(threeMinute.length).toBeLessThan(oneMinute.length);
    expect(daily.length).toBeGreaterThan(20); // enough for a 20 EMA on the 1D cell

    // Candles must be ordered and internally valid.
    for (let i = 1; i < oneMinute.length; i += 1) {
      expect(oneMinute[i].time).toBeGreaterThan(oneMinute[i - 1].time);
    }
    for (const c of oneMinute) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });

  it("derives option candles that move with spot and invert for puts", () => {
    const adapter = makeAdapter();
    adapter.connect();
    const snapshot = adapter.snapshot()!;
    const expiry = snapshot.expiries[0];

    const call = adapter.contractFor("NIFTY", snapshot.atmStrike, "CE", expiry);
    const put = adapter.contractFor("NIFTY", snapshot.atmStrike, "PE", expiry);

    const callCandles = adapter.optionCandles(call, "1m");
    const putCandles = adapter.optionCandles(put, "1m");
    const spot = adapter.spotCandles("NIFTY", "1m");

    expect(callCandles.length).toBeGreaterThan(50);
    expect(callCandles).toHaveLength(putCandles.length);

    for (const c of callCandles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.low).toBeGreaterThan(0);
    }

    // Over the same window, a rise in spot should lift the call and press the put.
    const window = spot.slice(-40);
    const spotMove = window[window.length - 1].close - window[0].close;
    const callMove = callCandles[callCandles.length - 1].close - callCandles[callCandles.length - 40].close;
    const putMove = putCandles[putCandles.length - 1].close - putCandles[putCandles.length - 40].close;
    if (Math.abs(spotMove) > 5) {
      expect(Math.sign(callMove)).toBe(Math.sign(spotMove));
      expect(Math.sign(putMove)).toBe(-Math.sign(spotMove));
    }
  });

  it("keeps ticking without throwing and advances the forming bar", () => {
    const adapter = makeAdapter();
    adapter.connect();

    const before = adapter.spotCandles("NIFTY", "1m");
    const beforeLast = { ...before[before.length - 1] };

    // Drive the generator directly rather than waiting on the timer.
    for (let i = 0; i < 30; i += 1) {
      expect(() => adapter.select({ underlying: "NIFTY", expiry: adapter.snapshot()!.expiries[0], centreStrike: null })).not.toThrow();
    }

    const after = adapter.spotCandles("NIFTY", "1m");
    const afterLast = after[after.length - 1];
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(afterLast.close).not.toBe(Number.NaN);
    expect(beforeLast.time).toBeLessThanOrEqual(afterLast.time);
  });

  it("switches underlying and republishes a matching chain", () => {
    const adapter = makeAdapter();
    adapter.connect();

    adapter.select({ underlying: "BANKNIFTY", expiry: "", centreStrike: null });
    const snapshot = adapter.snapshot()!;

    expect(snapshot.expiries.length).toBeGreaterThan(0);
    expect(snapshot.chain).toHaveLength(CHAIN_DEPTH * 2 + 1);
    const step = UNDERLYINGS.BANKNIFTY.strikeStep;
    expect(snapshot.atmStrike % step).toBe(0);
    expect(snapshot.chain[0].call.contract.underlying).toBe("BANKNIFTY");
    expect(snapshot.chain[0].call.contract.lotSize).toBe(UNDERLYINGS.BANKNIFTY.lotSize);
  });

  it("reports the real session phase, not the replay clock's", () => {
    const adapter = makeAdapter();
    adapter.connect();
    expect(adapter.snapshot()!.phase).toBe(marketPhase(Date.now()));
  });

  it("exposes a session open that precedes the snapshot clock", () => {
    const adapter = makeAdapter();
    adapter.connect();
    const openMs = fromChartTime(adapter.sessionOpenSeconds("NIFTY"));
    expect(openMs).toBeLessThanOrEqual(adapter.snapshot()!.ts);
  });
});

describe("seedPortfolio", () => {
  it("never timestamps a trade before the opening bell", () => {
    const adapter = makeAdapter();
    adapter.connect();
    const snapshot = adapter.snapshot()!;
    const sessionOpenMs = fromChartTime(adapter.sessionOpenSeconds("NIFTY"));

    const portfolio = seedPortfolio({
      underlying: "NIFTY",
      expiry: snapshot.expiries[0],
      atmStrike: snapshot.atmStrike,
      strikeStep: UNDERLYINGS.NIFTY.strikeStep,
      lotSize: UNDERLYINGS.NIFTY.lotSize,
      now: snapshot.ts,
      sessionOpenMs,
      costs: DEFAULT_COST_MODEL,
      contractFor: (strike, optionType) =>
        adapter.contractFor("NIFTY", strike, optionType, snapshot.expiries[0]),
    });

    expect(portfolio.journal).toHaveLength(6);
    for (const trade of portfolio.journal) {
      expect(trade.entryTs).toBeGreaterThanOrEqual(sessionOpenMs);
      expect(trade.exitTs).toBeGreaterThan(trade.entryTs);
      expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.charges, 2);
    }

    const net = portfolio.journal.reduce((a, t) => a + t.netPnl, 0);
    expect(portfolio.realizedPnl).toBeCloseTo(net, 1);
  });
});
