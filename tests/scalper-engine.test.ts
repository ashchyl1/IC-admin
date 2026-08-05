import { describe, expect, it } from "vitest";

import { DEFAULT_COST_MODEL, DEFAULT_EXECUTION, DEFAULT_RISK } from "@/lib/scalper/config";
import { computeCharges, estimateRoundTrip } from "@/lib/scalper/engine/charges";
import { markPrice, simulateFill } from "@/lib/scalper/engine/execution";
import {
  applyFill,
  emptyPortfolio,
  openLots,
  totalUnrealized,
  triggeredExits,
  unrealizedPnl,
} from "@/lib/scalper/engine/portfolio";
import {
  defaultLevels,
  emptyGuard,
  evaluateOrder,
  registerAccepted,
  registerAttempt,
  riskAtStop,
} from "@/lib/scalper/engine/risk";
import { aggregate, biasFor, ema, openingRange, previousDayRange, vwap } from "@/lib/scalper/indicators";
import type { Candle, ChargeBreakdown, OptionContract, Quote } from "@/lib/scalper/types";

const CONTRACT: OptionContract = {
  symbol: "NIFTY30JUL24000CE",
  underlying: "NIFTY",
  expiry: "2026-07-30",
  strike: 24_000,
  optionType: "CE",
  lotSize: 75,
};

const PUT: OptionContract = { ...CONTRACT, symbol: "NIFTY30JUL24000PE", optionType: "PE" };

function quote(bid: number, ask: number, ts = 0): Quote {
  return {
    ltp: (bid + ask) / 2,
    bid,
    ask,
    change: 0,
    changePct: 0,
    volume: 0,
    openInterest: 0,
    prevClose: (bid + ask) / 2,
    ts,
  };
}

const noCharges: ChargeBreakdown = {
  brokerage: 0,
  stt: 0,
  exchangeTxn: 0,
  sebi: 0,
  stampDuty: 0,
  ipft: 0,
  gst: 0,
  total: 0,
};

// ------------------------------------------------------------------ fills ---

describe("simulateFill", () => {
  it("prices from the mid and always charges the edge against the order", () => {
    const q = quote(100, 102);
    const buy = simulateFill("BUY", q, DEFAULT_EXECUTION);
    const sell = simulateFill("SELL", q, DEFAULT_EXECUTION);

    expect(buy.referencePrice).toBe(101);
    expect(sell.referencePrice).toBe(101);
    // half-spread 1 × (1 + 0.5) + 0.05 fixed = 1.55
    expect(buy.fillPrice).toBeCloseTo(102.55, 2);
    expect(sell.fillPrice).toBeCloseTo(99.45, 2);
    expect(buy.slippage).toBeCloseTo(1.55, 2);
    expect(sell.slippage).toBeCloseTo(1.55, 2);
  });

  it("never fills below one tick, however thin the premium", () => {
    const fill = simulateFill("SELL", quote(0.05, 0.1), DEFAULT_EXECUTION);
    expect(fill.fillPrice).toBeGreaterThanOrEqual(DEFAULT_EXECUTION.tickSize);
  });

  it("reports the spread as a percentage of mid", () => {
    expect(simulateFill("BUY", quote(99, 101), DEFAULT_EXECUTION).spreadPct).toBeCloseTo(2, 5);
  });

  it("marks a long at the bid and a short at the ask", () => {
    expect(markPrice(quote(100, 102), 75)).toBe(100);
    expect(markPrice(quote(100, 102), -75)).toBe(102);
    expect(markPrice(quote(100, 102), 0)).toBe(101);
  });
});

// ---------------------------------------------------------------- charges ---

