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

export interface TerminalIndicators {
  emas: EmaConfig[];
  bollinger: BollingerConfig;
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
  };
}

interface IndicatorState {
  byTerminal: Record<TerminalId, TerminalIndicators>;
  toggleEma: (t: TerminalId, id: string) => void;
  patchEma: (t: TerminalId, id: string, patch: Partial<EmaConfig>) => void;
  patchBollinger: (t: TerminalId, patch: Partial<BollingerConfig>) => void;
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

      reset: (t) =>
        set((s) => ({ byTerminal: { ...s.byTerminal, [t]: defaultIndicators() } })),
    }),
    { name: "wave-lab.indicators", version: 1 }
  )
);
