import { describe, expect, it } from "vitest";

import { black76Greeks, black76Price, impliedVolatility, normCdf } from "@/lib/strike-selector/black76";
import { buildScenarios, evaluate, holdingSigma, rightFor } from "@/lib/strike-selector/engine";
import { defaultInput, presetById } from "@/lib/strike-selector/presets";
import type { SelectorInput } from "@/lib/strike-selector/types";

const SILVER = presetById("mcx-silver");

/** The worked example from the desk note: silver, 22% IV, a 1h53m hold. */
function silverCall(overrides: Partial<SelectorInput> = {}): SelectorInput {
  return { ...defaultInput(SILVER), price: 115000, iv: 0.22, holdHours: 1.883, ...overrides };
}

describe("black76", () => {
  const base = { f: 115000, k: 115000, t: 7 / 365, r: 0.065, sigma: 0.22 } as const;

  it("satisfies put-call parity", () => {
    const call = black76Price({ ...base, right: "CE" });
    const put = black76Price({ ...base, right: "PE" });
    const parity = Math.exp(-base.r * base.t) * (base.f - base.k);
    expect(call - put).toBeCloseTo(parity, 4);
  });

  it("holds parity away from the money too", () => {
    const k = 118000;
    const call = black76Price({ ...base, k, right: "CE" });
    const put = black76Price({ ...base, k, right: "PE" });
    expect(call - put).toBeCloseTo(Math.exp(-base.r * base.t) * (base.f - k), 4);
  });

  it("prices an at-the-money call near the 0.4 * F * sigma * sqrt(T) approximation", () => {
    const price = black76Price({ ...base, right: "CE" });
    const approx = 0.4 * base.f * base.sigma * Math.sqrt(base.t);
    expect(price / approx).toBeGreaterThan(0.9);
    expect(price / approx).toBeLessThan(1.1);
  });

  it("gives an at-the-money call a delta near half the discount factor", () => {
    const { delta } = black76Greeks({ ...base, right: "CE" });
    expect(delta).toBeGreaterThan(0.5);
    expect(delta).toBeLessThan(0.56);
  });

  it("signs the greeks the way a long option behaves", () => {
    const call = black76Greeks({ ...base, right: "CE" });
    const put = black76Greeks({ ...base, right: "PE" });
    expect(call.delta).toBeGreaterThan(0);
    expect(put.delta).toBeLessThan(0);
    expect(call.gamma).toBeGreaterThan(0);
    expect(put.gamma).toBeCloseTo(call.gamma, 8); // gamma is right-agnostic
    expect(call.thetaPerDay).toBeLessThan(0);
    expect(call.vegaPerPoint).toBeGreaterThan(0);
  });

  it("collapses to intrinsic at expiry", () => {
    expect(black76Price({ ...base, k: 110000, t: 0, right: "CE" })).toBe(5000);
    expect(black76Price({ ...base, k: 110000, t: 0, right: "PE" })).toBe(0);
  });

  it("round-trips implied volatility", () => {
    const price = black76Price({ ...base, k: 117000, sigma: 0.31, right: "CE" });
    const solved = impliedVolatility(price, { f: base.f, k: 117000, t: base.t, r: base.r, right: "CE" });
    expect(solved).not.toBeNull();
    expect(solved as number).toBeCloseTo(0.31, 4);
  });

  it("refuses a premium below intrinsic", () => {
    expect(impliedVolatility(100, { f: 115000, k: 110000, t: base.t, r: base.r, right: "CE" })).toBeNull();
  });
});

describe("holdingSigma", () => {
  it("matches the hand calculation for a 1h53m silver hold", () => {
    // 115000 * 0.22 * sqrt(1.883 / (14.5 * 250)) = 576.62, i.e. ~0.5% of spot
    expect(holdingSigma(silverCall())).toBeCloseTo(576.62, 1);
  });

  it("scales with the square root of time, not linearly", () => {
    const one = holdingSigma(silverCall({ holdHours: 1 }));
    const four = holdingSigma(silverCall({ holdHours: 4 }));
    expect(four / one).toBeCloseTo(2, 6);
  });

  it("uses session hours, so an NSE hour is worth more than an MCX hour", () => {
    const mcx = holdingSigma(silverCall({ holdHours: 1 }));
    const nse = holdingSigma(silverCall({ holdHours: 1, sessionHours: 6.25 }));
    expect(nse).toBeGreaterThan(mcx);
  });
});

