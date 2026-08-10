"use client";

/**
 * Tool strip, degree picker and the selected drawing's inspector. §4.2, §4.3.
 *
 * The variant control sits in the open rather than behind a menu on purpose:
 * it decides whether wave 4 may enter wave 1's territory, which makes it the
 * single most consequential switch in the app. A count marked "standard" and a
 * count marked "ending diagonal" are different claims about the market, and
 * the rule engine in phase 4 will judge them differently.
 */

import * as React from "react";
import {
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Minus,
  MousePointer2,
  MoveHorizontal,
  Redo2,
  Slash,
  Trash2,
  Triangle,
  Undo2,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEGREES, DEGREE_META, type Degree } from "@/lib/wave-lab/drawings/degrees";
import {
  DEFAULT_STYLE,
  TOOL_SPECS,
  isChannel,
  type ToolKind,
  type Variant,
} from "@/lib/wave-lab/drawings/tools";
import {
  DERIVED_CHANNELS,
  DERIVED_LABEL,
  canDerive,
} from "@/lib/wave-lab/drawings/channels";
import { useDrawings } from "@/lib/wave-lab/drawings/store";
import type { TerminalId } from "@/lib/wave-lab/workspace-store";

const STRUCTURE_TOOLS: ToolKind[] = [
  "impulse",
  "correction",
  "triangle",
  "double-combo",
  "triple-combo",
];

/** Compact glyphs — the strip has to fit above a chart, not dominate it. */
const TOOL_GLYPH: Record<ToolKind, string> = {
  impulse: "12345",
  correction: "ABC",
  triangle: "ABCDE",
  "double-combo": "WXY",
  "triple-combo": "WXYXZ",
  trendline: "",
  horizontal: "",
  "parallel-channel": "",
  "triangle-channel": "",
};

const VARIANT_LABEL: Record<string, string> = {
  standard: "Standard impulse",
  "leading-diagonal": "Leading diagonal",
  "ending-diagonal": "Ending diagonal",
  "extended-third": "Extended third",
  "extended-fifth": "Extended fifth",
  "truncated-fifth": "Truncated fifth",
  zigzag: "Zigzag",
  "regular-flat": "Regular flat",
  "expanded-flat": "Expanded flat",
  "running-flat": "Running flat",
  contracting: "Contracting",
  barrier: "Barrier",
  expanding: "Expanding",
  running: "Running",
};

