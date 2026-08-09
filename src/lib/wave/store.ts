"use client";

/**
 * Wave Lab state.
 *
 * Two terminals, each owning its own symbol, interval, indicators and wave
 * count; a small amount of shared workspace state (sync, layout, panels); and
 * the data loader. Drawings are the only thing here that a user can lose, so
 * they are persisted to localStorage on every change and restored on mount.
 *
 * Deliberately not in React state: nothing in this store re-renders per mouse
 * move. Point placement commits whole points, and the chart overlay reads
 * coordinates imperatively.
 */

import { create } from "zustand";

import type { Interval, MarketCandle, ProviderInfo } from "@/lib/market/types";
import { INTERVALS } from "@/lib/market/types";
import { DEFAULT_DEGREE, type DegreeKey } from "./degrees";
import { TOOLS, defaultVariant, type ToolId } from "./patterns";
import { parseAnalysis } from "./serialize";
import {
  DEFAULT_INDICATORS,
  newId,
  type ChartType,
  type Drawing,
  type IndicatorSettings,
  type PriceScaleKind,
  type TerminalData,
  type TerminalState,
  type WavePoint,
} from "./types";

const STORAGE_KEY = "indiacharts.wave-lab.v1";
const LIVE_POLL_MS = 15_000;

export type LayoutMode = "columns" | "rows";

export interface Notice {
  id: string;
  tone: "info" | "error" | "success";
  message: string;
}

interface WaveStore {
  terminals: TerminalState[];
  data: Record<string, TerminalData>;
  drafts: Record<string, Drawing | null>;
  layout: LayoutMode;
  syncCharts: boolean;
  livePolling: boolean;
  focusedTerminal: string;
  inspectorOpen: boolean;
  exportOpen: boolean;
  notices: Notice[];
  hydrated: boolean;

  hydrate: () => void;
  loadTerminal: (id: string) => Promise<void>;
  loadAll: () => Promise<void>;
  pollQuotes: () => Promise<void>;

  setSymbol: (id: string, symbol: string, title: string, instrumentToken?: number) => void;
  setInterval: (id: string, interval: Interval) => void;
  setChartType: (id: string, chartType: ChartType) => void;
  setScale: (id: string, scale: PriceScaleKind) => void;
  setIndicators: (id: string, update: Partial<IndicatorSettings>) => void;
  setActiveTool: (id: string, tool: ToolId) => void;
  setDegree: (id: string, degree: DegreeKey) => void;
  setVariant: (id: string, variant: string) => void;
  toggleMagnet: (id: string) => void;
  toggleLabels: (id: string) => void;

  placePoint: (id: string, point: WavePoint) => void;
  cancelDraft: (id: string) => void;
  movePoint: (id: string, drawingId: string, pointIndex: number, point: WavePoint) => void;
  selectDrawing: (id: string, drawingId: string | null) => void;
  updateDrawing: (id: string, drawingId: string, patch: Partial<Drawing>) => void;
  deleteDrawing: (id: string, drawingId: string) => void;
  clearDrawings: (id: string) => void;
  importDrawings: (id: string, json: string, mode: "replace" | "append") => void;

  setLayout: (layout: LayoutMode) => void;
  toggleSync: () => void;
  toggleLivePolling: () => void;
  setFocused: (id: string) => void;
  setInspectorOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  notify: (tone: Notice["tone"], message: string) => void;
  dismissNotice: (noticeId: string) => void;
}

function makeTerminal(
  id: string,
  symbol: string,
  title: string,
  interval: Interval,
  instrumentToken?: number
): TerminalState {
  return {
    id,
    symbol,
    title,
    instrumentToken,
    interval,
    chartType: "candles",
    // Log scale by default: Elliott proportion is a ratio argument, and on a
    // linear axis a 1.618 extension drawn over years is simply the wrong shape.
    scale: "log",
    indicators: structuredCloneish(DEFAULT_INDICATORS),
    drawings: [],
    selectedId: null,
    activeTool: "cursor",
    degree: DEFAULT_DEGREE,
    variant: undefined,
    magnet: true,
    showLabels: true,
    showRules: true,
  };
}

/**
 * Two panes, pre-loaded with the pairing a wave analyst actually opens: the
 * higher degree on the left to fix the context, the trading timeframe on the
 * right. Multi-timeframe confirmation is Phase 6 of the SOP, and this is the
 * layout that makes it a glance rather than a task.
 */