describe("computeCharges", () => {
  it("charges STT on the sell side only and stamp duty on the buy side only", () => {
    const buy = computeCharges("BUY", 100, 75, DEFAULT_COST_MODEL);
    const sell = computeCharges("SELL", 100, 75, DEFAULT_COST_MODEL);

    expect(buy.stt).toBe(0);
    expect(sell.stt).toBeCloseTo(7.5, 2); // 0.1% of 7,500 turnover
    expect(sell.stampDuty).toBe(0);
    expect(buy.stampDuty).toBeCloseTo(0.23, 2);
  });

  it("applies GST to the service components but never to STT or stamp duty", () => {
    const c = computeCharges("SELL", 100, 75, DEFAULT_COST_MODEL);
    const services = c.brokerage + c.exchangeTxn + c.sebi + c.ipft;
    expect(c.gst).toBeCloseTo(services * DEFAULT_COST_MODEL.gstRate, 2);
  });

  it("sums to the reported total", () => {
    const c = computeCharges("SELL", 137.45, 150, DEFAULT_COST_MODEL);
    const parts = c.brokerage + c.stt + c.exchangeTxn + c.sebi + c.stampDuty + c.ipft + c.gst;
    expect(c.total).toBeCloseTo(parts, 2);
  });

  it("estimates a round trip as both legs together", () => {
    const round = estimateRoundTrip(100, 75, DEFAULT_COST_MODEL);
    const manual =
      computeCharges("BUY", 100, 75, DEFAULT_COST_MODEL).total +
      computeCharges("SELL", 100, 75, DEFAULT_COST_MODEL).total;
    expect(round).toBeCloseTo(manual, 2);
  });
});

// -------------------------------------------------------------- portfolio ---

describe("applyFill", () => {
  it("opens, marks and closes a long round trip", () => {
    let state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 75,
      fillPrice: 100,
      charges: noCharges,
      ts: 1_000,
    });

    expect(state.positions[CONTRACT.symbol].quantity).toBe(75);
    expect(state.positions[CONTRACT.symbol].averagePrice).toBe(100);
    expect(openLots(state)).toBe(1);

    state.positions[CONTRACT.symbol].lastPrice = 120;
    expect(unrealizedPnl(state.positions[CONTRACT.symbol], 120)).toBe(1500);
    expect(totalUnrealized(state)).toBe(1500);

    state = applyFill({
      state,
      contract: CONTRACT,
      side: "SELL",
      quantity: 75,
      fillPrice: 120,
      charges: noCharges,
      ts: 5_000,
    });

    expect(state.positions[CONTRACT.symbol]).toBeUndefined();
    expect(state.realizedPnl).toBe(1500);
    expect(state.journal).toHaveLength(1);
    expect(state.journal[0].direction).toBe("LONG");
    expect(state.journal[0].durationMs).toBe(4_000);
  });

  it("realises a short round trip in the right direction", () => {
    let state = applyFill({
      state: emptyPortfolio(),
      contract: PUT,
      side: "SELL",
      quantity: 75,
      fillPrice: 120,
      charges: noCharges,
      ts: 0,
    });
    expect(state.positions[PUT.symbol].quantity).toBe(-75);

    state = applyFill({
      state,
      contract: PUT,
      side: "BUY",
      quantity: 75,
      fillPrice: 100,
      charges: noCharges,
      ts: 1_000,
    });

    expect(state.realizedPnl).toBe(1500);
    expect(state.journal[0].direction).toBe("SHORT");
  });

  it("weights the average price across multiple entries", () => {
    let state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 75,
      fillPrice: 100,
      charges: noCharges,
      ts: 0,
    });
    state = applyFill({
      state,
      contract: CONTRACT,
      side: "BUY",
      quantity: 150,
      fillPrice: 130,
      charges: noCharges,
      ts: 1,
    });

    expect(state.positions[CONTRACT.symbol].quantity).toBe(225);
    expect(state.positions[CONTRACT.symbol].averagePrice).toBe(120);
  });

  it("supports a partial exit and leaves the remainder open", () => {
    let state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 150,
      fillPrice: 100,
      charges: noCharges,
      ts: 0,
    });
    state = applyFill({
      state,
      contract: CONTRACT,
      side: "SELL",
      quantity: 75,
      fillPrice: 110,
      charges: noCharges,
      ts: 1_000,
    });

    expect(state.positions[CONTRACT.symbol].quantity).toBe(75);
    expect(state.positions[CONTRACT.symbol].averagePrice).toBe(100);
    expect(state.realizedPnl).toBe(750);
    expect(state.journal[0].quantity).toBe(75);
  });

  it("closes the old position and opens the remainder when an order crosses zero", () => {
    let state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 75,
      fillPrice: 100,
      charges: noCharges,
      ts: 0,
    });
    state = applyFill({
      state,
      contract: CONTRACT,
      side: "SELL",
      quantity: 150,
      fillPrice: 110,
      charges: noCharges,
      ts: 1_000,
    });

    expect(state.realizedPnl).toBe(750);
    expect(state.positions[CONTRACT.symbol].quantity).toBe(-75);
    expect(state.positions[CONTRACT.symbol].averagePrice).toBe(110);
  });

  it("allocates entry charges pro-rata to the slice being closed", () => {
    const entryCharges: ChargeBreakdown = { ...noCharges, brokerage: 40, total: 40 };
    const exitCharges: ChargeBreakdown = { ...noCharges, brokerage: 20, total: 20 };

    let state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 150,
      fillPrice: 100,
      charges: entryCharges,
      ts: 0,
    });
    state = applyFill({
      state,
      contract: CONTRACT,
      side: "SELL",
      quantity: 75,
      fillPrice: 110,
      charges: exitCharges,
      ts: 1,
    });

    // Half the position closed: half of the ₹40 entry cost plus the ₹20 exit.
    expect(state.journal[0].charges).toBe(40);
    expect(state.journal[0].grossPnl).toBe(750);
    expect(state.journal[0].netPnl).toBe(710);
    expect(state.positions[CONTRACT.symbol].chargesPaid).toBe(20);
  });

  it("keeps gross, charges and net consistent on every journal row", () => {
    const charges: ChargeBreakdown = { ...noCharges, brokerage: 20, total: 20 };
    let state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 75,
      fillPrice: 100,
      charges,
      ts: 0,
    });
    state = applyFill({
      state,
      contract: CONTRACT,
      side: "SELL",
      quantity: 75,
      fillPrice: 90,
      charges,
      ts: 1,
    });

    const trade = state.journal[0];
    expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.charges, 2);
    expect(state.realizedPnl).toBeCloseTo(trade.netPnl, 2);
  });
});

