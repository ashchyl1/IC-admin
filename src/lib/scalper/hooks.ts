"use client";

/**
 * React bindings for the scalper store.
 *
 * Anything that derives a value from the feed lives here rather than in the
 * store, because these results are per-render arrays and objects — putting them
 * in global state would mean allocating a new identity on every tick for every
 * subscriber, whether or not they use it.
 */

import * as React from "react";

import { MTF_TIMEFRAMES, SESSION, UNDERLYINGS } from "./config";
import {
  indicatorsFor,
  mtfCells,
  openingRange,
  previousDayRange,
  supportResistance,
  volumeProfile,
} from "./indicators";
import { defaultLevels, rewardAtTarget, riskAtStop, riskReward } from "./engine/risk";
import { simulateFill } from "./engine/execution";
import { estimateRoundTrip } from "./engine/charges";
import { dayPnl, useScalper } from "./store";
import { totalUnrealized } from "./engine/portfolio";
import type {
  Candle,
  IndicatorSeries,
  Level,
  Moneyness,
  MtfCell,
  OptionContract,
  OptionQuote,
  OptionType,
  Side,
  VolumeProfileBin,
} from "./types";

/** Connect the feed for as long as the workspace is mounted. */
export function useScalperEngine(): void {
  const boot = useScalper((s) => s.boot);
  const shutdown = useScalper((s) => s.shutdown);

  React.useEffect(() => {
    boot();
    return () => shutdown();
    // Boot/shutdown are stable store actions; this runs exactly once.
  }, [boot, shutdown]);
}

/** The contract one leg of the pad points at. Stable across ticks. */
export function useLegContract(leg: OptionType): OptionContract | null {
  const adapter = useScalper((s) => s.adapter);
  const underlying = useScalper((s) => s.underlying);
  const strike = useScalper((s) => s.strike);
  const expiry = useScalper((s) => s.expiry);

  return React.useMemo(() => {
    if (!adapter || strike === null || !expiry) return null;
    try {
      return adapter.contractFor(underlying, strike, leg, expiry);
    } catch {
      return null;
    }
  }, [adapter, underlying, strike, expiry, leg]);
}

/** Live quote for a leg, taken from the published chain so it matches the table. */
export function useLegQuote(leg: OptionType): OptionQuote | null {
  const snapshot = useScalper((s) => s.snapshot);
  const strike = useScalper((s) => s.strike);
  if (!snapshot || strike === null) return null;
  const row = snapshot.chain.find((r) => r.strike === strike);
  if (!row) return null;
  return leg === "CE" ? row.call : row.put;
}

export interface ChartData {
  candles: Candle[];
  indicators: IndicatorSeries;
  levels: Level[];
  profile: VolumeProfileBin[];
}

const EMPTY_INDICATORS: IndicatorSeries = { ema9: [], ema20: [], vwap: [] };

/** Candles plus every overlay for the centre index chart. */
export function useSpotChart(): ChartData {
  const adapter = useScalper((s) => s.adapter);
  const snapshot = useScalper((s) => s.snapshot);
  const underlying = useScalper((s) => s.underlying);
  const timeframe = useScalper((s) => s.spotTimeframe);
  const showLevels = useScalper((s) => s.showLevels);
  const showProfile = useScalper((s) => s.showVolumeProfile);

  return React.useMemo(() => {
    if (!adapter || !snapshot) {
      return { candles: [], indicators: EMPTY_INDICATORS, levels: [], profile: [] };
    }
    const candles = adapter.spotCandles(underlying, timeframe);
    const sessionOpen = adapter.sessionOpenSeconds(underlying);

    const levels: Level[] = [];
    if (showLevels) {
      const prev = previousDayRange(candles);
      if (prev) {
        levels.push({ price: prev.high, label: "PDH", kind: "prevDay" });
        levels.push({ price: prev.low, label: "PDL", kind: "prevDay" });
      }
      const orb = openingRange(candles, sessionOpen);
      if (orb) {
        levels.push({ price: orb.high, label: `ORH ${SESSION.openingRangeMinutes}m`, kind: "openingRange" });
        levels.push({ price: orb.low, label: `ORL ${SESSION.openingRangeMinutes}m`, kind: "openingRange" });
      }
      levels.push(...supportResistance(candles));
    }

    return {
      candles,
      indicators: indicatorsFor(candles),
      levels,
      profile: showProfile ? volumeProfile(sessionCandles(candles, sessionOpen)) : [],
    };
    // `snapshot` is the tick signal — every field below is read fresh from it.
  }, [adapter, snapshot, underlying, timeframe, showLevels, showProfile]);
}

