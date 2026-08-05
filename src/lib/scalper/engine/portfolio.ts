/**
 * Position keeping and the trade journal.
 *
 * Positions are signed — positive long, negative short — so one arithmetic path
 * serves both directions. A fill that reduces a position realises P&L on the
 * closed slice and writes a journal row; a fill that crosses zero closes the
 * old position and opens the remainder at the fill price.
 *
 * Pure functions only. The store owns the state; this file owns the maths.
 */

import type { CostModel } from "../config";
import type {
  ChargeBreakdown,
  ExitReason,
  Fill,
  JournalTrade,
  OptionContract,
  Position,
  Side,
} from "../types";

export interface PortfolioState {
  positions: Record<string, Position>;
  journal: JournalTrade[];
  /** Realised P&L net of every charge booked so far today. */
  realizedPnl: number;
  /** Gross realised, before charges — useful for the "costs cost me" line. */
  grossRealizedPnl: number;
  totalCharges: number;
}

export function emptyPortfolio(): PortfolioState {
  return { positions: {}, journal: [], realizedPnl: 0, grossRealizedPnl: 0, totalCharges: 0 };
}

export interface ApplyFillInput {
  state: PortfolioState;
  contract: OptionContract;
  side: Side;
  /** Units, positive. */
  quantity: number;
  fillPrice: number;
  charges: ChargeBreakdown;
  ts: number;
  stopLoss?: number | null;
  target?: number | null;
  exitReason?: ExitReason;
}

/** Apply one fill and return the new portfolio. Never mutates the input. */
export function applyFill(input: ApplyFillInput): PortfolioState {
  const { state, contract, side, quantity, fillPrice, charges, ts } = input;
  const key = contract.symbol;
  const signed = side === "BUY" ? quantity : -quantity;

  const positions = { ...state.positions };
  const existing = positions[key];
  const journal = state.journal.slice();

  let realizedDelta = 0;
  let grossDelta = 0;

  if (!existing || existing.quantity === 0) {
    // Opening.
    positions[key] = {
      key,
      contract,
      quantity: signed,
      averagePrice: fillPrice,
      chargesPaid: charges.total,
      realizedPnl: existing?.realizedPnl ?? 0,
      stopLoss: input.stopLoss ?? null,
      target: input.target ?? null,
      openedAt: ts,
      lastPrice: fillPrice,
    };
  } else if (Math.sign(existing.quantity) === Math.sign(signed)) {
    // Adding to the same side — weighted average, charges accumulate.
    const total = existing.quantity + signed;
    const averagePrice =
      (existing.averagePrice * Math.abs(existing.quantity) + fillPrice * quantity) / Math.abs(total);
    positions[key] = {
      ...existing,
      quantity: total,
      averagePrice: round2(averagePrice),
      chargesPaid: existing.chargesPaid + charges.total,
      stopLoss: input.stopLoss ?? existing.stopLoss,
      target: input.target ?? existing.target,
      lastPrice: fillPrice,
    };
  } else {
    // Reducing, closing, or reversing.
    const openQty = Math.abs(existing.quantity);
    const closeQty = Math.min(openQty, quantity);
    const wasLong = existing.quantity > 0;

    const gross = wasLong
      ? (fillPrice - existing.averagePrice) * closeQty
      : (existing.averagePrice - fillPrice) * closeQty;

    // Entry charges are allocated pro-rata to the slice being closed; the exit
    // order's own charges are booked in full against this trade.
    const share = closeQty / openQty;
    const entryChargeShare = existing.chargesPaid * share;
    const tradeCharges = entryChargeShare + charges.total;
    const net = gross - tradeCharges;

    journal.push({
      id: `${key}-${ts}-${journal.length}`,
      entryTs: existing.openedAt,
      exitTs: ts,
      contract,
      direction: wasLong ? "LONG" : "SHORT",
      quantity: closeQty,
      entryPrice: existing.averagePrice,
      exitPrice: fillPrice,
      stopLoss: existing.stopLoss,
      target: existing.target,
      charges: round2(tradeCharges),
      grossPnl: round2(gross),
      netPnl: round2(net),
      durationMs: Math.max(0, ts - existing.openedAt),
      exitReason: input.exitReason ?? "MANUAL",
    });

    realizedDelta = net;
    grossDelta = gross;

    const remaining = existing.quantity + signed;
    if (remaining === 0) {
      delete positions[key];
    } else if (Math.sign(remaining) === Math.sign(existing.quantity)) {
      // Partial exit — the rest of the position stands, with its charges reduced.
      positions[key] = {
        ...existing,
        quantity: remaining,
        chargesPaid: existing.chargesPaid - entryChargeShare,
        realizedPnl: existing.realizedPnl + net,
        lastPrice: fillPrice,
      };
    } else {
      // Reversal: the leftover opens a fresh position the other way.
      positions[key] = {
        key,
        contract,
        quantity: remaining,
        averagePrice: fillPrice,
        chargesPaid: 0,
        realizedPnl: existing.realizedPnl + net,
        stopLoss: null,
        target: null,
        openedAt: ts,
        lastPrice: fillPrice,
      };
    }
  }

  return {
    positions,
    journal,
    realizedPnl: round2(state.realizedPnl + realizedDelta),
    grossRealizedPnl: round2(state.grossRealizedPnl + grossDelta),
    totalCharges: round2(state.totalCharges + charges.total),
  };
}

