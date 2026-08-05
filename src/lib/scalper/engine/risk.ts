/**
 * Pre-trade risk gate.
 *
 * Every order — keyboard, mouse, stop-loss trigger or kill switch — goes
 * through `evaluateOrder` first. Violations come back typed and split into
 * `block` (the order is refused and recorded as rejected) and `warn` (the order
 * proceeds but the UI says why it was a bad idea).
 *
 * The rule is deliberately simple: if the engine cannot prove the order is
 * inside your limits, it does not fill it.
 */

import type { RiskSettings } from "../config";
import type { OptionContract, Position, RiskViolation, Side } from "../types";

export interface GuardState {
  /** `symbol:side` -> timestamp of the last accepted order, for the dup check. */
  lastOrderAt: Record<string, number>;
  /** Timestamps of recent order attempts, for the burst check. */
  recentAttempts: number[];
  /** Orders are refused until this instant. */
  cooldownUntil: number;
}

export function emptyGuard(): GuardState {
  return { lastOrderAt: {}, recentAttempts: [], cooldownUntil: 0 };
}

export interface RiskContext {
  now: number;
  settings: RiskSettings;
  killSwitch: boolean;
  marketOpen: boolean;
  /** Age of the quote in milliseconds. */
  quoteAgeMs: number;
  spreadPct: number;
  /** Realised + unrealised for the day, signed. */
  dayPnl: number;
  openLots: number;
  guard: GuardState;
  /** Existing position on this contract, if any. */
  position: Position | null;
}

export interface OrderIntent {
  contract: OptionContract;
  side: Side;
  lots: number;
  entryPrice: number;
  stopLoss: number | null;
  /** Exit legs skip the sizing and duplicate checks. */
  isExit: boolean;
}

export function evaluateOrder(intent: OrderIntent, ctx: RiskContext): RiskViolation[] {
  const out: RiskViolation[] = [];
  const { settings } = ctx;

  // --- hard stops ---------------------------------------------------------

  if (ctx.killSwitch && !intent.isExit) {
    out.push({
      code: "KILL_SWITCH",
      severity: "block",
      message: "Kill switch is engaged. New orders are disabled until you reset it.",
    });
  }

  if (ctx.dayPnl <= -settings.maxDailyLoss && !intent.isExit) {
    out.push({
      code: "MAX_DAILY_LOSS",
      severity: "block",
      message: `Daily loss limit of ₹${settings.maxDailyLoss.toLocaleString("en-IN")} reached. Only exits are allowed.`,
    });
  }

  if (!intent.isExit) {
    if (intent.lots > settings.maxLotsPerOrder) {
      out.push({
        code: "MAX_LOTS",
        severity: "block",
        message: `Order size ${intent.lots} lots exceeds the ${settings.maxLotsPerOrder}-lot per-order cap.`,
      });
    }

    const wouldOpen = ctx.openLots + intent.lots;
    if (wouldOpen > settings.maxOpenLots) {
      out.push({
        code: "MAX_LOTS",
        severity: "block",
        message: `That would take open exposure to ${wouldOpen} lots, past the ${settings.maxOpenLots}-lot book cap.`,
      });
    }

    const risk = riskAtStop(intent);
    if (risk !== null && risk > settings.maxLossPerTrade) {
      out.push({
        code: "MAX_LOSS_PER_TRADE",
        severity: "block",
        message: `Risk to stop is ₹${Math.round(risk).toLocaleString("en-IN")}, over the ₹${settings.maxLossPerTrade.toLocaleString("en-IN")} per-trade limit. Reduce lots or tighten the stop.`,
      });
    }

    if (ctx.now < ctx.guard.cooldownUntil) {
      const seconds = Math.ceil((ctx.guard.cooldownUntil - ctx.now) / 1000);
      out.push({
        code: "COOLDOWN",
        severity: "block",
        message: `Too many orders too quickly. Pad locked for ${seconds}s.`,
      });
    }

    const dupKey = duplicateKey(intent.contract.symbol, intent.side);
    const lastAt = ctx.guard.lastOrderAt[dupKey];
    if (lastAt !== undefined && ctx.now - lastAt < settings.duplicateWindowMs) {
      out.push({
        code: "DUPLICATE_ORDER",
        severity: "block",
        message: `Identical order sent ${ctx.now - lastAt}ms ago. Blocked as a duplicate.`,
      });
    }
  }

  if (intent.isExit && !ctx.position) {
    out.push({ code: "NO_POSITION", severity: "block", message: "Nothing open on that contract." });
  }

  // --- advisories ---------------------------------------------------------

  if (!ctx.marketOpen) {
    out.push({
      code: "MARKET_CLOSED",
      severity: "warn",
      message: "The exchange session is closed. Fills use simulated prices.",
    });
  }

  if (ctx.quoteAgeMs > settings.staleAfterMs) {
    out.push({
      code: "STALE_PRICE",
      severity: "warn",
      message: `Last quote is ${(ctx.quoteAgeMs / 1000).toFixed(1)}s old. The fill may not reflect the market.`,
    });
  }

  if (ctx.spreadPct > settings.wideSpreadPct) {
    out.push({
      code: "WIDE_SPREAD",
      severity: "warn",
      message: `Spread is ${ctx.spreadPct.toFixed(2)}% of mid — you pay that twice on a round trip.`,
    });
  }

  return out;
}