/** Candles plus indicators for one option leg. */
export function useOptionChart(contract: OptionContract | null): ChartData {
  const adapter = useScalper((s) => s.adapter);
  const snapshot = useScalper((s) => s.snapshot);
  const timeframe = useScalper((s) => s.optionTimeframe);

  return React.useMemo(() => {
    if (!adapter || !snapshot || !contract) {
      return { candles: [], indicators: EMPTY_INDICATORS, levels: [], profile: [] };
    }
    const candles = adapter.optionCandles(contract, timeframe);
    return { candles, indicators: indicatorsFor(candles), levels: [], profile: [] };
  }, [adapter, snapshot, contract, timeframe]);
}

/** The 5m / 15m / 1h / 1D traffic lights. */
export function useMtf(): MtfCell[] {
  const adapter = useScalper((s) => s.adapter);
  const snapshot = useScalper((s) => s.snapshot);
  const underlying = useScalper((s) => s.underlying);

  return React.useMemo(() => {
    if (!adapter || !snapshot) return [];
    // The 1D cell needs daily bars, which the adapter builds separately from
    // the intraday series, so it cannot go through the 1m aggregation path.
    const intraday = adapter.spotCandles(underlying, "1m");
    const sessionOpen = adapter.sessionOpenSeconds(underlying);
    const cells = mtfCells(
      intraday,
      sessionOpen,
      MTF_TIMEFRAMES.filter((tf) => tf !== "1d")
    );
    const dailyCells = mtfCells(adapter.spotCandles(underlying, "1d"), sessionOpen, ["1d"]);
    return [...cells, ...dailyCells];
  }, [adapter, snapshot, underlying]);
}

export interface OrderPreview {
  contract: OptionContract;
  quote: OptionQuote;
  lots: number;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  estimatedValue: number;
  roundTripCharges: number;
  stopLoss: number;
  target: number;
  risk: number | null;
  reward: number | null;
  rr: number | null;
  spreadPct: number;
  moneyness: Moneyness;
}

/** Everything an order card shows, computed once per tick per leg. */
export function useOrderPreview(leg: OptionType): OrderPreview | null {
  const contract = useLegContract(leg);
  const quote = useLegQuote(leg);
  const snapshot = useScalper((s) => s.snapshot);
  const lots = useScalper((s) => (leg === "CE" ? s.callLots : s.putLots));
  const execution = useScalper((s) => s.execution);
  const risk = useScalper((s) => s.risk);
  const costs = useScalper((s) => s.costs);

  return React.useMemo(() => {
    if (!contract || !quote || !snapshot) return null;

    const quantity = lots * contract.lotSize;
    const buy = simulateFill("BUY", quote, execution);
    const sell = simulateFill("SELL", quote, execution);
    const levels = defaultLevels("BUY", buy.fillPrice, risk);

    const riskAmount = riskAtStop({
      contract,
      side: "BUY",
      lots,
      entryPrice: buy.fillPrice,
      stopLoss: levels.stopLoss,
      isExit: false,
    });
    const reward = rewardAtTarget("BUY", buy.fillPrice, levels.target, quantity);

    return {
      contract,
      quote,
      lots,
      quantity,
      buyPrice: buy.fillPrice,
      sellPrice: sell.fillPrice,
      estimatedValue: buy.fillPrice * quantity,
      roundTripCharges: estimateRoundTrip(buy.fillPrice, quantity, costs),
      stopLoss: levels.stopLoss,
      target: levels.target,
      risk: riskAmount,
      reward,
      rr: riskReward(riskAmount, reward),
      spreadPct: buy.spreadPct,
      moneyness: moneynessOf(contract, snapshot.spot.ltp),
    };
  }, [contract, quote, snapshot, lots, execution, risk, costs]);
}

