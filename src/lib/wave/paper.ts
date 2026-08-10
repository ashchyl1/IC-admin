/**
 * Paper trading for the Wave Lab.
 *
 * Simulated by construction — there is no broker behind this file and nothing
 * in it can place an order. It exists so a wave count can be carried through to
 * a decision and then judged: the count says where the invalidation is, the
 * ticket turns that into a stop, and the journal records whether the thesis
 * paid.
 *
 * Positions are linked to the drawing that justified them, so a closed trade
 * carries its wave count into the export rather than being a bare fill.
 *
 * Pure functions over plain data. No React, no store, no chart.
 */

import type { MarketCandle } from "@/lib/market/types";
import { newId } from "./types";

export type Side = "BUY" | "SELL";
export type ExitReason = "TARGET" | "STOP" | "MANUAL";

export interface PaperPosition {
  id: string;
  /** Which terminal the trade was taken from. */
  terminalId: string;
  symbol: string;
  title: string;
  side: Side;
  quantity: number;
  entryPrice: number;
  /** Chart-time seconds of the entry. */
  entryTime: number;
  stopLoss: number | null;
  target: number | null;
  /** The wave count this trade was taken on, when there was one. */
  drawingId?: string;
  drawingLabel?: string;
  note?: string;
  status: "OPEN" | "CLOSED";
  exit?: { price: number; time: number; reason: ExitReason };
  /** Round-trip costs, applied on close. */
  charges: number;
  createdAt: number;
}

export interface CostModel {
  /** Flat charge per executed side — the discount-broker shape. */
  perSide: number;
  /** Proportional charge on turnover, both sides (taxes, exchange fees). */
  turnoverRate: number;
}

/**
 * Indicative equity-delivery-ish rates. Deliberately modest and adjustable:
 * the point is that a paper P&L which ignores costs flatters every strategy,
 * not that these match your contract note to the paisa.
 */
export const DEFAULT_COSTS: CostModel = { perSide: 20, turnoverRate: 0.0006 };

export interface OpenRequest {
  terminalId: string;
  symbol: string;
  title: string;
  side: Side;
  quantity: number;
  entryPrice: number;
  entryTime: number;
  stopLoss: number | null;
  target: number | null;
  drawingId?: string;
  drawingLabel?: string;
  note?: string;
}

export function openPosition(request: OpenRequest): PaperPosition {
  return {
    id: newId("pp"),
    ...request,
    status: "OPEN",
    charges: 0,
    createdAt: Date.now(),
  };
}

/** Signed direction: +1 for a long, −1 for a short. */
export function direction(side: Side): 1 | -1 {
  return side === "BUY" ? 1 : -1;
}

export function grossPnl(position: PaperPosition, price: number): number {
  return (price - position.entryPrice) * position.quantity * direction(position.side);
}

export function costsFor(position: PaperPosition, exitPrice: number, costs: CostModel): number {
  const turnover = (position.entryPrice + exitPrice) * position.quantity;
  return costs.perSide * 2 + turnover * costs.turnoverRate;
}

/** Mark-to-market for an open position; realised P&L once closed. */
export function pnlOf(position: PaperPosition, lastPrice: number | null): number {
  if (position.status === "CLOSED" && position.exit) {
    return grossPnl(position, position.exit.price) - position.charges;
  }
  if (lastPrice === null) return 0;
  return grossPnl(position, lastPrice);
}

/**
 * Risk on the trade in currency — the denominator of an R multiple. Null when
 * no stop was set, because "R" without a stop is meaningless rather than zero.
 */
export function riskOf(position: PaperPosition): number | null {
  if (position.stopLoss === null) return null;
  const perUnit = Math.abs(position.entryPrice - position.stopLoss);
  return perUnit === 0 ? null : perUnit * position.quantity;
}

/** Result in multiples of the risk taken. */
export function rMultiple(position: PaperPosition, lastPrice: number | null): number | null {
  const risk = riskOf(position);
  if (risk === null) return null;
  return pnlOf(position, lastPrice) / risk;
}

export function closePosition(
  position: PaperPosition,
  price: number,
  time: number,
  reason: ExitReason,
  costs: CostModel = DEFAULT_COSTS
): PaperPosition {
  return {
    ...position,
    status: "CLOSED",
    exit: { price, time, reason },
    charges: costsFor(position, price, costs),
  };
}

/**
 * Would this position have been stopped or targeted by the given bar?
 *
 * A bar that spans both levels is resolved as the stop, not the target. The
 * tape order inside a bar is unknowable from OHLC alone, and a paper engine
 * that guesses in its own favour teaches the wrong lesson.
 */
