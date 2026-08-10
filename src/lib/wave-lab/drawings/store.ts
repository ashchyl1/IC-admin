"use client";

/**
 * Drawings, per terminal, with undo/redo. §4.3.
 *
 * History holds whole snapshots of the drawings array rather than a diff log.
 * A count is at most a few dozen small objects, so the memory is irrelevant and
 * the correctness is free — an inverse-operation log has to get drag, degree
 * change, variant change and delete all exactly right, and any one of them
 * being subtly wrong corrupts the count on undo.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  TOOL_SPECS,
  type Drawing,
  type DrawingStyle,
  type Pivot,
  type ToolKind,
  type Variant,
} from "./tools";
import { deriveChannel, type DerivedChannelKind } from "./channels";
import type { Degree } from "./degrees";
import type { TerminalId } from "../workspace-store";

const HISTORY_LIMIT = 50;

interface TerminalDrawings {
  drawings: Drawing[];
  past: Drawing[][];
  future: Drawing[][];
}

const emptyTerminal = (): TerminalDrawings => ({ drawings: [], past: [], future: [] });

interface DrawingState {
  byTerminal: Record<TerminalId, TerminalDrawings>;

  /** The tool armed for the next click, or null for the select cursor. */
  activeTool: ToolKind | null;
  /** Degree applied to the next drawing created. */
  activeDegree: Degree;
  /** In-progress placement: pivots collected so far. */
  pending: { terminal: TerminalId; kind: ToolKind; pivots: Pivot[] } | null;
  selectedId: string | null;
  /** Magnetic snapping to candle highs and lows. */
  magnet: boolean;
  setMagnet: (on: boolean) => void;

  setActiveTool: (kind: ToolKind | null) => void;
  setActiveDegree: (degree: Degree) => void;
  select: (id: string | null) => void;

  /** Add a pivot to the pending drawing; commits when the count is reached. */
  addPivot: (terminal: TerminalId, pivot: Pivot) => void;
  cancelPending: () => void;

  movePivot: (terminal: TerminalId, id: string, index: number, pivot: Pivot) => void;
  /** Called once at drag start so the whole drag is a single undo step. */
  beginDrag: (terminal: TerminalId) => void;
  remove: (terminal: TerminalId, id: string) => void;
  setDegree: (terminal: TerminalId, id: string, degree: Degree) => void;
  setVariant: (terminal: TerminalId, id: string, variant: Variant) => void;
  setStyle: (terminal: TerminalId, id: string, style: DrawingStyle) => void;
  toggleFlag: (terminal: TerminalId, id: string, flag: "locked" | "hidden" | "extend") => void;
  /** Build a channel from the selected count and select the result. */
  addDerivedChannel: (terminal: TerminalId, sourceId: string, kind: DerivedChannelKind) => void;
  clear: (terminal: TerminalId) => void;

  undo: (terminal: TerminalId) => void;
  redo: (terminal: TerminalId) => void;
  canUndo: (terminal: TerminalId) => boolean;
  canRedo: (terminal: TerminalId) => boolean;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `d${Date.now().toString(36)}${counter.toString(36)}`;
}