/** Mark-to-market on the price a position could actually be exited into. */
export function unrealizedPnl(position: Position, mark: number): number {
  return round2((mark - position.averagePrice) * position.quantity);
}

export function totalUnrealized(state: PortfolioState): number {
  let sum = 0;
  for (const p of Object.values(state.positions)) sum += unrealizedPnl(p, p.lastPrice);
  return round2(sum);
}

export function openLots(state: PortfolioState): number {
  let lots = 0;
  for (const p of Object.values(state.positions)) {
    lots += Math.abs(p.quantity) / p.contract.lotSize;
  }
  return lots;
}

/** Exposure at risk if every open position went to zero. */
export function openExposure(state: PortfolioState): number {
  let sum = 0;
  for (const p of Object.values(state.positions)) sum += Math.abs(p.quantity) * p.lastPrice;
  return round2(sum);
}

export function positionList(state: PortfolioState): Position[] {
  return Object.values(state.positions).sort((a, b) => a.openedAt - b.openedAt);
}

/**
 * Stop-loss and target checks.
 *
 * Levels are absolute premium prices. For a long the stop is below and the
 * target above; for a short the reverse. Both are evaluated against the mark,
 * so a stop triggers on what you could actually sell at, not on the LTP print.
 */
export function triggeredExits(
  state: PortfolioState
): { position: Position; reason: Extract<ExitReason, "STOP_LOSS" | "TARGET"> }[] {
  const out: { position: Position; reason: "STOP_LOSS" | "TARGET" }[] = [];
  for (const p of Object.values(state.positions)) {
    if (p.quantity === 0) continue;
    const long = p.quantity > 0;
    if (p.stopLoss !== null) {
      if ((long && p.lastPrice <= p.stopLoss) || (!long && p.lastPrice >= p.stopLoss)) {
        out.push({ position: p, reason: "STOP_LOSS" });
        continue;
      }
    }
    if (p.target !== null) {
      if ((long && p.lastPrice >= p.target) || (!long && p.lastPrice <= p.target)) {
        out.push({ position: p, reason: "TARGET" });
      }
    }
  }
  return out;
}

/** Journal aggregates for the drawer header. */
export function journalStats(journal: JournalTrade[]) {
  if (journal.length === 0) {
    return { trades: 0, wins: 0, losses: 0, winRate: 0, net: 0, charges: 0, avgHoldMs: 0, best: 0, worst: 0 };
  }
  let wins = 0;
  let net = 0;
  let charges = 0;
  let hold = 0;
  let best = -Infinity;
  let worst = Infinity;
  for (const t of journal) {
    if (t.netPnl > 0) wins += 1;
    net += t.netPnl;
    charges += t.charges;
    hold += t.durationMs;
    best = Math.max(best, t.netPnl);
    worst = Math.min(worst, t.netPnl);
  }
  return {
    trades: journal.length,
    wins,
    losses: journal.length - wins,
    winRate: round2((wins / journal.length) * 100),
    net: round2(net),
    charges: round2(charges),
    avgHoldMs: Math.round(hold / journal.length),
    best: round2(best),
    worst: round2(worst),
  };
}

/** Charges reported against a fill, for the fills tab. */
export function fillCost(fill: Fill): number {
  return fill.charges.total;
}

export function estimateExitCharges(
  position: Position,
  price: number,
  model: CostModel,
  compute: (side: Side, premium: number, quantity: number, model: CostModel) => ChargeBreakdown
): number {
  const side: Side = position.quantity > 0 ? "SELL" : "BUY";
  return compute(side, price, Math.abs(position.quantity), model).total;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