export function triggeredExit(
  position: PaperPosition,
  bar: Pick<MarketCandle, "high" | "low">
): { price: number; reason: ExitReason } | null {
  if (position.status !== "OPEN") return null;
  const long = position.side === "BUY";

  const stopHit =
    position.stopLoss !== null &&
    (long ? bar.low <= position.stopLoss : bar.high >= position.stopLoss);
  if (stopHit) return { price: position.stopLoss as number, reason: "STOP" };

  const targetHit =
    position.target !== null && (long ? bar.high >= position.target : bar.low <= position.target);
  if (targetHit) return { price: position.target as number, reason: "TARGET" };

  return null;
}

export interface PortfolioSummary {
  open: number;
  closed: number;
  realised: number;
  unrealised: number;
  net: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Sum of R multiples across closed trades that had a stop. */
  totalR: number | null;
  exposure: number;
}

export function summarise(
  positions: PaperPosition[],
  lastPriceFor: (position: PaperPosition) => number | null,
  costs: CostModel = DEFAULT_COSTS
): PortfolioSummary {
  let realised = 0;
  let unrealised = 0;
  let wins = 0;
  let losses = 0;
  let totalR = 0;
  let rCount = 0;
  let exposure = 0;
  let open = 0;
  let closed = 0;

  for (const position of positions) {
    if (position.status === "CLOSED") {
      closed += 1;
      const pnl = pnlOf(position, null);
      realised += pnl;
      if (pnl > 0) wins += 1;
      else if (pnl < 0) losses += 1;
      const r = rMultiple(position, null);
      if (r !== null) {
        totalR += r;
        rCount += 1;
      }
    } else {
      open += 1;
      const last = lastPriceFor(position);
      unrealised += pnlOf(position, last);
      exposure += position.entryPrice * position.quantity;
    }
  }

  const decided = wins + losses;
  return {
    open,
    closed,
    realised,
    unrealised,
    net: realised + unrealised,
    wins,
    losses,
    winRate: decided === 0 ? null : (wins / decided) * 100,
    totalR: rCount === 0 ? null : totalR,
    exposure,
  };
}

/**
 * Quantity that risks `riskAmount` given the distance to the stop. Position
 * sizing from the invalidation level is the one calculation that turns a wave
 * count into a trade of a defensible size.
 */
export function sizeForRisk(
  entryPrice: number,
  stopLoss: number | null,
  riskAmount: number
): number | null {
  if (stopLoss === null) return null;
  const perUnit = Math.abs(entryPrice - stopLoss);
  if (perUnit <= 0 || riskAmount <= 0) return null;
  return Math.max(1, Math.floor(riskAmount / perUnit));
}

export interface TicketProblem {
  field: "stopLoss" | "target" | "quantity" | "entryPrice";
  message: string;
}

/**
 * Is this a coherent order at all?
 *
 * A long whose stop sits above its entry is not a risky trade, it is an
 * impossible one — it would be stopped on the first tick. The wave count that
 * prefills the ticket can easily suggest such a thing when the count sits well
 * away from the current price, so the ticket checks rather than trusts.
 */
export function validateTicket(
  side: Side,
  entryPrice: number | null,
  stopLoss: number | null,
  target: number | null,
  quantity: number
): TicketProblem[] {
  const problems: TicketProblem[] = [];

  if (entryPrice === null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    problems.push({ field: "entryPrice", message: "Entry price is required." });
    return problems;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    problems.push({ field: "quantity", message: "Quantity must be at least 1." });
  }

  const long = side === "BUY";
  if (stopLoss !== null) {
    if (long && stopLoss >= entryPrice) {
      problems.push({
        field: "stopLoss",
        message: `A long's stop must sit below the entry. ${stopLoss} is above ${entryPrice}.`,
      });
    }
    if (!long && stopLoss <= entryPrice) {
      problems.push({
        field: "stopLoss",
        message: `A short's stop must sit above the entry. ${stopLoss} is below ${entryPrice}.`,
      });
    }
  }
  if (target !== null) {
    if (long && target <= entryPrice) {
      problems.push({
        field: "target",
        message: `A long's target must sit above the entry. ${target} is below ${entryPrice}.`,
      });
    }
    if (!long && target >= entryPrice) {
      problems.push({
        field: "target",
        message: `A short's target must sit below the entry. ${target} is above ${entryPrice}.`,
      });
    }
  }
  return problems;
}

/** Reward-to-risk, for the ticket to show before the trade is taken. */
export function rewardRisk(
  entryPrice: number,
  stopLoss: number | null,
  target: number | null
): number | null {
  if (stopLoss === null || target === null) return null;
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(target - entryPrice);
  return risk === 0 ? null : reward / risk;
}
