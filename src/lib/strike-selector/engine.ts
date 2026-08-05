/**
 * Strike selection engine.
 *
 * The question this answers is not "which strike pays the most" — that is
 * always the furthest out-of-the-money one, conditional on the move happening,
 * and it is a losing strategy over a series because the hit rate collapses
 * faster than the payoff grows. The question it answers is:
 *
 *     what hit rate does each strike need before it breaks even?
 *
 * That number (`breakevenHitRate`) is comparable across strikes, expiries and
 * structures, and it is the only ranking that survives repetition. Everything
 * else here exists to compute it honestly:
 *
 *   - volatility accrues in *trading* time, so a two-hour intraday move is
 *     scaled by session hours, not by 24;
 *   - decay runs in *calendar* time, because that is how IV is quoted and how
 *     a broker screen reports theta;
 *   - both legs of the round trip cross the spread — entry at the ask, exit at
 *     the bid — with a floor in ticks, which is the actual mechanism that makes
 *     cheap wings unplayable rather than merely low-probability;
 *   - implied vol sits on a smile in standardised moneyness and slides as the
 *     underlying moves (sticky-delta), so a strike's IV at exit is not its IV
 *     at entry;
 *   - the whole surface can shift, because a directional thrust into your
 *     target usually crushes vol and that is how a correct call still loses.
 *
 * Known simplification: scenario probabilities are terminal, not path-aware.
 * A real stop can be touched by a wick that later recovers, so the adverse
 * bucket here is optimistic. Treat the required hit rates as a floor.
 */

import { black76Greeks, normCdf, normPdf, type OptionRight } from "./black76";
import type {
  Advisory,
  Scenario,
  ScenarioId,
  ScenarioOutcome,
  SelectorInput,
  SelectorResult,
  StrikeCandidate,
} from "./types";

const MIN_YEARS = 1 / (365 * 24 * 60); // one minute, so pricing never divides by zero

export function roundToTick(value: number, tick: number): number {
  if (!(tick > 0)) return value;
  return Math.round(value / tick) * tick;
}

/** The option right that expresses a directional call. Buy is long delta. */
export function rightFor(direction: SelectorInput["direction"]): OptionRight {
  return direction === "BUY" ? "CE" : "PE";
}

/**
 * One-sigma move of the underlying over the holding period, in rupees.
 *
 * Trading time, not calendar time: an intraday window only accrues the
 * volatility of the hours the contract is actually open.
 */
export function holdingSigma(input: SelectorInput): number {
  const tradingHoursPerYear = input.sessionHours * input.tradingDaysPerYear;
  if (!(tradingHoursPerYear > 0)) return 0;
  return input.price * input.iv * Math.sqrt(input.holdHours / tradingHoursPerYear);
}

/** E[z | a < z < b] for a standard normal. Used for the open-ended buckets. */
function truncatedMean(a: number, b: number): number {
  const denom = normCdf(b) - normCdf(a);
  if (denom < 1e-9) return (a + b) / 2;
  return (normPdf(a) - normPdf(b)) / denom;
}

/**
 * The four exit states, with terminal probabilities under a driftless normal.
 *
 * Target and adverse exit *at* their levels because those are resting limit and
 * stop orders. The two interior buckets exit at their conditional mean, which
 * is why "flat" is not zero — a stalled trade drifts slightly against you more
 * often than not.
 */
export function buildScenarios(input: SelectorInput): Scenario[] {
  const t = input.targetSigma;
  const s = input.stopSigma;
  const half = t / 2;

  const pTarget = 1 - normCdf(t);
  const pHalf = normCdf(t) - normCdf(half);
  const pAdverse = normCdf(-s);
  const pFlat = Math.max(0, normCdf(half) - normCdf(-s));

  const model: Array<{ id: ScenarioId; label: string; sigmaMove: number; ivShift: number; p: number }> = [
    { id: "target", label: "Target hit", sigmaMove: t, ivShift: input.ivCrushOnTarget, p: pTarget },
    {
      id: "half",
      label: "Half move",
      sigmaMove: truncatedMean(half, t),
      ivShift: input.ivCrushOnTarget / 2,
      p: pHalf,
    },
    {
      id: "flat",
      label: "Stalls out",
      sigmaMove: truncatedMean(-s, half),
      ivShift: input.ivCrushOnTarget / 2,
      p: pFlat,
    },
    { id: "adverse", label: "Stopped out", sigmaMove: -s, ivShift: input.ivShiftOnAdverse, p: pAdverse },
  ];

  // Edge mode: the user asserts a hit rate, and the losing states keep their
  // relative shape while being rescaled into whatever probability is left.
  const edge = input.edgeHitRate;
  if (edge === null) {
    const total = model.reduce((sum, m) => sum + m.p, 0) || 1;
    return model.map((m) => ({ ...m, probability: m.p / total }));
  }

  const clamped = Math.min(0.99, Math.max(0.01, edge));
  const restModel = model.filter((m) => m.id !== "target");
  const restTotal = restModel.reduce((sum, m) => sum + m.p, 0) || 1;
  return model.map((m) => ({
    ...m,
    probability: m.id === "target" ? clamped : (m.p / restTotal) * (1 - clamped),
  }));
}

