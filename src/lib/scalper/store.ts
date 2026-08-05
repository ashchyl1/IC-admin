"use client";

/**
 * Scalper Window application state.
 *
 * One store, four clearly separated concerns:
 *   - feed        : the adapter and its latest snapshot
 *   - selection   : what the three charts and the pad are pointed at
 *   - execution   : orders, fills, positions, journal (delegated to /engine)
 *   - ui          : toggles, dialogs, notices
 *
 * The store never computes indicators or prices — it asks the adapter and the
 * engine. That keeps this file about orchestration, which is the only thing
 * that genuinely needs to be global.
 */

import { create } from "zustand";

import {
  DEFAULT_COST_MODEL,
  DEFAULT_EXECUTION,
  DEFAULT_OPTION_TIMEFRAME,
  DEFAULT_RISK,
  DEFAULT_SPOT_TIMEFRAME,
  SYNC_TIMEFRAMES,
  UNDERLYINGS,
  type CostModel,
  type ExecutionSettings,
  type RiskSettings,
} from "./config";
import { createAdapter, type AdapterSnapshot, type MarketDataAdapter } from "./adapters";
import { seedPortfolio } from "./mock/seedTrades";
import { fromChartTime } from "./time";
import { computeCharges } from "./engine/charges";
import { markPrice, simulateFill } from "./engine/execution";
import {
  applyFill,
  emptyPortfolio,
  openLots as countOpenLots,
  totalUnrealized,
  triggeredExits,
  type PortfolioState,
} from "./engine/portfolio";
import {
  blocking,
  defaultLevels,
  emptyGuard,
  evaluateOrder,
  registerAccepted,
  registerAttempt,
  warnings,
  type GuardState,
  type OrderIntent,
} from "./engine/risk";
import type {
  ExitReason,
  Fill,
  Notice,
  OptionType,
  Order,
  Position,
  RiskViolation,
  Side,
  Timeframe,
  Underlying,
} from "./types";

export interface PendingConfirm {
  intent: OrderIntent;
  warnings: RiskViolation[];
  quantity: number;
  estimatedValue: number;
  target: number | null;
}

export interface ScalperState {
  // ---- feed ----
  adapter: MarketDataAdapter | null;
  snapshot: AdapterSnapshot | null;
  /** Wall-clock ms of the last snapshot — drives the stale indicator. */
  lastTickAt: number;
  booted: boolean;

  // ---- selection ----
  underlying: Underlying;
  expiry: string;
  /** Strike the pad and the two option charts point at. */
  strike: number | null;
  autoAtm: boolean;
  optionTimeframe: Timeframe;
  spotTimeframe: Timeframe;

  // ---- execution ----
  portfolio: PortfolioState;
  orders: Order[];
  fills: Fill[];
  guard: GuardState;
  killSwitch: boolean;
  callLots: number;
  putLots: number;
  attachBracket: boolean;
  selectedPositionKey: string | null;

  // ---- settings ----
  risk: RiskSettings;
  costs: CostModel;
  execution: ExecutionSettings;

  // ---- ui ----
  syncCharts: boolean;
  instantOrder: boolean;
  showVolumeProfile: boolean;
  showIndicators: boolean;
  showLevels: boolean;
  journalOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  pendingConfirm: PendingConfirm | null;
  notices: Notice[];

  // ---- lifecycle ----
  boot: () => void;
  shutdown: () => void;
  restartFeed: () => void;

  // ---- selection actions ----
  setUnderlying: (u: Underlying) => void;
  setExpiry: (iso: string) => void;
  setStrike: (strike: number) => void;
  stepStrike: (direction: 1 | -1) => void;
  setAutoAtm: (on: boolean) => void;
  snapToAtm: () => void;
  setOptionTimeframe: (tf: Timeframe) => void;
  setSpotTimeframe: (tf: Timeframe) => void;
  setLots: (leg: OptionType, lots: number) => void;
  /** Relative change — correct even when clicks outrun React's re-render. */
  bumpLots: (leg: OptionType, delta: number) => void;
  setAttachBracket: (on: boolean) => void;
  setSelectedPosition: (key: string | null) => void;

  // ---- execution actions ----
  requestOrder: (leg: OptionType, side: Side) => void;
  confirmPending: () => void;
  cancelPending: () => void;
  exitPosition: (key: string, reason?: ExitReason) => void;
  exitAll: (reason?: ExitReason) => void;
  engageKillSwitch: () => void;
  resetKillSwitch: () => void;

