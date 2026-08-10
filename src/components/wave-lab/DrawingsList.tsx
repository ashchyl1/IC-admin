"use client";

/**
 * The drawings list. §4.3, and the only way back to a locked or hidden object.
 *
 * That second job is why this is not optional. Locking and hiding both remove
 * a drawing from hit-testing — deliberately, that is what they are for — so
 * without a list the moment you deselect a locked channel it becomes
 * unreachable and can never be unlocked. Every row therefore carries its own
 * lock, hide and delete controls rather than relying on selection.
 */

import * as React from "react";
import { Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEGREE_META } from "@/lib/wave-lab/drawings/degrees";
import { TOOL_SPECS, isChannel, type Drawing } from "@/lib/wave-lab/drawings/tools";
import { useDrawings } from "@/lib/wave-lab/drawings/store";
import { analyse } from "@/lib/wave-lab/analysis/rules";
import type { MarketCandle } from "@/lib/wave-lab/types";
import type { TerminalId } from "@/lib/wave-lab/workspace-store";

const VERDICT_TONE: Record<string, string> = {
  High: "text-[var(--wl-profit)]",
  Medium: "text-[var(--wl-blue)]",
  Low: "text-[var(--wl-amber)]",
  Invalid: "text-[var(--wl-sell)]",
};

export function DrawingsList({
  terminal,
  candles,
}: {
  terminal: TerminalId;
  candles: MarketCandle[];
}) {
  const drawings = useDrawings((s) => s.byTerminal[terminal]?.drawings ?? []);
  const selectedId = useDrawings((s) => s.selectedId);
  const select = useDrawings((s) => s.select);
  const toggleFlag = useDrawings((s) => s.toggleFlag);
  const remove = useDrawings((s) => s.remove);

  if (!drawings.length) return null;

  return (
    <section className="border-b border-[var(--wl-border)] p-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
        Drawings
      </h3>
      <ul className="mt-1.5 space-y-0.5">
        {drawings.map((d) => (
          <Row
            key={d.id}
            drawing={d}
            candles={candles}
            selected={d.id === selectedId}
            onSelect={() => select(d.id)}
            onToggle={(flag) => toggleFlag(terminal, d.id, flag)}
            onDelete={() => remove(terminal, d.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  drawing,
  candles,
  selected,
  onSelect,
  onToggle,
  onDelete,
}: {
  drawing: Drawing;
  candles: MarketCandle[];
  selected: boolean;
  onSelect: () => void;
  onToggle: (flag: "locked" | "hidden") => void;
  onDelete: () => void;
}) {
  const verdict = React.useMemo(() => analyse(drawing, candles)?.confidence ?? null, [
    drawing,
    candles,
  ]);
  const spec = TOOL_SPECS[drawing.kind];

  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-[3px] px-1 py-0.5",
        selected && "bg-[var(--wl-blue)]/10"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-baseline gap-1 text-left"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: drawing.style?.color ?? "#387ed1" }}
          aria-hidden="true"
        />
        <span
          className={cn(
            "truncate text-[11px] font-medium",
            drawing.hidden ? "text-[var(--wl-muted)] line-through" : "text-[var(--wl-text-strong)]"
          )}
        >
          {spec.label}
        </span>
        {!isChannel(drawing.kind) && spec.hasDegree && (
          <span className="shrink-0 text-[10px] text-[var(--wl-muted)]">
            {DEGREE_META[drawing.degree].label}
          </span>
        )}
        {verdict && (
          <span className={cn("ml-auto shrink-0 text-[10px] font-semibold", VERDICT_TONE[verdict])}>
            {verdict}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onToggle("locked")}
        aria-label={drawing.locked ? "Unlock drawing" : "Lock drawing"}
        title={drawing.locked ? "Unlock" : "Lock"}
        className={cn(
          "shrink-0 rounded-[3px] p-0.5 transition-colors hover:bg-[var(--wl-hover)]",
          drawing.locked ? "text-[var(--wl-blue)]" : "text-[var(--wl-muted)]"
        )}
      >
        {drawing.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={() => onToggle("hidden")}
        aria-label={drawing.hidden ? "Show drawing" : "Hide drawing"}
        title={drawing.hidden ? "Show" : "Hide"}
        className={cn(
          "shrink-0 rounded-[3px] p-0.5 transition-colors hover:bg-[var(--wl-hover)]",
          drawing.hidden ? "text-[var(--wl-blue)]" : "text-[var(--wl-muted)]"
        )}
      >
        {drawing.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete drawing"
        title="Delete"
        className="shrink-0 rounded-[3px] p-0.5 text-[var(--wl-muted)] transition-colors hover:bg-[var(--wl-sell)]/10 hover:text-[var(--wl-sell)]"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  );
}
