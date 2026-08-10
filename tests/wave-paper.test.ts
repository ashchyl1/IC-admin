import { describe, expect, it } from "vitest";

import {
  DEFAULT_COSTS,
  closePosition,
  openPosition,
  pnlOf,
  rMultiple,
  rewardRisk,
  riskOf,
  sizeForRisk,
  summarise,
  triggeredExit,
  validateTicket,
  type OpenRequest,
  type PaperPosition,
} from "@/lib/wave/paper";
import { levelsForPositions } from "@/lib/wave/paper-levels";

function request(overrides: Partial<OpenRequest> = {}): OpenRequest {
  return {
    terminalId: "A",
    symbol: "NSE:NIFTY 50",
    title: "NIFTY 50",
    side: "BUY",
    quantity: 10,
    entryPrice: 100,
    entryTime: 1_700_000_000,
    stopLoss: 90,
    target: 130,
    ...overrides,
  };
}

describe("position lifecycle", () => {
  it("opens flat, with no P&L and no charges yet", () => {
    const position = openPosition(request());
    expect(position.status).toBe("OPEN");
    expect(position.charges).toBe(0);
    expect(pnlOf(position, 100)).toBe(0);
  });

  it("marks a long to market in both directions", () => {
    const position = openPosition(request());
    expect(pnlOf(position, 110)).toBe(100);
    expect(pnlOf(position, 95)).toBe(-50);
  });

  it("marks a short the other way round", () => {
    const position = openPosition(request({ side: "SELL", stopLoss: 110, target: 70 }));
    expect(pnlOf(position, 90)).toBe(100);
    expect(pnlOf(position, 105)).toBe(-50);
  });

  it("charges the round trip on close and nets it off the result", () => {
    const closed = closePosition(openPosition(request()), 130, 1_700_100_000, "TARGET", DEFAULT_COSTS);
    const gross = (130 - 100) * 10;
    const expectedCharges = DEFAULT_COSTS.perSide * 2 + (100 + 130) * 10 * DEFAULT_COSTS.turnoverRate;

    expect(closed.charges).toBeCloseTo(expectedCharges, 6);
    expect(pnlOf(closed, null)).toBeCloseTo(gross - expectedCharges, 6);
    // A closed position ignores any later price.
    expect(pnlOf(closed, 500)).toBeCloseTo(gross - expectedCharges, 6);
  });
});

describe("risk arithmetic", () => {
  it("measures risk from the stop distance", () => {
    expect(riskOf(openPosition(request()))).toBe(100);
    expect(riskOf(openPosition(request({ stopLoss: null })))).toBeNull();
  });

  it("reports R multiples, and refuses to invent one without a stop", () => {
    const position = openPosition(request());
    expect(rMultiple(position, 120)).toBeCloseTo(2, 6);
    expect(rMultiple(position, 90)).toBeCloseTo(-1, 6);
    expect(rMultiple(openPosition(request({ stopLoss: null })), 120)).toBeNull();
  });

  it("sizes a position from the risk budget", () => {
    expect(sizeForRisk(100, 90, 5_000)).toBe(500);
    expect(sizeForRisk(100, 99.5, 1_000)).toBe(2_000);
    expect(sizeForRisk(100, null, 5_000)).toBeNull();
    expect(sizeForRisk(100, 100, 5_000)).toBeNull();
  });

  it("computes reward-to-risk before the trade is taken", () => {
    expect(rewardRisk(100, 90, 130)).toBeCloseTo(3, 6);
    expect(rewardRisk(100, 90, null)).toBeNull();
  });
});

describe("exit triggers", () => {
  const long = openPosition(request());

  it("fires the stop when a bar trades through it", () => {
    expect(triggeredExit(long, { high: 105, low: 89 })).toEqual({ price: 90, reason: "STOP" });
  });

  it("fires the target when a bar reaches it", () => {
    expect(triggeredExit(long, { high: 131, low: 101 })).toEqual({ price: 130, reason: "TARGET" });
  });

  it("resolves a bar that spans both levels as the stop, never the target", () => {
    // OHLC cannot say which came first, and guessing in the trader's favour
    // would make every backtest look better than the tape.
    expect(triggeredExit(long, { high: 135, low: 85 })).toEqual({ price: 90, reason: "STOP" });
  });

  it("mirrors the logic for a short", () => {
    const short = openPosition(request({ side: "SELL", stopLoss: 110, target: 70 }));
    expect(triggeredExit(short, { high: 111, low: 100 })).toEqual({ price: 110, reason: "STOP" });
    expect(triggeredExit(short, { high: 101, low: 69 })).toEqual({ price: 70, reason: "TARGET" });
  });

  it("does nothing inside the range, or once closed", () => {
    expect(triggeredExit(long, { high: 120, low: 95 })).toBeNull();
    const closed = closePosition(long, 120, 1, "MANUAL");
    expect(triggeredExit(closed, { high: 200, low: 1 })).toBeNull();
  });

  it("ignores a level that was never set", () => {
    const noStop = openPosition(request({ stopLoss: null }));
    expect(triggeredExit(noStop, { high: 105, low: 1 })).toBeNull();
  });
});