export function moneynessOf(contract: OptionContract, spot: number): Moneyness {
  const step = UNDERLYINGS[contract.underlying].strikeStep;
  if (Math.abs(contract.strike - spot) <= step / 2) return "ATM";
  if (contract.optionType === "CE") return spot > contract.strike ? "ITM" : "OTM";
  return spot < contract.strike ? "ITM" : "OTM";
}

/** Aggregate P&L figures for the header and the risk card. */
export function usePnl() {
  const portfolio = useScalper((s) => s.portfolio);
  return React.useMemo(
    () => ({
      realized: portfolio.realizedPnl,
      unrealized: totalUnrealized(portfolio),
      day: dayPnl(portfolio),
      charges: portfolio.totalCharges,
      gross: portfolio.grossRealizedPnl,
    }),
    [portfolio]
  );
}

/**
 * Keyboard shortcuts.
 *
 * Deliberately not active while the user is typing — a lot-count field and a
 * "Buy Call" key would otherwise share the Up arrow.
 */
export function useScalperShortcuts(): void {
  const requestOrder = useScalper((s) => s.requestOrder);
  const exitAll = useScalper((s) => s.exitAll);
  const cancelPending = useScalper((s) => s.cancelPending);
  const setJournalOpen = useScalper((s) => s.setJournalOpen);
  const setSettingsOpen = useScalper((s) => s.setSettingsOpen);
  const setShortcutsOpen = useScalper((s) => s.setShortcutsOpen);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.key === "Escape") {
        cancelPending();
        setJournalOpen(false);
        setSettingsOpen(false);
        setShortcutsOpen(false);
        return;
      }

      if (event.shiftKey && (event.key === "X" || event.key === "x")) {
        event.preventDefault();
        exitAll("EXIT_ALL");
        return;
      }

      // Modifier chords belong to the browser, not the pad.
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

      switch (arrowKey(event)) {
        case "up":
          event.preventDefault();
          requestOrder("CE", "BUY");
          break;
        case "left":
          event.preventDefault();
          requestOrder("CE", "SELL");
          break;
        case "down":
          event.preventDefault();
          requestOrder("PE", "BUY");
          break;
        case "right":
          event.preventDefault();
          requestOrder("PE", "SELL");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestOrder, exitAll, cancelPending, setJournalOpen, setSettingsOpen, setShortcutsOpen]);
}

/**
 * Normalise an arrow key.
 *
 * `KeyboardEvent.key` is "ArrowUp" in every current browser, but the legacy
 * "Up" spelling still turns up from older engines and from automation drivers.
 * Matching both costs nothing and avoids a pad that silently ignores keys.
 */
function arrowKey(event: KeyboardEvent): "up" | "down" | "left" | "right" | null {
  switch (event.key) {
    case "ArrowUp":
    case "Up":
      return "up";
    case "ArrowDown":
    case "Down":
      return "down";
    case "ArrowLeft":
    case "Left":
      return "left";
    case "ArrowRight":
    case "Right":
      return "right";
    default:
      return null;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("role") === "textbox"
  );
}

/**
 * True only after the first client render.
 *
 * Almost everything on this screen is derived from the clock — the market
 * phase, the IST time, the whole mock session — so server markup can never
 * match the client's. Rather than sprinkling `suppressHydrationWarning`
 * around, the workspace renders one fixed shell until this flips.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

/** A ticking wall clock, for the header. Independent of the feed. */
export function useWallClock(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Candles belonging to the current session only. */
function sessionCandles(candles: Candle[], sessionOpenSeconds: number): Candle[] {
  const filtered = candles.filter((c) => c.time >= sessionOpenSeconds);
  return filtered.length > 0 ? filtered : candles.slice(-120);
}

export type { Side };
