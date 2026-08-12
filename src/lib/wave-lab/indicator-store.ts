"use client";

/**
 * Per-terminal indicator settings. §7.
 *
 * Settings only — never computed values. The bands and averages are derived
 * from whatever candles the terminal currently holds, so caching them here
 * would just create a second copy to keep in sync with the symbol, the
 * interval and the provider.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalId } from "./workspace-store";

export interface EmaConfig {
  id: string;
  period: number;
  color: string;
  width: number;
  visible: boolean;
}

export interface BollingerConfig {
  visible: boolean;
  length: number;
  deviations: number;
  color: string;
  /** Shaded band between upper and lower. */
  fill: boolean;
  fillOpacity: number;
  width: number;
}

/**
 * RMI Scaled (Wilder's). Unlike the EMAs and Bollinger this is `overlay=false`
 * in the original Pine, so it gets its own pane below the price rather than
 * being drawn on it.
 */
export interface RmiConfig {
  visible: boolean;
  lookback: number;
  smoothLen: number;
  scaleFactor: number;
  signalType: "SMA" | "EMA";
  signalLen: number;
  rmiColor: string;
  signalColor: string;
  width: number;
  obLevel: number;
  osLevel: number;
  /** Shaded area between the RMI and its signal. */
  fill: boolean;
}

export interface TerminalIndicators {
  emas: EmaConfig[];
  bollinger: BollingerConfig;
  rmi: RmiConfig;
}

/** Distinct hues so four averages stay tellable apart on a dense chart. */
function defaultEmas(): EmaConfig[] {
  return [
    { id: "ema20", period: 20, color: "#387ed1", width: 1, visible: true },
    { id: "ema50", period: 50, color: "#f6a821", width: 1, visible: true },
    { id: "ema100", period: 100, color: "#9c56d4", width: 1, visible: false },
    { id: "ema200", period: 200, color: "#eb5b3c", width: 1.5, visible: false },
  ];
}

function defaultIndicators(): TerminalIndicators {
  return {
    emas: defaultEmas(),
    // §7's defaults: length 20, two standard deviations.
    bollinger: {
      visible: false,
      length: 20,
      deviations: 2,
      color: "#7a869a",
      fill: true,
      fillOpacity: 0.08,
      width: 1,
    },
    // Straight from the Pine study's own input defaults.
    rmi: {
      visible: false,
      lookback: 6,
      smoothLen: 11,
      scaleFactor: 4.5,
      signalType: "EMA",
      signalLen: 9,
      rmiColor: "#00b386",
      signalColor: "#eb5b3c",
      width: 2,
      obLevel: 6,
      osLevel: -6,
      fill: true,
    },
  };
}

interface IndicatorState {
  byTerminal: Record<TerminalId, TerminalIndicators>;
  toggleEma: (t: TerminalId, id: string) => void;
  patchEma: (t: TerminalId, id: string, patch: Partial<EmaConfig>) => void;
  patchBollinger: (t: TerminalId, patch: Partial<BollingerConfig>) => void;
  patchRmi: (t: TerminalId, patch: Partial<RmiConfig>) => void;
  reset: (t: TerminalId) => void;
}

export const useIndicators = create<IndicatorState>()(
  persist(
    (set) => ({
      byTerminal: { A: defaultIndicators(), B: defaultIndicators() },

      toggleEma: (t, id) =>
        set((s) => ({
          byTerminal: {
            ...s.byTerminal,
            [t]: {
              ...s.byTerminal[t],
              emas: s.byTerminal[t].emas.map((e) =>
                e.id === id ? { ...e, visible: !e.visible } : e
              ),
            },
          },
        })),

      patchEma: (t, id, patch) =>
        set((s) => ({
          byTerminal: {
            ...s.byTerminal,
            [t]: {
              ...s.byTerminal[t],
              emas: s.byTerminal[t].emas.map((e) => (e.id === id ? { ...e, ...patch } : e)),
            },
          },
        })),

      patchBollinger: (t, patch) =>
        set((s) => ({
          byTerminal: {
            ...s.byTerminal,
            [t]: { ...s.byTerminal[t], bollinger: { ...s.byTerminal[t].bollinger, ...patch } },
          },
        })),

      patchRmi: (t, patch) =>
        set((s) => ({
          byTerminal: {
            ...s.byTerminal,
            [t]: { ...s.byTerminal[t], rmi: { ...s.byTerminal[t].rmi, ...patch } },
          },
        })),

      reset: (t) =>
        set((s) => ({ byTerminal: { ...s.byTerminal, [t]: defaultIndicators() } })),
    }),
    {
      name: "wave-lab.indicators",
      // v2 adds the RMI block. Merged rather than migrated so a store saved
      // before it existed does not come back with `rmi` undefined and crash
      // every read of `config.rmi.visible`.
      version: 2,
      merge: (persisted, current) => {
        const saved = persisted as Partial<IndicatorState> | undefined;
        if (!saved?.byTerminal) return current;
        const base = defaultIndicators();
        return {
          ...current,
          byTerminal: {
            A: { ...base, ...saved.byTerminal.A, rmi: { ...base.rmi, ...saved.byTerminal.A?.rmi } },
            B: { ...base, ...saved.byTerminal.B, rmi: { ...base.rmi, ...saved.byTerminal.B?.rmi } },
          },
        };
      },
    }
  )
);