describe("portfolio summary", () => {
  const positions: PaperPosition[] = [
    closePosition(openPosition(request()), 130, 2, "TARGET"),
    closePosition(openPosition(request({ entryPrice: 200, stopLoss: 190, target: 230 })), 190, 3, "STOP"),
    openPosition(request({ entryPrice: 150, stopLoss: 140, target: 180 })),
  ];

  it("separates realised from unrealised and counts what is open", () => {
    const summary = summarise(positions, () => 160, DEFAULT_COSTS);
    expect(summary.open).toBe(1);
    expect(summary.closed).toBe(2);
    expect(summary.unrealised).toBe(100);
    expect(summary.net).toBeCloseTo(summary.realised + summary.unrealised, 6);
  });

  it("counts wins and losses after charges, not before", () => {
    const summary = summarise(positions, () => 160, DEFAULT_COSTS);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBe(50);
  });

  it("returns null rather than zero when nothing has been decided", () => {
    const summary = summarise([openPosition(request())], () => 100, DEFAULT_COSTS);
    expect(summary.winRate).toBeNull();
    expect(summary.totalR).toBeNull();
  });
});

describe("chart levels", () => {
  it("draws entry, stop and target for open positions on the matching symbol", () => {
    const levels = levelsForPositions([openPosition(request())], "NSE:NIFTY 50");
    expect(levels).toHaveLength(1);
    expect(levels[0].levels.map((level) => level.kind)).toEqual(["entry", "stop", "target"]);
  });

  it("skips closed positions and other instruments", () => {
    const open = openPosition(request());
    const closed = closePosition(openPosition(request()), 130, 2, "TARGET");
    expect(levelsForPositions([open, closed], "NSE:NIFTY 50")).toHaveLength(1);
    expect(levelsForPositions([open], "NSE:INFY")).toHaveLength(0);
  });

  it("omits levels that were never set", () => {
    const levels = levelsForPositions(
      [openPosition(request({ stopLoss: null, target: null }))],
      "NSE:NIFTY 50"
    );
    expect(levels[0].levels.map((level) => level.kind)).toEqual(["entry"]);
  });
});

describe("ticket validation", () => {
  it("accepts a coherent long and a coherent short", () => {
    expect(validateTicket("BUY", 100, 90, 130, 10)).toEqual([]);
    expect(validateTicket("SELL", 100, 110, 70, 10)).toEqual([]);
  });

  it("refuses a long whose stop sits above the entry", () => {
    // The case the prefill can produce when the count is away from spot: it
    // would be stopped on the first tick.
    const problems = validateTicket("BUY", 19_892, 21_298, 27_637, 3);
    expect(problems.map((problem) => problem.field)).toContain("stopLoss");
  });

  it("refuses a long whose target sits below the entry", () => {
    expect(validateTicket("BUY", 100, 90, 95, 10).map((p) => p.field)).toContain("target");
  });

  it("refuses a short with the levels the wrong way round", () => {
    const problems = validateTicket("SELL", 100, 90, 130, 10);
    expect(problems.map((problem) => problem.field)).toEqual(["stopLoss", "target"]);
  });

  it("allows a trade with no stop or target set", () => {
    expect(validateTicket("BUY", 100, null, null, 1)).toEqual([]);
  });

  it("requires an entry price and a positive quantity", () => {
    expect(validateTicket("BUY", null, 90, 130, 10).map((p) => p.field)).toEqual(["entryPrice"]);
    expect(validateTicket("BUY", 100, 90, 130, 0).map((p) => p.field)).toContain("quantity");
  });
});