const INITIAL_TERMINALS: TerminalState[] = [
  makeTerminal("A", "NSE:NIFTY 50", "NIFTY 50", "day", 256265),
  makeTerminal("B", "NSE:NIFTY 50", "NIFTY 50", "60minute", 256265),
];

const EMPTY_DATA: TerminalData = {
  candles: [],
  provider: null,
  loading: false,
  error: null,
  loadedAt: null,
};

export const useWaveStore = create<WaveStore>((set, get) => ({
  terminals: INITIAL_TERMINALS,
  data: { A: { ...EMPTY_DATA }, B: { ...EMPTY_DATA } },
  drafts: { A: null, B: null },
  layout: "columns",
  syncCharts: false,
  livePolling: true,
  focusedTerminal: "A",
  inspectorOpen: true,
  exportOpen: false,
  notices: [],
  hydrated: false,

  // ------------------------------------------------------------ lifecycle ---

  hydrate: () => {
    if (get().hydrated) return;
    const restored = readStorage();
    set((state) => ({
      hydrated: true,
      terminals: restored?.terminals ?? state.terminals,
      layout: restored?.layout ?? state.layout,
      syncCharts: restored?.syncCharts ?? state.syncCharts,
    }));
    void get().loadAll();
  },

  loadTerminal: async (id: string) => {
    const terminal = get().terminals.find((entry) => entry.id === id);
    if (!terminal) return;

    set((state) => ({
      data: { ...state.data, [id]: { ...(state.data[id] ?? EMPTY_DATA), loading: true, error: null } },
    }));

    const params = new URLSearchParams({
      symbol: terminal.symbol,
      interval: terminal.interval,
      days: String(INTERVALS[terminal.interval].defaultDays),
    });
    if (terminal.instrumentToken) params.set("token", String(terminal.instrumentToken));

    try {
      const response = await fetch(`/api/market/candles?${params.toString()}`);
      const payload = (await response.json()) as {
        candles?: MarketCandle[];
        provider?: ProviderInfo;
        warning?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);

      set((state) => ({
        data: {
          ...state.data,
          [id]: {
            candles: payload.candles ?? [],
            provider: payload.provider ?? null,
            warning: payload.warning,
            loading: false,
            error: null,
            loadedAt: Date.now(),
          },
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        data: {
          ...state.data,
          [id]: { ...(state.data[id] ?? EMPTY_DATA), loading: false, error: message },
        },
      }));
    }
  },

  loadAll: async () => {
    await Promise.all(get().terminals.map((terminal) => get().loadTerminal(terminal.id)));
  },

  /**
   * Live tail. Rather than reloading the whole history every few seconds, the
   * last bar is extended with the current LTP — the same thing a broker feed
   * would do to the forming candle.
   */
  pollQuotes: async () => {
    const { terminals, data, livePolling } = get();
    if (!livePolling) return;

    const symbols = Array.from(new Set(terminals.map((terminal) => terminal.symbol)));
    if (symbols.length === 0) return;

    try {
      const response = await fetch(`/api/market/quote?symbols=${encodeURIComponent(symbols.join(","))}`);
      if (!response.ok) return;
      const payload = (await response.json()) as { quotes?: { key: string; last: number }[] };
      const byKey = new Map((payload.quotes ?? []).map((quote) => [quote.key, quote.last]));

      const next: Record<string, TerminalData> = { ...data };
      let changed = false;

      for (const terminal of terminals) {
        const last = byKey.get(terminal.symbol);
        const entry = next[terminal.id];
        if (last === undefined || !entry || entry.candles.length === 0) continue;

        const bars = entry.candles;
        const tail = bars[bars.length - 1];
        if (tail.close === last) continue;

        const updated: MarketCandle = {
          ...tail,
          close: last,
          high: Math.max(tail.high, last),
          low: Math.min(tail.low, last),
        };
        next[terminal.id] = { ...entry, candles: [...bars.slice(0, -1), updated] };
        changed = true;
      }

      if (changed) set({ data: next });
    } catch {
      // A failed poll is not worth a notice — the next one is 15 seconds away.
    }
  },

  // ------------------------------------------------------------- terminal ---

  setSymbol: (id, symbol, title, instrumentToken) => {
    patchTerminal(set, id, () => ({ symbol, title, instrumentToken, selectedId: null }));
    void get().loadTerminal(id);
    persist(get());
  },

  setInterval: (id, interval) => {
    patchTerminal(set, id, () => ({ interval }));
    void get().loadTerminal(id);
    persist(get());
  },

  setChartType: (id, chartType) => {
    patchTerminal(set, id, () => ({ chartType }));
    persist(get());
  },

  setScale: (id, scale) => {
    patchTerminal(set, id, () => ({ scale }));
    persist(get());
  },

  setIndicators: (id, update) => {
    patchTerminal(set, id, (terminal) => ({ indicators: { ...terminal.indicators, ...update } }));
    persist(get());
  },

  setActiveTool: (id, tool) => {
    set((state) => ({ drafts: { ...state.drafts, [id]: null } }));
    patchTerminal(set, id, (terminal) => ({
      activeTool: tool,
      variant: TOOLS[tool].elliott ? (terminal.variant ?? defaultVariant(tool)) : undefined,
      selectedId: tool === "cursor" ? terminal.selectedId : null,
    }));
  },

  setDegree: (id, degree) => {
    patchTerminal(set, id, (terminal) => {
      // Retagging the selected drawing is what an analyst means by changing
      // degree while something is selected; otherwise it sets the next default.
      if (!terminal.selectedId) return { degree };
      return {
        degree,
        drawings: terminal.drawings.map((drawing) =>
          drawing.id === terminal.selectedId ? { ...drawing, degree, updatedAt: Date.now() } : drawing
        ),
      };
    });
    persist(get());
  },

  setVariant: (id, variant) => {
    patchTerminal(set, id, (terminal) => ({
      variant,
      drawings: terminal.selectedId
        ? terminal.drawings.map((drawing) =>
            drawing.id === terminal.selectedId ? { ...drawing, variant, updatedAt: Date.now() } : drawing
          )
        : terminal.drawings,
    }));
    persist(get());
  },

  toggleMagnet: (id) => {
    patchTerminal(set, id, (terminal) => ({ magnet: !terminal.magnet }));
    persist(get());
  },

  toggleLabels: (id) => {
    patchTerminal(set, id, (terminal) => ({ showLabels: !terminal.showLabels }));
    persist(get());
  },

  // ------------------------------------------------------------- drawings ---

  placePoint: (id, point) => {
    const terminal = get().terminals.find((entry) => entry.id === id);
    if (!terminal || terminal.activeTool === "cursor") return;

    const spec = TOOLS[terminal.activeTool];
    const draft = get().drafts[id];
    const now = Date.now();

    const next: Drawing = draft
      ? { ...draft, points: [...draft.points, point], updatedAt: now }
      : {
          id: newId("wd"),
          tool: terminal.activeTool,
          degree: terminal.degree,
          variant: terminal.variant ?? defaultVariant(terminal.activeTool),
          points: [point],
          createdAt: now,
          updatedAt: now,
        };

    if (next.points.length >= spec.points) {
      set((state) => ({
        drafts: { ...state.drafts, [id]: null },
        terminals: state.terminals.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                drawings: [...entry.drawings, next],
                selectedId: next.id,
                // Drop back to the cursor so the next click selects rather than
                // starting a second pattern by accident.
                activeTool: "cursor",
              }
            : entry
        ),
      }));
      persist(get());
    } else {
      set((state) => ({ drafts: { ...state.drafts, [id]: next } }));
    }
  },

  cancelDraft: (id) => {
    set((state) => ({ drafts: { ...state.drafts, [id]: null } }));
    patchTerminal(set, id, () => ({ activeTool: "cursor" }));
  },

  movePoint: (id, drawingId, pointIndex, point) => {
    patchTerminal(set, id, (terminal) => ({
      drawings: terminal.drawings.map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              points: drawing.points.map((existing, i) => (i === pointIndex ? point : existing)),
              updatedAt: Date.now(),
            }
          : drawing
      ),
    }));
    persist(get());
  },

  selectDrawing: (id, drawingId) => {
    patchTerminal(set, id, (terminal) => {
      const selected = terminal.drawings.find((drawing) => drawing.id === drawingId);
      return {
        selectedId: drawingId,
        // Follow the selection so the degree and variant pickers show what the
        // selected drawing actually is, not what the last one was.
        degree: selected?.degree ?? terminal.degree,
        variant: selected?.variant ?? terminal.variant,
      };
    });
    set({ focusedTerminal: id });
  },

  updateDrawing: (id, drawingId, patch) => {
    patchTerminal(set, id, (terminal) => ({
      drawings: terminal.drawings.map((drawing) =>
        drawing.id === drawingId ? { ...drawing, ...patch, updatedAt: Date.now() } : drawing
      ),
    }));
    persist(get());
  },

  deleteDrawing: (id, drawingId) => {
    patchTerminal(set, id, (terminal) => ({
      drawings: terminal.drawings.filter((drawing) => drawing.id !== drawingId),
      selectedId: terminal.selectedId === drawingId ? null : terminal.selectedId,
    }));
    persist(get());
  },

  clearDrawings: (id) => {
    patchTerminal(set, id, () => ({ drawings: [], selectedId: null }));
    persist(get());
  },

  importDrawings: (id, json, mode) => {
    const result = parseAnalysis(json);
    if (!result.ok) {
      get().notify("error", `Import failed — ${result.errors.slice(0, 2).join(" ")}`);
      return;
    }

    // A bundle may carry two terminals; match by id when it does, otherwise
    // take the first block. Importing into the pane the user asked for beats
    // guessing at symbols that may have been renamed.
    const block =
      result.terminals.find((terminal) => terminal.id === id) ?? result.terminals[0];
    const incoming = block?.drawings ?? [];

    patchTerminal(set, id, (terminal) => ({
      drawings: mode === "replace" ? incoming : [...terminal.drawings, ...incoming],
      selectedId: incoming[0]?.id ?? null,
    }));
    persist(get());

    const warnings = result.warnings.length > 0 ? ` (${result.warnings.length} warning${result.warnings.length > 1 ? "s" : ""})` : "";
    get().notify("success", `Imported ${incoming.length} drawing${incoming.length === 1 ? "" : "s"}${warnings}`);
    for (const warning of result.warnings.slice(0, 3)) get().notify("info", warning);
  },

  // ------------------------------------------------------------ workspace ---

  setLayout: (layout) => {
    set({ layout });
    persist(get());
  },

  toggleSync: () => {
    set((state) => ({ syncCharts: !state.syncCharts }));
    persist(get());
  },

  toggleLivePolling: () => set((state) => ({ livePolling: !state.livePolling })),
  setFocused: (id) => set({ focusedTerminal: id }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  setExportOpen: (open) => set({ exportOpen: open }),

  notify: (tone, message) =>
    set((state) => ({
      notices: [...state.notices.slice(-4), { id: newId("n"), tone, message }],
    })),

  dismissNotice: (noticeId) =>
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== noticeId) })),
}));