/**
 * IV for a strike, on a smile in standardised moneyness.
 *
 * Depends on K/F only — never on the right — so calls and puts at the same
 * strike stay consistent with put-call parity. `levelShift` moves the whole
 * surface for a scenario.
 */
function smileIv(
  atmIv: number,
  f: number,
  k: number,
  t: number,
  curvature: number,
  levelShift = 0
): number {
  const base = atmIv * (1 + levelShift);
  if (!(t > 0) || !(base > 0) || !(f > 0) || !(k > 0)) return Math.max(0.01, base);
  const z = standardMoneyness(f, k, t, base);
  return Math.max(0.01, base * (1 + curvature * Math.min(z * z, 9)));
}

/**
 * Standardised moneyness, ln(K/F) scaled by the vol over the option's remaining
 * life. This is the ruler for anything that depends on "how far from the money"
 * in a market sense — the smile and the liquidity of the book — as opposed to
 * `sigmaDistance`, which is scaled to the holding period and answers "how far
 * relative to the move I expect today".
 */
function standardMoneyness(f: number, k: number, t: number, iv: number): number {
  if (!(t > 0) || !(iv > 0) || !(f > 0) || !(k > 0)) return 0;
  return Math.log(k / f) / (iv * Math.sqrt(t));
}

/**
 * Bid-ask, floored in ticks and widened away from the money.
 *
 * Two separate mechanisms, and both matter. The tick floor is what makes cheap
 * far-OTM wings unplayable — a fixed rupee spread is a brutal percentage of a
 * small premium. The liquidity term is what stops deep in-the-money strikes
 * looking frictionless: the book is thickest at the money and thins in *both*
 * directions, so a 0.85-delta call is not the tight quote its size implies.
 */
function quoteAround(
  mid: number,
  moneyness: number,
  input: SelectorInput
): { bid: number; ask: number; spread: number } {
  const thinness = 1 + input.liquidityPenalty * Math.min(moneyness * moneyness, 9);
  const spread = Math.max(input.minSpreadTicks * input.tickSize, input.baseSpreadPct * mid * thinness);
  const ask = roundToTick(mid + spread / 2, input.tickSize);
  const bid = Math.max(input.tickSize, roundToTick(mid - spread / 2, input.tickSize));
  return { bid, ask, spread: ask - bid };
}

/** Short leg of a debit spread: one `spreadWidthSigma` further out of the money. */
function shortStrikeFor(longStrike: number, right: OptionRight, sigmaHold: number, input: SelectorInput): number {
  const raw = input.spreadWidthSigma * sigmaHold;
  const steps = Math.max(1, Math.round(raw / input.strikeStep));
  return right === "CE" ? longStrike + steps * input.strikeStep : longStrike - steps * input.strikeStep;
}

interface LegValue {
  mid: number;
  bid: number;
  ask: number;
  spread: number;
}

function valueAt(
  strike: number,
  right: OptionRight,
  f: number,
  t: number,
  levelShift: number,
  input: SelectorInput
): LegValue {
  const iv = smileIv(input.iv, f, strike, t, input.smileCurvature, levelShift);
  const { price } = black76Greeks({ f, k: strike, t, r: input.riskFreeRate, sigma: iv, right });
  const mid = Math.max(0, price);
  return { mid, ...quoteAround(mid, standardMoneyness(f, strike, t, iv), input) };
}

/**
 * The position's value at the exit time for a given move of the underlying,
 * quoted the way you would actually get out of it.
 */
function unwindValue(
  strike: number,
  shortStrike: number | null,
  right: OptionRight,
  underlying: number,
  tExit: number,
  levelShift: number,
  input: SelectorInput
): number {
  const long = valueAt(strike, right, underlying, tExit, levelShift, input);
  if (shortStrike === null) return long.bid;
  return long.bid - valueAt(shortStrike, right, underlying, tExit, levelShift, input).ask;
}