describe("triggeredExits", () => {
  const base = () =>
    applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "BUY",
      quantity: 75,
      fillPrice: 100,
      charges: noCharges,
      ts: 0,
      stopLoss: 80,
      target: 130,
    });

  it("fires a long stop when the mark falls to it", () => {
    const state = base();
    state.positions[CONTRACT.symbol].lastPrice = 79;
    expect(triggeredExits(state).map((h) => h.reason)).toEqual(["STOP_LOSS"]);
  });

  it("fires a long target when the mark reaches it", () => {
    const state = base();
    state.positions[CONTRACT.symbol].lastPrice = 131;
    expect(triggeredExits(state).map((h) => h.reason)).toEqual(["TARGET"]);
  });

  it("inverts both levels for a short", () => {
    const state = applyFill({
      state: emptyPortfolio(),
      contract: CONTRACT,
      side: "SELL",
      quantity: 75,
      fillPrice: 100,
      charges: noCharges,
      ts: 0,
      stopLoss: 130,
      target: 70,
    });
    state.positions[CONTRACT.symbol].lastPrice = 135;
    expect(triggeredExits(state).map((h) => h.reason)).toEqual(["STOP_LOSS"]);

    state.positions[CONTRACT.symbol].lastPrice = 65;
    expect(triggeredExits(state).map((h) => h.reason)).toEqual(["TARGET"]);
  });

  it("stays quiet between the levels", () => {
    const state = base();
    state.positions[CONTRACT.symbol].lastPrice = 105;
    expect(triggeredExits(state)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------- risk ---

describe("evaluateOrder", () => {
  const context = (overrides: Partial<Parameters<typeof evaluateOrder>[1]> = {}) => ({
    now: 10_000,
    settings: DEFAULT_RISK,
    killSwitch: false,
    marketOpen: true,
    quoteAgeMs: 0,
    spreadPct: 0.2,
    dayPnl: 0,
    openLots: 0,
    guard: emptyGuard(),
    position: null,
    ...overrides,
  });

  const intent = (overrides = {}) => ({
    contract: CONTRACT,
    side: "BUY" as const,
    lots: 1,
    entryPrice: 100,
    stopLoss: 75,
    isExit: false,
    ...overrides,
  });

  it("passes a normal order", () => {
    expect(evaluateOrder(intent(), context())).toHaveLength(0);
  });

  it("blocks when the kill switch is engaged, but still lets exits through", () => {
    const ctx = context({ killSwitch: true });
    expect(evaluateOrder(intent(), ctx).some((v) => v.code === "KILL_SWITCH")).toBe(true);
    expect(
      evaluateOrder(intent({ isExit: true }), { ...ctx, position: null }).some(
        (v) => v.code === "KILL_SWITCH"
      )
    ).toBe(false);
  });

  it("blocks an order whose risk to stop exceeds the per-trade cap", () => {
    // 75 units × ₹75 of risk = ₹5,625, past the ₹5,000 default.
    const v = evaluateOrder(intent({ stopLoss: 25 }), context());
    expect(v.some((x) => x.code === "MAX_LOSS_PER_TRADE" && x.severity === "block")).toBe(true);
  });

  it("blocks oversized orders and oversized books separately", () => {
    expect(evaluateOrder(intent({ lots: 50 }), context()).some((v) => v.code === "MAX_LOTS")).toBe(true);
    expect(
      evaluateOrder(intent({ lots: 2 }), context({ openLots: 19 })).some((v) => v.code === "MAX_LOTS")
    ).toBe(true);
  });

  it("blocks a duplicate of the same contract and side inside the window", () => {
    const guard = registerAccepted(emptyGuard(), CONTRACT.symbol, "BUY", 9_500);
    const v = evaluateOrder(intent(), context({ guard }));
    expect(v.some((x) => x.code === "DUPLICATE_ORDER")).toBe(true);

    // The opposite side is not a duplicate.
    expect(
      evaluateOrder(intent({ side: "SELL" as const }), context({ guard })).some(
        (x) => x.code === "DUPLICATE_ORDER"
      )
    ).toBe(false);
  });

  it("locks the pad after a burst of orders", () => {
    let guard = emptyGuard();
    for (let i = 0; i < DEFAULT_RISK.burstLimit + 1; i += 1) {
      guard = registerAttempt(guard, 10_000 + i, DEFAULT_RISK);
    }
    expect(guard.cooldownUntil).toBeGreaterThan(10_000);
    expect(evaluateOrder(intent(), context({ guard })).some((v) => v.code === "COOLDOWN")).toBe(true);
  });

  it("blocks new orders once the daily loss cap is hit, but not exits", () => {
    const ctx = context({ dayPnl: -DEFAULT_RISK.maxDailyLoss - 1 });
    expect(evaluateOrder(intent(), ctx).some((v) => v.code === "MAX_DAILY_LOSS")).toBe(true);
    expect(
      evaluateOrder(intent({ isExit: true }), { ...ctx, position: null }).some(
        (v) => v.code === "MAX_DAILY_LOSS"
      )
    ).toBe(false);
  });

  it("warns without blocking on a closed market, a stale quote or a wide spread", () => {
    const v = evaluateOrder(
      intent(),
      context({ marketOpen: false, quoteAgeMs: 30_000, spreadPct: 9 })
    );
    const codes = v.map((x) => x.code);
    expect(codes).toContain("MARKET_CLOSED");
    expect(codes).toContain("STALE_PRICE");
    expect(codes).toContain("WIDE_SPREAD");
    expect(v.every((x) => x.severity === "warn")).toBe(true);
  });

  it("refuses an exit with nothing open", () => {
    const v = evaluateOrder(intent({ isExit: true }), context());
    expect(v.some((x) => x.code === "NO_POSITION" && x.severity === "block")).toBe(true);
  });
});

describe("bracket levels", () => {
  it("puts the stop below and the target above for a buy, and inverts for a sell", () => {
    const buy = defaultLevels("BUY", 100, DEFAULT_RISK);
    expect(buy.stopLoss).toBeLessThan(100);
    expect(buy.target).toBeGreaterThan(100);

    const sell = defaultLevels("SELL", 100, DEFAULT_RISK);
    expect(sell.stopLoss).toBeGreaterThan(100);
    expect(sell.target).toBeLessThan(100);
  });

  it("computes risk to the stop in rupees", () => {
    expect(
      riskAtStop({ contract: CONTRACT, side: "BUY", lots: 2, entryPrice: 100, stopLoss: 90, isExit: false })
    ).toBe(1500);
    expect(
      riskAtStop({ contract: CONTRACT, side: "BUY", lots: 1, entryPrice: 100, stopLoss: null, isExit: false })
    ).toBeNull();
  });
});

// ------------------------------------------------------------- indicators ---

function series(closes: number[], startTime = 0, stepSeconds = 60): Candle[] {
  return closes.map((close, i) => ({
    time: startTime + i * stepSeconds,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

describe("indicators", () => {
  it("returns nulls until the EMA period is satisfied", () => {
    const values = [1, 2, 3, 4, 5];
    const out = ema(values, 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2); // seed is the simple average of the first 3
    expect(out).toHaveLength(values.length);
  });

  it("keeps VWAP inside the session's price range and resets each day", () => {
    const day1 = series([100, 102, 104]);
    const day2 = series([200, 202, 204], 86_400);
    const out = vwap([...day1, ...day2]);

    expect(out[2]!).toBeGreaterThan(99);
    expect(out[2]!).toBeLessThan(105);
    // The reset means day two's VWAP is not dragged down by day one.
    expect(out[5]!).toBeGreaterThan(190);
  });

  it("aggregates 1m bars into 3m bars, preserving open, close and extremes", () => {
    const base: Candle[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 5 },
      { time: 60, open: 11, high: 15, low: 10, close: 14, volume: 7 },
      { time: 120, open: 14, high: 14, low: 8, close: 9, volume: 3 },
      { time: 180, open: 9, high: 11, low: 9, close: 10, volume: 4 },
    ];
    const out = aggregate(base, "3m", 0);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: 0, open: 10, high: 15, low: 8, close: 9, volume: 15 });
    expect(out[1]).toMatchObject({ time: 180, open: 9, close: 10, volume: 4 });
  });

  it("reads the previous day's range, not today's", () => {
    const yesterday = series([100, 110, 90]);
    const today = series([200, 210], 86_400);
    expect(previousDayRange([...yesterday, ...today])).toEqual({ high: 111, low: 89 });
  });

  it("takes the opening range from the first 15 minutes only", () => {
    const candles = series(new Array(30).fill(0).map((_, i) => 100 + i));
    const orb = openingRange(candles, 0);
    // Bars 0-14 only: closes 100..114, so high 115 (close+1) and low 99.
    expect(orb).toEqual({ high: 115, low: 99 });
  });

  it("calls a trend bullish only when price is above both VWAP and the 20 EMA", () => {
    const rising = series(new Array(40).fill(0).map((_, i) => 100 + i * 2));
    expect(biasFor(rising).bias).toBe("BULLISH");

    const falling = series(new Array(40).fill(0).map((_, i) => 200 - i * 2));
    expect(falling.length).toBe(40);
    expect(biasFor(falling).bias).toBe("BEARISH");

    expect(biasFor([]).bias).toBe("NEUTRAL");
    expect(biasFor(series([100, 101, 102])).bias).toBe("NEUTRAL"); // not enough bars for EMA20
  });
});