export function DrawingToolbar({ terminal }: { terminal: TerminalId }) {
  const activeTool = useDrawings((s) => s.activeTool);
  const activeDegree = useDrawings((s) => s.activeDegree);
  const pending = useDrawings((s) => s.pending);
  const selectedId = useDrawings((s) => s.selectedId);
  const drawings = useDrawings((s) => s.byTerminal[terminal]?.drawings ?? []);
  const past = useDrawings((s) => s.byTerminal[terminal]?.past.length ?? 0);
  const future = useDrawings((s) => s.byTerminal[terminal]?.future.length ?? 0);

  const magnet = useDrawings((s) => s.magnet);
  const setMagnet = useDrawings((s) => s.setMagnet);
  const setActiveTool = useDrawings((s) => s.setActiveTool);
  const setActiveDegree = useDrawings((s) => s.setActiveDegree);
  const setDegree = useDrawings((s) => s.setDegree);
  const setVariant = useDrawings((s) => s.setVariant);
  const setStyle = useDrawings((s) => s.setStyle);
  const toggleFlag = useDrawings((s) => s.toggleFlag);
  const addDerivedChannel = useDrawings((s) => s.addDerivedChannel);
  const remove = useDrawings((s) => s.remove);
  const undo = useDrawings((s) => s.undo);
  const redo = useDrawings((s) => s.redo);

  const selected = drawings.find((d) => d.id === selectedId) ?? null;
  const spec = activeTool ? TOOL_SPECS[activeTool] : null;
  const placed = pending?.terminal === terminal ? pending.pivots.length : 0;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[var(--wl-border)] px-2 py-1">
      <IconButton
        on={activeTool === null}
        onClick={() => setActiveTool(null)}
        title="Select (Esc)"
      >
        <MousePointer2 className="h-3.5 w-3.5" />
      </IconButton>

      <span className="mx-0.5 h-4 w-px bg-[var(--wl-border)]" />

      {STRUCTURE_TOOLS.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => setActiveTool(activeTool === kind ? null : kind)}
          aria-pressed={activeTool === kind}
          title={`${TOOL_SPECS[kind].label} — ${TOOL_SPECS[kind].points} clicks`}
          className={cn(
            "rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold tracking-tight transition-colors",
            activeTool === kind
              ? "border-[var(--wl-blue)] bg-[var(--wl-blue)] text-white"
              : "border-[var(--wl-border)] text-[var(--wl-muted)] hover:bg-[var(--wl-hover)] hover:text-[var(--wl-text)]"
          )}
        >
          {TOOL_GLYPH[kind]}
        </button>
      ))}

      <span className="mx-0.5 h-4 w-px bg-[var(--wl-border)]" />

      <IconButton
        on={activeTool === "trendline"}
        onClick={() => setActiveTool(activeTool === "trendline" ? null : "trendline")}
        title="Trendline"
      >
        <Slash className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        on={activeTool === "horizontal"}
        onClick={() => setActiveTool(activeTool === "horizontal" ? null : "horizontal")}
        title="Horizontal line"
      >
        <Minus className="h-3.5 w-3.5" />
      </IconButton>

      {/* Channels. The parallel tool is also the "custom three-point"
          channel — two clicks set the base, the third places the parallel. */}
      <IconButton
        on={activeTool === "parallel-channel"}
        onClick={() =>
          setActiveTool(activeTool === "parallel-channel" ? null : "parallel-channel")
        }
        title="Parallel channel — 3 clicks (custom three-point)"
      >
        <MoveHorizontal className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        on={activeTool === "triangle-channel"}
        onClick={() =>
          setActiveTool(activeTool === "triangle-channel" ? null : "triangle-channel")
        }
        title="Triangle channel — 4 clicks: A–C then B–D"
      >
        <Triangle className="h-3.5 w-3.5" />
      </IconButton>

      <IconButton
        on={magnet}
        onClick={() => setMagnet(!magnet)}
        title="Magnetic snapping to candle highs and lows"
      >
        <Magnet className="h-3.5 w-3.5" />
      </IconButton>

      <span className="mx-0.5 h-4 w-px bg-[var(--wl-border)]" />

      {/* One-click channels derived from the selected count. Each is only
          offered when the selection can actually produce it. */}
      {DERIVED_CHANNELS.filter((k) => canDerive(selected, k)).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => selected && addDerivedChannel(terminal, selected.id, kind)}
          title={`Draw the ${DERIVED_LABEL[kind]} from this count`}
          className="rounded-[3px] border border-[var(--wl-blue)] bg-[var(--wl-blue)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--wl-blue)] transition-colors hover:bg-[var(--wl-blue)]/20"
        >
          {DERIVED_LABEL[kind]}
        </button>
      ))}

      {/* Degree for the NEXT drawing, or for the selected one if there is one. */}
      <select
        aria-label="Wave degree"
        value={selected ? selected.degree : activeDegree}
        onChange={(e) => {
          const degree = e.target.value as Degree;
          if (selected) setDegree(terminal, selected.id, degree);
          else setActiveDegree(degree);
        }}
        className="rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--wl-text)] outline-none"
      >
        {DEGREES.map((d) => (
          <option key={d} value={d}>
            {DEGREE_META[d].label}
          </option>
        ))}
      </select>

      {/* The consequential switch — visible whenever a variant-bearing
          structure is selected. */}
      {selected && TOOL_SPECS[selected.kind].variants.length > 0 && (
        <select
          aria-label="Variant"
          value={selected.variant}
          onChange={(e) => setVariant(terminal, selected.id, e.target.value as Variant)}
          className="rounded-[3px] border border-[var(--wl-blue)] bg-[var(--wl-blue)]/10 px-1 py-0.5 text-[10px] font-medium text-[var(--wl-blue)] outline-none"
        >
          {TOOL_SPECS[selected.kind].variants.map((v) => (
            <option key={v} value={v}>
              {VARIANT_LABEL[v] ?? v}
            </option>
          ))}
        </select>
      )}

      {/* -------- appearance and state of the selected drawing --------- */}
      {selected && (
        <>
          <span className="mx-0.5 h-4 w-px bg-[var(--wl-border)]" />

          <input
            type="color"
            value={selected.style?.color ?? DEFAULT_STYLE.color}
            onChange={(e) => setStyle(terminal, selected.id, { color: e.target.value })}
            aria-label="Drawing colour"
            title="Colour"
            className="h-5 w-6 cursor-pointer rounded-[3px] border border-[var(--wl-border)] bg-transparent p-0"
          />
          <select
            value={selected.style?.lineStyle ?? DEFAULT_STYLE.lineStyle}
            onChange={(e) =>
              setStyle(terminal, selected.id, {
                lineStyle: e.target.value as "solid" | "dashed" | "dotted",
              })
            }
            aria-label="Line style"
            className="rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--wl-text)]"
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
          <select
            value={selected.style?.thickness ?? DEFAULT_STYLE.thickness}
            onChange={(e) =>
              setStyle(terminal, selected.id, { thickness: Number(e.target.value) })
            }
            aria-label="Line thickness"
            className="rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--wl-text)]"
          >
            {[1, 1.5, 2, 3].map((t) => (
              <option key={t} value={t}>
                {t}px
              </option>
            ))}
          </select>

          {isChannel(selected.kind) && (
            <>
              <IconButton
                on={selected.style?.fill ?? DEFAULT_STYLE.fill}
                onClick={() =>
                  setStyle(terminal, selected.id, {
                    fill: !(selected.style?.fill ?? DEFAULT_STYLE.fill),
                  })
                }
                title="Background fill"
              >
                <span className="text-[9px] font-bold">FILL</span>
              </IconButton>
              <IconButton
                on={!!selected.extend}
                onClick={() => toggleFlag(terminal, selected.id, "extend")}
                title="Extend the channel to the pane edges"
              >
                <span className="text-[9px] font-bold">EXT</span>
              </IconButton>
            </>
          )}

          <IconButton
            on={!!selected.locked}
            onClick={() => toggleFlag(terminal, selected.id, "locked")}
            title={selected.locked ? "Unlock" : "Lock — stops it being selected or dragged"}
          >
            {selected.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton
            on={!!selected.hidden}
            onClick={() => toggleFlag(terminal, selected.id, "hidden")}
            title={selected.hidden ? "Show" : "Hide"}
          >
            {selected.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </IconButton>
        </>
      )}

      <span className="mx-0.5 h-4 w-px bg-[var(--wl-border)]" />

      <IconButton on={false} onClick={() => undo(terminal)} title="Undo" disabled={past === 0}>
        <Undo2 className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton on={false} onClick={() => redo(terminal)} title="Redo" disabled={future === 0}>
        <Redo2 className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        on={false}
        onClick={() => selected && remove(terminal, selected.id)}
        title="Delete selected"
        disabled={!selected}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>

      {/* Progress while placing: "click 3 of 6" beats a silent cursor. */}
      {spec && (
        <span className="ml-1 text-[10px] text-[var(--wl-blue)]" data-testid="placement-progress">
          {spec.label}: click {placed + 1} of {spec.points}
          {placed === 0 && " (origin)"}
        </span>
      )}

      <span className="ml-auto text-[10px] text-[var(--wl-muted)]" data-testid="drawing-count">
        {drawings.length} drawing{drawings.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function IconButton({
  on,
  onClick,
  title,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        "rounded-[3px] border p-1 transition-colors disabled:opacity-30",
        on
          ? "border-[var(--wl-blue)] bg-[var(--wl-blue)] text-white"
          : "border-[var(--wl-border)] text-[var(--wl-muted)] hover:bg-[var(--wl-hover)] hover:text-[var(--wl-text)]"
      )}
    >
      {children}
    </button>
  );
}