export const useDrawings = create<DrawingState>()(
  persist(
    (set, get) => {
      /** Apply a change to one terminal, pushing the previous state onto history. */
      function commit(
        terminal: TerminalId,
        change: (drawings: Drawing[]) => Drawing[],
        { snapshot = true }: { snapshot?: boolean } = {}
      ) {
        set((s) => {
          const current = s.byTerminal[terminal] ?? emptyTerminal();
          const next = change(current.drawings);
          return {
            byTerminal: {
              ...s.byTerminal,
              [terminal]: {
                drawings: next,
                past: snapshot
                  ? [...current.past, current.drawings].slice(-HISTORY_LIMIT)
                  : current.past,
                future: [], // any new action invalidates the redo branch
              },
            },
          };
        });
      }

      return {
        byTerminal: { A: emptyTerminal(), B: emptyTerminal() },
        activeTool: null,
        activeDegree: "minor",
        pending: null,
        selectedId: null,
        // On by default: Elliott pivots are actual extremes, so the honest
        // placement should be the effortless one.
        magnet: true,

        setMagnet: (magnet) => set({ magnet }),

        setActiveTool: (kind) =>
          set({ activeTool: kind, pending: null, selectedId: kind ? null : get().selectedId }),
        setActiveDegree: (activeDegree) => set({ activeDegree }),
        select: (selectedId) => set({ selectedId }),

        addPivot: (terminal, pivot) => {
          const { activeTool, pending, activeDegree } = get();
          if (!activeTool) return;

          const collected =
            pending && pending.kind === activeTool && pending.terminal === terminal
              ? [...pending.pivots, pivot]
              : [pivot];

          const spec = TOOL_SPECS[activeTool];
          if (collected.length < spec.points) {
            set({ pending: { terminal, kind: activeTool, pivots: collected } });
            return;
          }

          const drawing: Drawing = {
            id: nextId(),
            kind: activeTool,
            degree: activeDegree,
            variant: spec.defaultVariant,
            pivots: collected,
            complete: true,
          };
          commit(terminal, (ds) => [...ds, drawing]);
          // Disarm after a completed structure: the analyst almost never wants
          // a second one immediately, and a stray click would start one.
          set({ pending: null, activeTool: null, selectedId: drawing.id });
        },

        cancelPending: () => set({ pending: null }),

        beginDrag: (terminal) => commit(terminal, (ds) => ds),

        // snapshot:false — beginDrag already recorded the pre-drag state, so
        // every mousemove must not push its own history entry.
        movePivot: (terminal, id, index, pivot) =>
          commit(
            terminal,
            (ds) =>
              ds.map((d) =>
                d.id === id
                  ? { ...d, pivots: d.pivots.map((p, i) => (i === index ? pivot : p)) }
                  : d
              ),
            { snapshot: false }
          ),

        remove: (terminal, id) => {
          commit(terminal, (ds) => ds.filter((d) => d.id !== id));
          if (get().selectedId === id) set({ selectedId: null });
        },

        setDegree: (terminal, id, degree) =>
          commit(terminal, (ds) => ds.map((d) => (d.id === id ? { ...d, degree } : d))),

        setVariant: (terminal, id, variant) =>
          commit(terminal, (ds) => ds.map((d) => (d.id === id ? { ...d, variant } : d))),

        setStyle: (terminal, id, style) =>
          commit(terminal, (ds) =>
            ds.map((d) => (d.id === id ? { ...d, style: { ...d.style, ...style } } : d))
          ),

        toggleFlag: (terminal, id, flag) =>
          commit(terminal, (ds) => ds.map((d) => (d.id === id ? { ...d, [flag]: !d[flag] } : d))),

        addDerivedChannel: (terminal, sourceId, kind) => {
          const source = get().byTerminal[terminal]?.drawings.find((d) => d.id === sourceId);
          if (!source) return;
          const channel = deriveChannel(source, kind, nextId());
          if (!channel) return;
          commit(terminal, (ds) => [...ds, channel]);
          set({ selectedId: channel.id });
        },

        clear: (terminal) => commit(terminal, () => []),

        undo: (terminal) =>
          set((s) => {
            const t = s.byTerminal[terminal] ?? emptyTerminal();
            if (!t.past.length) return s;
            const previous = t.past[t.past.length - 1];
            return {
              byTerminal: {
                ...s.byTerminal,
                [terminal]: {
                  drawings: previous,
                  past: t.past.slice(0, -1),
                  future: [t.drawings, ...t.future].slice(0, HISTORY_LIMIT),
                },
              },
            };
          }),

        redo: (terminal) =>
          set((s) => {
            const t = s.byTerminal[terminal] ?? emptyTerminal();
            if (!t.future.length) return s;
            const [next, ...rest] = t.future;
            return {
              byTerminal: {
                ...s.byTerminal,
                [terminal]: {
                  drawings: next,
                  past: [...t.past, t.drawings].slice(-HISTORY_LIMIT),
                  future: rest,
                },
              },
            };
          }),

        canUndo: (terminal) => (get().byTerminal[terminal]?.past.length ?? 0) > 0,
        canRedo: (terminal) => (get().byTerminal[terminal]?.future.length ?? 0) > 0,
      };
    },
    {
      name: "wave-lab.drawings",
      version: 1,
      // History and transient selection are session concerns; persisting them
      // would restore a redo stack for edits made in a previous sitting.
      partialize: (s) => ({
        byTerminal: {
          A: { drawings: s.byTerminal.A?.drawings ?? [], past: [], future: [] },
          B: { drawings: s.byTerminal.B?.drawings ?? [], past: [], future: [] },
        },
        activeDegree: s.activeDegree,
        magnet: s.magnet,
      }),
    }
  )
);

export function drawingsFor(state: DrawingState, terminal: TerminalId): Drawing[] {
  return state.byTerminal[terminal]?.drawings ?? [];
}