  // ---- ui actions ----
  setSync: (on: boolean) => void;
  setInstantOrder: (on: boolean) => void;
  toggleVolumeProfile: () => void;
  toggleIndicators: () => void;
  toggleLevels: () => void;
  setJournalOpen: (on: boolean) => void;
  setSettingsOpen: (on: boolean) => void;
  setShortcutsOpen: (on: boolean) => void;
  updateRisk: (patch: Partial<RiskSettings>) => void;
  updateExecution: (patch: Partial<ExecutionSettings>) => void;
  updateCosts: (patch: Partial<CostModel>) => void;
  resetSession: () => void;
  notify: (notice: Omit<Notice, "id" | "ts">) => void;
  dismissNotice: (id: string) => void;

  // ---- internal ----
  /** Fill an approved order. Not called directly by components. */
  execute: (pending: PendingConfirm, reason?: ExitReason) => void;
  recordRejection: (intent: OrderIntent, reason: string) => void;
  runAutoExits: () => void;
}

let unsubscribe: (() => void) | null = null;
let noticeSeq = 0;

export const useScalper = create<ScalperState>((set, get) => ({
  adapter: null,
  snapshot: null,
  lastTickAt: 0,
  booted: false,

  underlying: "NIFTY",
  expiry: "",
  strike: null,
  autoAtm: true,
  // Sync starts on, so both panes start on the shared 3m — inside the ranges
  // the brief allows for options (1-3m) and spot (3-5m) alike.
  optionTimeframe: DEFAULT_SPOT_TIMEFRAME,
  spotTimeframe: DEFAULT_SPOT_TIMEFRAME,

  portfolio: emptyPortfolio(),
  orders: [],
  fills: [],
  guard: emptyGuard(),
  killSwitch: false,
  callLots: 1,
  putLots: 1,
  attachBracket: true,
  selectedPositionKey: null,

  risk: DEFAULT_RISK,
  costs: DEFAULT_COST_MODEL,
  execution: DEFAULT_EXECUTION,

  syncCharts: true,
  instantOrder: false,
  showVolumeProfile: false,
  showIndicators: true,
  showLevels: true,
  journalOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  pendingConfirm: null,
  notices: [],

  // ------------------------------------------------------------ lifecycle ---

  boot: () => {
    if (get().booted) return;
    const adapter = createAdapter();
    set({ adapter, booted: true });

    unsubscribe = adapter.onSnapshot((snapshot) => {
      const state = get();
      const strike = state.autoAtm || state.strike === null ? snapshot.atmStrike : state.strike;

      // Mark open positions against the fresh chain before anything else reads
      // P&L, so the risk checks and the display can never disagree.
      set({
        snapshot,
        lastTickAt: Date.now(),
        expiry: state.expiry || snapshot.expiries[0] || "",
        strike,
        portfolio: markPositions(state.portfolio, adapter),
      });

      get().runAutoExits();
    });

    adapter.connect().catch((error: unknown) => {
      get().notify({
        tone: "error",
        title: "Feed unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    });

    adapter.select({
      underlying: get().underlying,
      expiry: get().expiry,
      centreStrike: get().autoAtm ? null : get().strike,
    });

    // Give the demo a past. Simulated feeds only — fabricated history must
    // never appear next to real broker data.
    const first = adapter.snapshot();
    if (!adapter.isLive && first && get().portfolio.journal.length === 0) {
      const { underlying, costs } = get();
      set({
        portfolio: seedPortfolio({
          underlying,
          expiry: first.expiries[0] ?? "",
          atmStrike: first.atmStrike,
          strikeStep: UNDERLYINGS[underlying].strikeStep,
          lotSize: UNDERLYINGS[underlying].lotSize,
          now: first.ts,
          sessionOpenMs: fromChartTime(adapter.sessionOpenSeconds(underlying)),
          costs,
          contractFor: (strike, optionType) =>
            adapter.contractFor(underlying, strike, optionType, first.expiries[0] ?? ""),
        }),
      });
    }
  },

  shutdown: () => {
    unsubscribe?.();
    unsubscribe = null;
    get().adapter?.disconnect();
    set({ booted: false, adapter: null });
  },

  restartFeed: () => {
    get().adapter?.restart?.();
    get().notify({
      tone: "info",
      title: "Demo session restarted",
      message: "Prices replay from 09:15.",
    });
  },

  // ------------------------------------------------------------ selection ---

  setUnderlying: (underlying) => {
    // The adapter owns the expiry calendar; hand it a blank and take what it
    // publishes on the next tick rather than guessing here.
    set({ underlying, strike: null, autoAtm: true, expiry: "" });
    get().adapter?.select({ underlying, expiry: "", centreStrike: null });
  },

  setExpiry: (expiry) => {
    set({ expiry });
    const { adapter, underlying, autoAtm, strike } = get();
    adapter?.select({ underlying, expiry, centreStrike: autoAtm ? null : strike });
  },

  setStrike: (strike) => {
    set({ strike, autoAtm: false });
    const { adapter, underlying, expiry } = get();
    adapter?.select({ underlying, expiry, centreStrike: strike });
  },

  stepStrike: (direction) => {
    const { strike, underlying } = get();
    if (strike === null) return;
    get().setStrike(strike + direction * UNDERLYINGS[underlying].strikeStep);
  },

  setAutoAtm: (autoAtm) => {
    const { adapter, underlying, expiry, snapshot, strike } = get();
    const nextStrike = autoAtm && snapshot ? snapshot.atmStrike : strike;
    set({ autoAtm, strike: nextStrike });
    adapter?.select({ underlying, expiry, centreStrike: autoAtm ? null : nextStrike });
  },

  snapToAtm: () => {
    const { snapshot, adapter, underlying, expiry } = get();
    if (!snapshot) return;
    set({ strike: snapshot.atmStrike, autoAtm: true });
    adapter?.select({ underlying, expiry, centreStrike: null });
  },

  // With sync on, the three panes are one instrument viewed three ways, so a
  // timeframe change applies to all of them.
  setOptionTimeframe: (tf) =>
    set((s) => (s.syncCharts ? { optionTimeframe: tf, spotTimeframe: tf } : { optionTimeframe: tf })),
  setSpotTimeframe: (tf) =>
    set((s) => (s.syncCharts ? { optionTimeframe: tf, spotTimeframe: tf } : { spotTimeframe: tf })),

  setLots: (leg, lots) => {
    const clamped = Math.max(1, Math.min(get().risk.maxLotsPerOrder, Math.round(lots)));
    set(leg === "CE" ? { callLots: clamped } : { putLots: clamped });
  },

  bumpLots: (leg, delta) => {
    const state = get();
    get().setLots(leg, (leg === "CE" ? state.callLots : state.putLots) + delta);
  },

  setAttachBracket: (attachBracket) => set({ attachBracket }),
  setSelectedPosition: (selectedPositionKey) => set({ selectedPositionKey }),

  // ------------------------------------------------------------ execution ---

  requestOrder: (leg, side) => {
    const state = get();
    const { adapter, snapshot, strike, expiry, underlying } = state;
    if (!adapter || !snapshot || strike === null || !expiry) return;

    const contract = adapter.contractFor(underlying, strike, leg, expiry);
    const quote = adapter.quoteFor(contract);
    if (!quote) {
      state.notify({ tone: "error", title: "No quote", message: `${contract.symbol} is not quoting.` });
      return;
    }

    const lots = leg === "CE" ? state.callLots : state.putLots;
    const quantity = lots * contract.lotSize;
    const preview = simulateFill(side, quote, state.execution);
    const levels = state.attachBracket
      ? defaultLevels(side, preview.fillPrice, state.risk)
      : { stopLoss: null as number | null, target: null as number | null };

    const intent: OrderIntent = {
      contract,
      side,
      lots,
      entryPrice: preview.fillPrice,
      stopLoss: levels.stopLoss,
      isExit: false,
    };

    // Register the attempt before evaluating: a burst that trips the cooldown
    // has to count the order that tripped it.
    const now = Date.now();
    const guard = registerAttempt(state.guard, now, state.risk);
    set({ guard });

    const violations = evaluateOrder(intent, {
      now,
      settings: state.risk,
      killSwitch: state.killSwitch,
      marketOpen: snapshot.phase === "OPEN",
      quoteAgeMs: now - state.lastTickAt,
      spreadPct: preview.spreadPct,
      dayPnl: dayPnl(state.portfolio),
      openLots: countOpenLots(state.portfolio),
      guard,
      position: state.portfolio.positions[contract.symbol] ?? null,
    });

    const blockers = blocking(violations);
    if (blockers.length > 0) {
      state.recordRejection(intent, blockers[0].message);
      state.notify({ tone: "error", title: "Order blocked", message: blockers[0].message });
      return;
    }

    const confirm: PendingConfirm = {
      intent,
      warnings: warnings(violations),
      quantity,
      estimatedValue: preview.fillPrice * quantity,
      target: levels.target,
    };

    // Instant mode skips the dialog for buys. Selling an option carries
    // open-ended risk, so `confirmBeforeSell` is honoured either way — that is
    // the one guard instant mode does not get to switch off.
    const mustConfirm = !state.instantOrder || (side === "SELL" && state.risk.confirmBeforeSell);
    if (mustConfirm) {
      set({ pendingConfirm: confirm });
      return;
    }
    state.execute(confirm);
  },

  confirmPending: () => {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: null });
    get().execute(pending);
  },

  cancelPending: () => set({ pendingConfirm: null }),

  exitPosition: (key, reason = "MANUAL") => {
    const state = get();
    const position = state.portfolio.positions[key];
    const adapter = state.adapter;
    if (!position || !adapter) return;
    const quote = adapter.quoteFor(position.contract);
    if (!quote) return;

    const side: Side = position.quantity > 0 ? "SELL" : "BUY";
    const quantity = Math.abs(position.quantity);
    const preview = simulateFill(side, quote, state.execution);

    state.execute(
      {
        intent: {
          contract: position.contract,
          side,
          lots: quantity / position.contract.lotSize,
          entryPrice: preview.fillPrice,
          stopLoss: null,
          isExit: true,
        },
        warnings: [],
        quantity,
        estimatedValue: preview.fillPrice * quantity,
        target: null,
      },
      reason
    );
  },

  exitAll: (reason = "EXIT_ALL") => {
    const keys = Object.keys(get().portfolio.positions);
    if (keys.length === 0) {
      get().notify({ tone: "info", title: "Nothing to exit", message: "No open positions." });
      return;
    }
    for (const key of keys) get().exitPosition(key, reason);
  },

  engageKillSwitch: () => {
    set({ killSwitch: true });
    const open = Object.keys(get().portfolio.positions).length;
    if (open > 0) get().exitAll("KILL_SWITCH");
    get().notify({
      tone: "error",
      title: "Kill switch engaged",
      message: open > 0 ? `${open} position(s) closed. Order entry blocked.` : "Order entry blocked.",
    });
  },

  resetKillSwitch: () => {
    set({ killSwitch: false });
    get().notify({ tone: "info", title: "Kill switch reset", message: "Order entry re-enabled." });
  },

  // ---------------------------------------------------------------- ui ---

  setSync: (syncCharts) =>
    set((s) => {
      if (!syncCharts) return { syncCharts };
      // Collapse onto the spot timeframe, clamped to one the option legs can
      // actually render — a 15m option scalping chart is not useful.
      const shared = SYNC_TIMEFRAMES.includes(s.spotTimeframe) ? s.spotTimeframe : DEFAULT_OPTION_TIMEFRAME;
      return { syncCharts, spotTimeframe: shared, optionTimeframe: shared };
    }),
  setInstantOrder: (instantOrder) => set({ instantOrder }),
  toggleVolumeProfile: () => set((s) => ({ showVolumeProfile: !s.showVolumeProfile })),
  toggleIndicators: () => set((s) => ({ showIndicators: !s.showIndicators })),
  toggleLevels: () => set((s) => ({ showLevels: !s.showLevels })),
  setJournalOpen: (journalOpen) => set({ journalOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  updateRisk: (patch) => set((s) => ({ risk: { ...s.risk, ...patch } })),
  updateExecution: (patch) => set((s) => ({ execution: { ...s.execution, ...patch } })),
  updateCosts: (patch) => set((s) => ({ costs: { ...s.costs, ...patch } })),

  resetSession: () =>
    set({
      portfolio: emptyPortfolio(),
      orders: [],
      fills: [],
      guard: emptyGuard(),
      killSwitch: false,
      selectedPositionKey: null,
      pendingConfirm: null,
    }),

  notify: (notice) => {
    noticeSeq += 1;
    const entry: Notice = { ...notice, id: `n${noticeSeq}`, ts: Date.now() };
    set((s) => ({ notices: [...s.notices, entry].slice(-4) }));
    if (typeof window !== "undefined") {
      window.setTimeout(() => get().dismissNotice(entry.id), notice.tone === "error" ? 6000 : 3500);
    }
  },

  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  // ------------------------------------------------------------ internal ---

  execute: (pending, reason = "MANUAL") => {
    const state = get();
    const { adapter, execution, costs } = state;
    const { intent, quantity } = pending;
    if (!adapter) return;
    const quote = adapter.quoteFor(intent.contract);
    if (!quote) return;

    const math = simulateFill(intent.side, quote, execution);
    const charges = computeCharges(intent.side, math.fillPrice, quantity, costs);
    const now = Date.now();

    const fill: Fill = {
      id: `f${now}-${state.fills.length}`,
      ts: now,
      contract: intent.contract,
      side: intent.side,
      quantity,
      referencePrice: math.referencePrice,
      fillPrice: math.fillPrice,
      slippage: Math.round(math.slippage * 100) / 100,
      charges,
    };

    const order: Order = {
      id: `o${now}-${state.orders.length}`,
      clientOrderId: `${intent.contract.symbol}-${intent.side}-${now}`,
      ts: now,
      contract: intent.contract,
      side: intent.side,
      lots: intent.lots,
      quantity,
      status: "FILLED",
      fill,
    };

    const portfolio = applyFill({
      state: state.portfolio,
      contract: intent.contract,
      side: intent.side,
      quantity,
      fillPrice: math.fillPrice,
      charges,
      ts: now,
      stopLoss: intent.isExit ? null : intent.stopLoss,
      target: intent.isExit ? null : pending.target,
      exitReason: intent.isExit ? reason : undefined,
    });

    const stillOpen = Boolean(portfolio.positions[intent.contract.symbol]);
    set({
      portfolio,
      orders: [order, ...state.orders].slice(0, 300),
      fills: [fill, ...state.fills].slice(0, 300),
      guard: registerAccepted(state.guard, intent.contract.symbol, intent.side, now),
      selectedPositionKey: stillOpen
        ? intent.contract.symbol
        : state.selectedPositionKey === intent.contract.symbol
          ? null
          : state.selectedPositionKey,
    });

    const verb = intent.isExit ? "Exited" : intent.side === "BUY" ? "Bought" : "Sold";
    state.notify({
      tone: intent.isExit ? "info" : intent.side === "BUY" ? "success" : "warn",
      title: `${verb} ${intent.lots} lot${intent.lots > 1 ? "s" : ""} · ${intent.contract.strike} ${intent.contract.optionType}`,
      message: `Fill ₹${math.fillPrice.toFixed(2)} · slippage ₹${math.slippage.toFixed(2)} · charges ₹${charges.total.toFixed(2)}`,
    });

    // A closing fill can breach the daily cap; check once, right here.
    const after = get();
    if (dayPnl(after.portfolio) <= -after.risk.maxDailyLoss && !after.killSwitch) {
      set({ killSwitch: true });
      after.notify({
        tone: "error",
        title: "Daily loss limit hit",
        message: "Order entry is locked. Reset the kill switch to continue.",
      });
    }
  },

  recordRejection: (intent, reason) => {
    const now = Date.now();
    set((s) => ({
      orders: [
        {
          id: `o${now}-${s.orders.length}`,
          clientOrderId: `${intent.contract.symbol}-${intent.side}-${now}`,
          ts: now,
          contract: intent.contract,
          side: intent.side,
          lots: intent.lots,
          quantity: intent.lots * intent.contract.lotSize,
          status: "REJECTED" as const,
          rejectReason: reason,
        },
        ...s.orders,
      ].slice(0, 300),
    }));
  },

  runAutoExits: () => {
    const state = get();
    const hits = triggeredExits(state.portfolio);
    if (hits.length === 0) return;
    for (const hit of hits) state.exitPosition(hit.position.key, hit.reason);
    state.notify({
      tone: hits[0].reason === "TARGET" ? "success" : "warn",
      title: hits[0].reason === "TARGET" ? "Target hit" : "Stop-loss hit",
      message: hits
        .map((h) => `${h.position.contract.strike} ${h.position.contract.optionType}`)
        .join(", "),
    });
  },
}));

// ---------------------------------------------------------------- helpers ---

/** Re-mark every open position from the newest chain. */
function markPositions(portfolio: PortfolioState, adapter: MarketDataAdapter): PortfolioState {
  const keys = Object.keys(portfolio.positions);
  if (keys.length === 0) return portfolio;

  let changed = false;
  const positions: Record<string, Position> = {};
  for (const key of keys) {
    const position = portfolio.positions[key];
    const quote = adapter.quoteFor(position.contract);
    if (!quote) {
      positions[key] = position;
      continue;
    }
    const mark = markPrice(quote, position.quantity);
    if (mark !== position.lastPrice) changed = true;
    positions[key] = { ...position, lastPrice: mark };
  }
  return changed ? { ...portfolio, positions } : portfolio;
}

/** Realised plus unrealised for the day — the number the loss cap watches. */
export function dayPnl(portfolio: PortfolioState): number {
  return Math.round((portfolio.realizedPnl + totalUnrealized(portfolio)) * 100) / 100;
}