/**
 * How far the underlying has to travel, by the time you exit, just to get your
 * money back — spread paid twice plus whatever decayed while you held.
 *
 * This is the hurdle that matters on a short hold, and it is not the expiry
 * breakeven: an at-the-money weekly can sit 2 sigma from its expiry breakeven
 * while needing a fifth of a sigma to scratch a two-hour trade. Solved at flat
 * vol so the number is a clean statement about direction and cost, and bisected
 * rather than derived because the debit-spread payoff is not invertible.
 */
function exitBreakevenMove(
  strike: number,
  shortStrike: number | null,
  right: OptionRight,
  favour: number,
  entryFill: number,
  tExit: number,
  input: SelectorInput
): number | null {
  const gap = (move: number) =>
    unwindValue(strike, shortStrike, right, input.price + favour * move, tExit, 0, input) - entryFill;

  if (gap(0) >= 0) return 0;

  const ceiling = 8 * Math.max(holdingSigma(input), input.price * 1e-4);
  if (gap(ceiling) < 0) return null; // cannot scratch even on an enormous move

  let lo = 0;
  let hi = ceiling;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function evaluate(input: SelectorInput): SelectorResult {
  const right = rightFor(input.direction);
  const favour = input.direction === "BUY" ? 1 : -1;
  const sigmaHold = holdingSigma(input);
  const scenarios = buildScenarios(input);

  const tNow = Math.max(MIN_YEARS, input.dte / 365);
  const tExit = Math.max(MIN_YEARS, tNow - input.holdHours / (24 * 365));

  const atmStrike = roundToTick(input.price, input.strikeStep);
  const targetPrice = input.price + favour * input.targetSigma * sigmaHold;
  const stopPrice = input.price - favour * input.stopSigma * sigmaHold;

  const advisories = setupAdvisories(input);

  const strikes: number[] = [];
  for (let i = -input.strikesEachSide; i <= input.strikesEachSide; i++) {
    const k = atmStrike + i * input.strikeStep;
    if (k > 0) strikes.push(k);
  }
  // Lay the table out from deepest in-the-money to furthest out, whichever
  // right we are on, so "cheaper and further out" always reads downward.
  strikes.sort((a, b) => (right === "CE" ? a - b : b - a));

  const candidates = strikes
    .map((strike) => buildCandidate(strike, right, favour, sigmaHold, tNow, tExit, scenarios, input))
    .filter((c): c is StrikeCandidate => c !== null);

  const playable = candidates.filter((c) => !c.advisories.some((a) => a.severity === "block"));
  const pool = playable.length > 0 ? playable : candidates;

  // With no asserted edge every strike is negative expectancy, so ranking by
  // expectancy would just be ranking by which one loses least to the spread.
  // Rank by required hit rate instead — it does not depend on the edge guess.
  const best =
    pool.length === 0
      ? null
      : input.edgeHitRate === null
        ? pool.reduce((a, b) => (requiredRate(a) <= requiredRate(b) ? a : b))
        : pool.reduce((a, b) => (a.edgeRatio >= b.edgeRatio ? a : b));

  return {
    sigmaHold,
    sigmaHoldPct: input.price > 0 ? (sigmaHold / input.price) * 100 : 0,
    atmStrike,
    right,
    targetPrice,
    stopPrice,
    tNow,
    tExit,
    scenarios,
    candidates,
    best,
    advisories,
  };
}

/** Sort key for "needs the smallest hit rate"; unreachable strikes sink. */
function requiredRate(c: StrikeCandidate): number {
  return c.breakevenHitRate ?? Number.POSITIVE_INFINITY;
}

function buildCandidate(
  strike: number,
  right: OptionRight,
  favour: number,
  sigmaHold: number,
  tNow: number,
  tExit: number,
  scenarios: Scenario[],
  input: SelectorInput
): StrikeCandidate | null {
  const isSpread = input.structure === "DEBIT_SPREAD";
  const shortStrike = isSpread ? shortStrikeFor(strike, right, sigmaHold, input) : null;
  if (isSpread && (shortStrike === null || shortStrike <= 0)) return null;

  const longEntry = valueAt(strike, right, input.price, tNow, 0, input);
  const shortEntry = shortStrike === null ? null : valueAt(shortStrike, right, input.price, tNow, 0, input);

  // Buy the long leg at the ask; on a spread, sell the short leg at the bid.
  const entryFill = shortEntry === null ? longEntry.ask : longEntry.ask - shortEntry.bid;
  const mid = shortEntry === null ? longEntry.mid : longEntry.mid - shortEntry.mid;
  const spread = longEntry.spread + (shortEntry?.spread ?? 0);
  if (!(entryFill > 0) || !(mid > 0)) return null;

  const entryIv = smileIv(input.iv, input.price, strike, tNow, input.smileCurvature);
  const longGreeks = black76Greeks({
    f: input.price,
    k: strike,
    t: tNow,
    r: input.riskFreeRate,
    sigma: entryIv,
    right,
  });
  const shortGreeks =
    shortStrike === null
      ? null
      : black76Greeks({
          f: input.price,
          k: shortStrike,
          t: tNow,
          r: input.riskFreeRate,
          sigma: smileIv(input.iv, input.price, shortStrike, tNow, input.smileCurvature),
          right,
        });

  const net = (a: number, b: number | undefined) => a - (b ?? 0);

  const sigmaDistance =
    sigmaHold > 0 ? ((right === "CE" ? strike - input.price : input.price - strike) / sigmaHold) : 0;

  const breakevenPrice = right === "CE" ? strike + entryFill : strike - entryFill;
  const breakevenSigma =
    sigmaHold > 0 ? ((right === "CE" ? breakevenPrice - input.price : input.price - breakevenPrice) / sigmaHold) : 0;

  const scratchMove = exitBreakevenMove(strike, shortStrike, right, favour, entryFill, tExit, input);
  const scratchSigma = scratchMove === null || sigmaHold <= 0 ? null : scratchMove / sigmaHold;

  const outcomes = {} as Record<ScenarioId, ScenarioOutcome>;
  for (const s of scenarios) {
    const underlying = input.price + favour * s.sigmaMove * sigmaHold;
    const exitValue = unwindValue(strike, shortStrike, right, underlying, tExit, s.ivShift, input);
    const perUnit = exitValue - entryFill;
    outcomes[s.id] = {
      id: s.id,
      underlying,
      exitValue,
      pnl: perUnit * input.lotSize,
      returnPct: (perUnit / entryFill) * 100,
    };
  }

  const expectancy = scenarios.reduce((sum, s) => sum + s.probability * outcomes[s.id].pnl, 0);
  const capitalPerLot = entryFill * input.lotSize;

  return {
    strike,
    right,
    moneyness: strike === roundToTick(input.price, input.strikeStep) ? "ATM" : sigmaDistance > 0 ? "OTM" : "ITM",
    sigmaDistance,
    entryIv,
    mid,
    entryFill,
    spread,
    spreadPct: (spread / mid) * 100,
    delta: net(longGreeks.delta, shortGreeks?.delta),
    gamma: net(longGreeks.gamma, shortGreeks?.gamma),
    thetaPerDay: net(longGreeks.thetaPerDay, shortGreeks?.thetaPerDay) * input.lotSize,
    vegaPerPoint: net(longGreeks.vegaPerPoint, shortGreeks?.vegaPerPoint) * input.lotSize,
    shortStrike,
    breakevenPrice,
    breakevenSigma,
    scratchMove,
    scratchSigma,
    capitalPerLot,
    outcomes,
    expectancy,
    edgeRatio: capitalPerLot > 0 ? expectancy / capitalPerLot : 0,
    breakevenHitRate: breakevenHitRate(outcomes, input),
    advisories: candidateAdvisories({ scratchSigma, spread, mid, delta: longGreeks.delta }, input),
  };
}

/**
 * The hit rate at which this strike stops losing money.
 *
 * Holds the *shape* of the losing distribution fixed at its model weights and
 * solves E = 0 for the probability of the target. Independent of whatever edge
 * the user asserted, which is exactly what makes it comparable across strikes.
 */
function breakevenHitRate(
  outcomes: Record<ScenarioId, ScenarioOutcome>,
  input: SelectorInput
): number | null {
  const model = buildScenarios({ ...input, edgeHitRate: null });
  const losers = model.filter((s) => s.id !== "target");
  const weight = losers.reduce((sum, s) => sum + s.probability, 0);
  if (weight <= 0) return null;

  const rest = losers.reduce((sum, s) => sum + (s.probability / weight) * outcomes[s.id].pnl, 0);
  const win = outcomes.target.pnl;
  if (win <= rest) return null; // target pays no better than missing it

  const p = -rest / (win - rest);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return p >= 1 ? null : p;
}

function setupAdvisories(input: SelectorInput): Advisory[] {
  const out: Advisory[] = [];
  const intraday = input.holdHours <= input.sessionHours;

  if (input.holdHours / 24 >= input.dte) {
    out.push({
      code: "HOLD_EXCEEDS_EXPIRY",
      severity: "block",
      message: "The holding period runs past expiry. Pick a further contract before reading anything below.",
    });
  }

  if (intraday && input.dte < 5) {
    out.push({
      code: "EXPIRY_GAMMA_TRAP",
      severity: "warn",
      message: `${input.dte} day${input.dte === 1 ? "" : "s"} to expiry on an intraday hold. Decay per hour goes nonlinear here and an IV drop is instant — 5+ DTE costs more premium and loses far less of it.`,
    });
  }

  if (input.ivRank > 70 && input.structure === "LONG_OPTION") {
    out.push({
      code: "IV_RICH",
      severity: "warn",
      // The usual advice — "sell a wing against it" — is only right when the
      // hold is long enough for the spread to converge towards intrinsic. On an
      // intraday hold the second leg's bid-ask costs more than the vega it saves.
      message: intraday
        ? `IV rank ${Math.round(input.ivRank)} — you are buying expensive vol. On a hold this short a debit spread is not the fix: the second leg's bid-ask usually costs more than the vega it saves. Futures, or a mini contract, express this more cheaply.`
        : `IV rank ${Math.round(input.ivRank)} — you are buying expensive vol. Switch the structure to a debit spread to neutralise most of the vega, or express the call in futures.`,
    });
  }

  if (input.structure === "DEBIT_SPREAD" && intraday) {
    out.push({
      code: "SPREAD_NEEDS_TIME",
      severity: "warn",
      message:
        "A debit spread only reaches its payoff as the premium converges towards intrinsic, which takes days, not hours — and you cross four bid-asks over the round trip. Expect it to score badly on a hold this short. That is the structure, not a bug.",
    });
  }

  if (input.ivRank < 30) {
    out.push({
      code: "IV_CHEAP",
      severity: "info",
      message: `IV rank ${Math.round(input.ivRank)} — vol is cheap, so a long single option is a reasonable way to hold this and you can afford to go further out.`,
    });
  }

  if (input.edgeHitRate === null) {
    out.push({
      code: "NO_EDGE_ASSUMED",
      severity: "info",
      message:
        "No edge assumed, so every strike below is negative expectancy by construction — that is the spread and the decay talking. Read the required hit rate, not the expectancy.",
    });
  }

  return out;
}

function candidateAdvisories(
  c: { scratchSigma: number | null; spread: number; mid: number; delta: number },
  input: SelectorInput
): Advisory[] {
  const out: Advisory[] = [];
  const spreadPct = (c.spread / c.mid) * 100;

  if (spreadPct > 15) {
    out.push({
      code: "ILLIQUID_WING",
      severity: "block",
      message: `Bid-ask is ${spreadPct.toFixed(1)}% of premium. You pay that twice — the move has to cover the spread before it covers anything else.`,
    });
  } else if (spreadPct > 8) {
    out.push({
      code: "SPREAD_EATS_EDGE",
      severity: "warn",
      message: `Bid-ask is ${spreadPct.toFixed(1)}% of premium, charged on both legs of the round trip.`,
    });
  }

  if (c.scratchSigma === null) {
    out.push({
      code: "BREAKEVEN_TOO_FAR",
      severity: "block",
      message: "No move gets this position back to your entry cost by the time you exit. The spread and the decay are larger than anything the position can earn in the window.",
    });
  } else if (c.scratchSigma > 1) {
    out.push({
      code: "BREAKEVEN_TOO_FAR",
      severity: "warn",
      message: `It takes a ${c.scratchSigma.toFixed(2)} sigma move just to scratch. You are past the move you expect before you are past your costs.`,
    });
  }

  const absDelta = Math.abs(c.delta);
  if (absDelta > 0.8 && input.structure === "LONG_OPTION") {
    out.push({
      code: "QUASI_FUTURES",
      severity: "warn",
      message: `Delta ${absDelta.toFixed(2)} — this tracks the underlying almost one-for-one, so it is a futures position with an option's spread and a much larger cheque. It scores well here because it has little extrinsic value left to lose; if you want this exposure, futures carry it more cheaply.`,
    });
  } else if (input.holdHours <= input.sessionHours && (absDelta < 0.4 || absDelta > 0.65)) {
    out.push({
      code: "DELTA_OUT_OF_BAND",
      severity: "info",
      message: `Delta ${absDelta.toFixed(2)} is outside the 0.40-0.65 band that carries the most rupee-gamma per rupee of decay on an intraday hold.`,
    });
  }

  return out;
}
