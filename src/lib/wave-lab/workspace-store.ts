"use client";

/**
 * Workspace state: layout, and one independent terminal config each. §1, §3.
 *
 * Persisted to localStorage so returning to the app returns to the chart you
 * left. Only settings live here — never candles. Bars are server-cached and
 * refetched; putting a year of them in localStorage would blow the quota and
 * serve stale prices from a store with no freshness rules.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Interval } from "./types";

export type SeriesStyle = "candles" | "heikin-ashi" | "line" | "area";
export type TerminalId = "A" | "B";

export interface TerminalConfig {
  symbol: string;
  interval: Interval;
  style: SeriesStyle;
  /** Genuinely matters for multi-year counts, so it is per-terminal (§3). */
  logScale: boolean;
  showVolume: boolean;
}

interface WorkspaceState {
  layout: 1 | 2;
  /** B follows A's symbol — the weekly-next-to-daily workflow (§3). */
  linked: boolean;
  active: TerminalId;
  terminals: Record<TerminalId, TerminalConfig>;

  setLayout: (layout: 1 | 2) => void;
  setLinked: (linked: boolean) => void;
  setActive: (id: TerminalId) => void;
  patch: (id: TerminalId, patch: Partial<TerminalConfig>) => void;
  setSymbol: (id: TerminalId, symbol: string) => void;
}

const DEFAULT_A: TerminalConfig = {
  symbol: "NSE:NIFTY 50",
  interval: "1D",
  style: "candles",
  logScale: false,
  showVolume: true,
};

// B defaults one degree up, because that is the pairing an Elliott analyst
// actually wants on opening the app: the higher degree beside the working one.
const DEFAULT_B: TerminalConfig = { ...DEFAULT_A, interval: "1W" };

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      // Two by default: Elliott is a multi-timeframe discipline (§3).
      layout: 2,
      linked: true,
      active: "A",
      terminals: { A: { ...DEFAULT_A }, B: { ...DEFAULT_B } },

      setLayout: (layout) => set({ layout }),
      setLinked: (linked) => set({ linked }),
      setActive: (active) => set({ active }),

      patch: (id, patch) =>
        set((s) => ({ terminals: { ...s.terminals, [id]: { ...s.terminals[id], ...patch } } })),

      /**
       * Changing A's symbol carries B along while linked — the whole point of
       * the toggle is one search instead of two. B keeps its own interval, so
       * the higher-degree pairing survives the change.
       */
      setSymbol: (id, symbol) =>
        set((s) => {
          const terminals = { ...s.terminals, [id]: { ...s.terminals[id], symbol } };
          if (s.linked && id === "A") {
            terminals.B = { ...terminals.B, symbol };
          }
          return { terminals };
        }),
    }),
    {
      name: "wave-lab.workspace",
      version: 1,
    }
  )
);
