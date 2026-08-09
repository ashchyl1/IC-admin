"use client";

/**
 * The drawing toolbar — the Wave Lab's equivalent of TradingView's left rail.
 *
 * The five Elliott tools sit at the top as one group because they are the point
 * of the module; the measurement tools follow. Degree and variant live here
 * too, immediately under the tools, because picking a tool without setting its
 * degree is the most common way to end up with a chart of untraceable labels.
 */

import * as React from "react";
import { Magnet, Tag, Trash2 } from "lucide-react";

import { DEGREES, DEGREE_KEYS, decorateLabel, type DegreeKey } from "@/lib/wave/degrees";
import { TOOLS, TOOL_ORDER, type ToolId } from "@/lib/wave/patterns";
import { clsx } from "@/components/scalper/ui";

interface Props {
  activeTool: ToolId;
  degree: DegreeKey;
  variant?: string;
  magnet: boolean;
  showLabels: boolean;
  hasDrawings: boolean;
  onTool: (tool: ToolId) => void;
  onDegree: (degree: DegreeKey) => void;
  onVariant: (variant: string) => void;
  onMagnet: () => void;
  onLabels: () => void;
  onClear: () => void;
}

export function DrawingToolbar({
  activeTool,
  degree,
  variant,
  magnet,
  showLabels,
  hasDrawings,
  onTool,
  onDegree,
  onVariant,
  onMagnet,
  onLabels,
  onClear,
}: Props) {
  const spec = TOOLS[activeTool];
  const [degreeOpen, setDegreeOpen] = React.useState(false);

  return (
    <div className="flex w-[58px] shrink-0 flex-col gap-1 border-r border-slate-800/80 bg-[#0d141f] p-1.5">
      {TOOL_ORDER.map((id, i) => {
        const tool = TOOLS[id];
        const active = id === activeTool;
        const startsGroup = i === 1 || id === "fibRetracement";
        return (
          <React.Fragment key={id}>
            {startsGroup ? <div className="my-0.5 h-px bg-slate-800" /> : null}
            <button
              type="button"
              aria-pressed={active}
              title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""} — ${tool.hint}`}
              onClick={() => onTool(id)}
              className={clsx(
                "flex h-10 flex-col items-center justify-center rounded-md border text-[9px] font-bold leading-tight transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400",
                active
                  ? "border-cyan-500/70 bg-cyan-600/20 text-cyan-200"
                  : "border-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
              )}
            >
              <ToolGlyph id={id} />
              <span className="mt-0.5 w-full truncate px-0.5 text-center">{tool.short}</span>
            </button>
          </React.Fragment>
        );
      })}

      <div className="my-0.5 h-px bg-slate-800" />

      {/* Degree picker. A popover rather than a select so the decorated labels
          can be previewed at the size and colour they will appear on the chart. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setDegreeOpen((open) => !open)}
          aria-expanded={degreeOpen}
          title={`Wave degree — ${DEGREES[degree].label} (${DEGREES[degree].span})`}
          className="flex h-10 w-full flex-col items-center justify-center rounded-md border border-slate-800 bg-slate-900/60 text-[9px] font-bold text-slate-300 hover:border-slate-700"
        >
          <span style={{ color: DEGREES[degree].color }} className="text-[13px] leading-none">
            {decorateLabel("3", degree)}
          </span>
          <span className="mt-0.5 w-full truncate px-0.5 text-center text-slate-500">Deg</span>
        </button>

        {degreeOpen ? (
          <div className="absolute left-full top-0 z-30 ml-1 w-56 rounded-md border border-slate-700 bg-[#0f1725] p-1 shadow-xl">
            {DEGREE_KEYS.map((key) => {
              const entry = DEGREES[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onDegree(key);
                    setDegreeOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors",
                    key === degree ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/70"
                  )}
                >
                  <span
                    className="w-14 shrink-0 font-mono text-[12px] font-bold"
                    style={{ color: entry.color }}
                  >
                    {decorateLabel("1", key)}
                    {decorateLabel("2", key)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-200">{entry.label}</span>
                    <span className="block truncate text-[10px] text-slate-500">{entry.span}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {spec.variants.length > 0 ? (
        <select
          aria-label={`${spec.label} variant`}
          value={variant ?? spec.variants[0].id}
          onChange={(event) => onVariant(event.target.value)}
          title="Pattern variant — decides which rules are applied"
          className="h-7 w-full rounded-md border border-slate-800 bg-slate-900/60 px-1 text-[9px] font-semibold text-slate-200 focus:border-cyan-500 focus:outline-none"
        >
          {spec.variants.map((entry) => (
            <option key={entry.id} value={entry.id} className="bg-slate-900">
              {entry.label}
            </option>
          ))}
        </select>
      ) : null}

      <div className="my-0.5 h-px bg-slate-800" />

      <IconToggle
        active={magnet}
        onClick={onMagnet}
        title="Magnet — snap pivots to the nearest bar's high or low"
        icon={<Magnet className="h-3.5 w-3.5" />}
        label="Snap"
      />
      <IconToggle
        active={showLabels}
        onClick={onLabels}
        title="Show or hide wave labels"
        icon={<Tag className="h-3.5 w-3.5" />}
        label="Labels"
      />
      <button
        type="button"
        disabled={!hasDrawings}
        onClick={onClear}
        title="Remove every drawing on this chart"
        className="flex h-9 flex-col items-center justify-center rounded-md border border-transparent text-[9px] font-bold text-slate-500 transition-colors hover:bg-rose-900/30 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span className="mt-0.5">Clear</span>
      </button>
    </div>
  );
}

function IconToggle({
  active,
  onClick,
  title,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={clsx(
        "flex h-9 flex-col items-center justify-center rounded-md border text-[9px] font-bold transition-colors",
        active
          ? "border-cyan-500/60 bg-cyan-600/15 text-cyan-200"
          : "border-transparent text-slate-500 hover:bg-slate-800/70 hover:text-slate-300"
      )}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
    </button>
  );
}

/**
 * Tiny inline glyphs. Each one is the shape of the pattern it draws, which
 * reads faster than an icon font at this size.
 */
function ToolGlyph({ id }: { id: ToolId }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  switch (id) {
    case "cursor":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" {...common}>
          <path d="M3 2l8 4.5-3.4.9L6 11z" />
        </svg>
      );
    case "impulse":
      return (
        <svg width="18" height="12" viewBox="0 0 18 12" {...common}>
          <polyline points="1,11 4,5 6,8 11,1.5 13,4.5 17,1" />
        </svg>
      );
    case "correction":
      return (
        <svg width="18" height="12" viewBox="0 0 18 12" {...common}>
          <polyline points="1,2 7,10 12,4 17,11" />
        </svg>
      );
    case "triangle":
      return (
        <svg width="18" height="12" viewBox="0 0 18 12" {...common}>
          <polyline points="1,1 5,11 8,3 11,9 14,5 17,7" />
        </svg>
      );
    case "doubleCombo":
      return (
        <svg width="18" height="12" viewBox="0 0 18 12" {...common}>
          <polyline points="1,2 6,9 9,5 14,11" />
        </svg>
      );
    case "tripleCombo":
      return (
        <svg width="18" height="12" viewBox="0 0 18 12" {...common}>
          <polyline points="1,1 4,7 6,4 10,9 12,6 17,11" />
        </svg>
      );
    case "fibRetracement":
      return (
        <svg width="16" height="12" viewBox="0 0 16 12" {...common}>
          <path d="M1 1h14M1 4.5h14M1 8h14M1 11h14" />
        </svg>
      );
    case "fibExtension":
      return (
        <svg width="16" height="12" viewBox="0 0 16 12" {...common}>
          <path d="M1 10h14M1 6h14M1 2h9" />
          <path d="M11 2l3 0 0 3" />
        </svg>
      );
    case "trendline":
      return (
        <svg width="16" height="12" viewBox="0 0 16 12" {...common}>
          <path d="M1.5 10.5L14.5 1.5" />
        </svg>
      );
    case "hline":
      return (
        <svg width="16" height="12" viewBox="0 0 16 12" {...common}>
          <path d="M1 6h14" />
        </svg>
      );
    default:
      return null;
  }
}