export const LIVE_POLL_INTERVAL_MS = LIVE_POLL_MS;

// ----------------------------------------------------------------- helpers ---

type SetState = (partial: (state: WaveStore) => Partial<WaveStore>) => void;

function patchTerminal(
  set: SetState,
  id: string,
  patch: (terminal: TerminalState) => Partial<TerminalState>
): void {
  set((state) => ({
    terminals: state.terminals.map((terminal) =>
      terminal.id === id ? { ...terminal, ...patch(terminal) } : terminal
    ),
  }));
}

interface Persisted {
  version: 1;
  terminals: TerminalState[];
  layout: LayoutMode;
  syncCharts: boolean;
}

function persist(state: WaveStore): void {
  if (typeof window === "undefined") return;
  try {
    const payload: Persisted = {
      version: 1,
      // Drafts and transient selection are not worth restoring; everything else
      // is the analyst's work and must survive a reload.
      terminals: state.terminals.map((terminal) => ({ ...terminal, activeTool: "cursor" as ToolId })),
      layout: state.layout,
      syncCharts: state.syncCharts,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing or a full quota — losing persistence is not worth an error.
  }
}

function readStorage(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.version !== 1 || !Array.isArray(parsed.terminals) || parsed.terminals.length === 0) {
      return null;
    }
    // Merge over the defaults so a stored state from an older build still gets
    // any newly added fields.
    const terminals = parsed.terminals.slice(0, 2).map((stored, i) => ({
      ...INITIAL_TERMINALS[i] ?? INITIAL_TERMINALS[0],
      ...stored,
      indicators: { ...DEFAULT_INDICATORS, ...(stored.indicators ?? {}) },
      activeTool: "cursor" as ToolId,
      selectedId: null,
    }));
    return { ...parsed, terminals };
  } catch {
    return null;
  }
}

function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