/** Rupees lost if the stop fills exactly, or null when no stop is set. */
export function riskAtStop(intent: OrderIntent): number | null {
  if (intent.stopLoss === null) return null;
  const quantity = intent.lots * intent.contract.lotSize;
  const perUnit =
    intent.side === "BUY" ? intent.entryPrice - intent.stopLoss : intent.stopLoss - intent.entryPrice;
  return Math.max(0, perUnit) * quantity;
}

export function rewardAtTarget(
  side: Side,
  entryPrice: number,
  target: number | null,
  quantity: number
): number | null {
  if (target === null) return null;
  const perUnit = side === "BUY" ? target - entryPrice : entryPrice - target;
  return Math.max(0, perUnit) * quantity;
}

export function riskReward(risk: number | null, reward: number | null): number | null {
  if (!risk || !reward || risk <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

export function blocking(violations: RiskViolation[]): RiskViolation[] {
  return violations.filter((v) => v.severity === "block");
}

export function warnings(violations: RiskViolation[]): RiskViolation[] {
  return violations.filter((v) => v.severity === "warn");
}

export function duplicateKey(symbol: string, side: Side): string {
  return `${symbol}:${side}`;
}

/**
 * Record an attempt and decide whether the burst limit has just tripped.
 * Returns the next guard state — callers replace theirs with it.
 */
export function registerAttempt(guard: GuardState, now: number, settings: RiskSettings): GuardState {
  const recent = [...guard.recentAttempts, now].filter((t) => now - t <= settings.cooldownWindowMs);
  const tripped = recent.length > settings.burstLimit;
  return {
    ...guard,
    recentAttempts: recent,
    cooldownUntil: tripped ? now + settings.cooldownLockMs : guard.cooldownUntil,
  };
}

export function registerAccepted(
  guard: GuardState,
  symbol: string,
  side: Side,
  now: number
): GuardState {
  return { ...guard, lastOrderAt: { ...guard.lastOrderAt, [duplicateKey(symbol, side)]: now } };
}

/** Default stop and target levels from the entry price, in absolute premium. */
export function defaultLevels(
  side: Side,
  entryPrice: number,
  settings: RiskSettings
): { stopLoss: number; target: number } {
  const stopDelta = (entryPrice * settings.defaultStopPct) / 100;
  const targetDelta = (entryPrice * settings.defaultTargetPct) / 100;
  const round = (v: number) => Math.max(0.05, Math.round(v * 20) / 20);
  return side === "BUY"
    ? { stopLoss: round(entryPrice - stopDelta), target: round(entryPrice + targetDelta) }
    : { stopLoss: round(entryPrice + stopDelta), target: round(Math.max(0.05, entryPrice - targetDelta)) };
}