describe("buildScenarios", () => {
  it("produces probabilities that sum to one", () => {
    const total = buildScenarios(silverCall()).reduce((s, x) => s + x.probability, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("matches the normal tail for the target bucket with no edge asserted", () => {
    const target = buildScenarios(silverCall()).find((s) => s.id === "target");
    expect(target?.probability).toBeCloseTo(1 - normCdf(1), 6);
  });

  it("honours an asserted hit rate and rescales the rest", () => {
    const scenarios = buildScenarios(silverCall({ edgeHitRate: 0.45 }));
    expect(scenarios.find((s) => s.id === "target")?.probability).toBeCloseTo(0.45, 10);
    const rest = scenarios.filter((s) => s.id !== "target").reduce((s, x) => s + x.probability, 0);
    expect(rest).toBeCloseTo(0.55, 10);
  });

  it("exits target and stop at their levels, and drifts the stalled bucket slightly against you", () => {
    const scenarios = buildScenarios(silverCall());
    expect(scenarios.find((s) => s.id === "target")?.sigmaMove).toBe(1);
    expect(scenarios.find((s) => s.id === "adverse")?.sigmaMove).toBe(-1);
    const flat = scenarios.find((s) => s.id === "flat")?.sigmaMove as number;
    expect(flat).toBeLessThan(0);
    expect(flat).toBeGreaterThan(-0.5);
  });
});

describe("evaluate", () => {
  it("expresses a buy signal as a call and a sell signal as a put", () => {
    expect(rightFor("BUY")).toBe("CE");
    expect(evaluate(silverCall()).right).toBe("CE");
    expect(evaluate(silverCall({ direction: "SELL" })).right).toBe("PE");
  });

  it("puts the target above spot for a buy and below for a sell", () => {
    expect(evaluate(silverCall()).targetPrice).toBeGreaterThan(115000);
    expect(evaluate(silverCall({ direction: "SELL" })).targetPrice).toBeLessThan(115000);
  });

  it("orders the table from in-the-money down to out-of-the-money for both rights", () => {
    const calls = evaluate(silverCall()).candidates;
    const puts = evaluate(silverCall({ direction: "SELL" })).candidates;
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].sigmaDistance).toBeGreaterThan(calls[i - 1].sigmaDistance);
      expect(puts[i].sigmaDistance).toBeGreaterThan(puts[i - 1].sigmaDistance);
    }
    expect(calls[0].strike).toBeLessThan(calls[calls.length - 1].strike);
    expect(puts[0].strike).toBeGreaterThan(puts[puts.length - 1].strike);
  });

  it("charges a wider proportional spread the further out of the money it goes", () => {
    const candidates = evaluate(silverCall()).candidates;
    const atm = candidates.find((c) => c.moneyness === "ATM")!;
    const wing = candidates[candidates.length - 1];
    expect(wing.entryFill).toBeLessThan(atm.entryFill);
    expect(wing.spreadPct).toBeGreaterThan(atm.spreadPct);
  });

  it("requires a higher hit rate the further out of the money the strike sits", () => {
    // The core claim of the tool: cheap wings are not cheap once you price the
    // hit rate they demand. Compare the money against the far strike.
    const candidates = evaluate(silverCall()).candidates.filter((c) => c.breakevenHitRate !== null);
    const atm = candidates.find((c) => c.moneyness === "ATM")!;
    const wing = candidates[candidates.length - 1];
    expect(atm.breakevenHitRate).not.toBeNull();
    expect(wing.breakevenHitRate as number).toBeGreaterThan(atm.breakevenHitRate as number);
  });

  it("loses money on every strike when no edge is asserted", () => {
    for (const c of evaluate(silverCall()).candidates) {
      expect(c.expectancy).toBeLessThan(0);
    }
  });

  it("turns expectancy positive once the asserted edge clears the required hit rate", () => {
    const base = evaluate(silverCall()).best!;
    const required = base.breakevenHitRate as number;
    const withEdge = evaluate(silverCall({ edgeHitRate: Math.min(0.95, required + 0.15) }));
    const same = withEdge.candidates.find((c) => c.strike === base.strike)!;
    expect(same.expectancy).toBeGreaterThan(0);
    expect(same.edgeRatio).toBeGreaterThan(0);
  });

  it("ranks by required hit rate without an edge and by edge ratio with one", () => {
    const noEdge = evaluate(silverCall());
    const rates = noEdge.candidates
      .map((c) => c.breakevenHitRate)
      .filter((r): r is number => r !== null);
    expect(noEdge.best?.breakevenHitRate).toBeCloseTo(Math.min(...rates), 10);

    const withEdge = evaluate(silverCall({ edgeHitRate: 0.6 }));
    const ratios = withEdge.candidates.map((c) => c.edgeRatio);
    expect(withEdge.best?.edgeRatio).toBeCloseTo(Math.max(...ratios), 10);
  });

  it("commits less capital as a debit spread than as the outright option", () => {
    const long = evaluate(silverCall()).candidates.find((c) => c.moneyness === "ATM")!;
    const spread = evaluate(silverCall({ structure: "DEBIT_SPREAD" })).candidates.find(
      (c) => c.strike === long.strike
    )!;
    expect(spread.shortStrike).not.toBeNull();
    expect(spread.shortStrike as number).toBeGreaterThan(spread.strike);
    expect(spread.capitalPerLot).toBeLessThan(long.capitalPerLot);
    // Selling the wing pays for most of the vega.
    expect(Math.abs(spread.vegaPerPoint)).toBeLessThan(Math.abs(long.vegaPerPoint));
  });

  it("quotes the money tighter than either wing", () => {
    // Both mechanisms at once: the tick floor punishes cheap far-OTM strikes,
    // the liquidity term punishes deep ITM. Neither wing is a tight quote.
    const candidates = evaluate(silverCall()).candidates;
    const atm = candidates.find((c) => c.moneyness === "ATM")!;
    expect(candidates[0].spreadPct).toBeGreaterThan(atm.spreadPct);
    expect(candidates[candidates.length - 1].spreadPct).toBeGreaterThan(atm.spreadPct);
  });

  it("measures the scratch hurdle at exit, well inside the expiry breakeven", () => {
    // A 2h hold on a 7-DTE option: the expiry breakeven is a couple of sigma
    // out, but scratching only needs the spread and two hours of decay back.
    const atm = evaluate(silverCall()).candidates.find((c) => c.moneyness === "ATM")!;
    expect(atm.scratchSigma).not.toBeNull();
    expect(atm.scratchSigma as number).toBeGreaterThan(0);
    expect(atm.scratchSigma as number).toBeLessThan(atm.breakevenSigma);
  });

  it("makes the scratch hurdle grow as the strike moves out of the money", () => {
    const candidates = evaluate(silverCall()).candidates.filter((c) => c.scratchSigma !== null);
    const atm = candidates.find((c) => c.moneyness === "ATM")!;
    const wing = candidates[candidates.length - 1];
    expect(wing.scratchSigma as number).toBeGreaterThan(atm.scratchSigma as number);
  });

  it("prices the scratch hurdle so that exactly reaching it returns roughly zero", () => {
    const atm = evaluate(silverCall()).candidates.find((c) => c.moneyness === "ATM")!;
    const move = atm.scratchMove as number;
    const nudged = evaluate(silverCall({ targetSigma: move / holdingSigma(silverCall()) }));
    const same = nudged.candidates.find((c) => c.strike === atm.strike)!;
    // Flat-vol solve vs a scenario that also crushes vol, so allow a little slack.
    expect(Math.abs(same.outcomes.target.returnPct)).toBeLessThan(12);
  });

  it("calls out a high-delta strike as a futures position in disguise", () => {
    const deep = evaluate(silverCall()).candidates.find((c) => Math.abs(c.delta) > 0.8);
    expect(deep).toBeDefined();
    expect(deep!.advisories.some((a) => a.code === "QUASI_FUTURES" && a.severity === "warn")).toBe(true);
  });

  it("keeps breakeven above the strike for a call and below it for a put", () => {
    const call = evaluate(silverCall()).candidates[0];
    expect(call.breakevenPrice).toBeGreaterThan(call.strike);
    const put = evaluate(silverCall({ direction: "SELL" })).candidates[0];
    expect(put.breakevenPrice).toBeLessThan(put.strike);
  });

  it("blocks the whole setup when the hold runs past expiry", () => {
    const result = evaluate(silverCall({ holdHours: 30, dte: 1 }));
    expect(result.advisories.some((a) => a.code === "HOLD_EXCEEDS_EXPIRY" && a.severity === "block")).toBe(true);
  });

  it("warns about the expiry gamma trap on a short-dated intraday hold", () => {
    const result = evaluate(silverCall({ dte: 1 }));
    expect(result.advisories.some((a) => a.code === "EXPIRY_GAMMA_TRAP")).toBe(true);
    expect(evaluate(silverCall({ dte: 20 })).advisories.some((a) => a.code === "EXPIRY_GAMMA_TRAP")).toBe(false);
  });

  it("flags rich vol, and stops recommending a spread once the hold is intraday", () => {
    const intraday = evaluate(silverCall({ ivRank: 85 }));
    const advice = intraday.advisories.find((a) => a.code === "IV_RICH");
    expect(advice).toBeDefined();
    expect(advice!.message).toContain("Futures");

    const swing = evaluate(silverCall({ ivRank: 85, holdHours: 40 }));
    expect(swing.advisories.find((a) => a.code === "IV_RICH")!.message).toContain("debit spread");

    // Already on a spread, so there is nothing left to switch to.
    const spread = evaluate(silverCall({ ivRank: 85, structure: "DEBIT_SPREAD" }));
    expect(spread.advisories.some((a) => a.code === "IV_RICH")).toBe(false);
  });

  it("warns that a debit spread needs days, not hours, to pay", () => {
    expect(
      evaluate(silverCall({ structure: "DEBIT_SPREAD" })).advisories.some(
        (a) => a.code === "SPREAD_NEEDS_TIME"
      )
    ).toBe(true);
    expect(
      evaluate(silverCall({ structure: "DEBIT_SPREAD", holdHours: 40 })).advisories.some(
        (a) => a.code === "SPREAD_NEEDS_TIME"
      )
    ).toBe(false);
  });

  it("never returns a best pick that carries a blocking advisory when a clean one exists", () => {
    const result = evaluate(silverCall());
    expect(result.best).not.toBeNull();
    expect(result.best!.advisories.some((a) => a.severity === "block")).toBe(false);
  });

  it("keeps every scenario's loss bounded by the premium paid on a long option", () => {
    for (const c of evaluate(silverCall()).candidates) {
      for (const id of ["target", "half", "flat", "adverse"] as const) {
        expect(c.outcomes[id].pnl).toBeGreaterThanOrEqual(-c.capitalPerLot - 1e-6);
      }
    }
  });
});
