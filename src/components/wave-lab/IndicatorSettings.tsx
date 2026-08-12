"use client";

/**
 * Indicator controls. §7.
 *
 * Every knob the brief asks for is here and directly editable: period, colour,
 * thickness and visibility per EMA; length, deviation, colour and fill for
 * Bollinger. Colour uses the native picker rather than a bespoke palette —
 * "give every EMA a separate colour" means the analyst's choice, not a menu of
 * four.
 */

import * as React from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIndicators } from "@/lib/wave-lab/indicator-store";
import type { TerminalId } from "@/lib/wave-lab/workspace-store";

export function IndicatorSettings({ terminal }: { terminal: TerminalId }) {
  const [open, setOpen] = React.useState(false);
  const config = useIndicators((s) => s.byTerminal[terminal]);
  const toggleEma = useIndicators((s) => s.toggleEma);
  const patchEma = useIndicators((s) => s.patchEma);
  const patchBollinger = useIndicators((s) => s.patchBollinger);
  const patchRmi = useIndicators((s) => s.patchRmi);
  const reset = useIndicators((s) => s.reset);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!config) return null;
  const activeCount =
    config.emas.filter((e) => e.visible).length +
    (config.bollinger.visible ? 1 : 0) +
    (config.rmi.visible ? 1 : 0);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Indicators"
        aria-label="Indicators"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
          activeCount > 0
            ? "border-[var(--wl-blue)] bg-[var(--wl-blue)]/10 text-[var(--wl-blue)]"
            : "border-[var(--wl-border)] text-[var(--wl-muted)] hover:bg-[var(--wl-hover)]"
        )}
      >
        <SlidersHorizontal className="h-3 w-3" />
        {activeCount > 0 ? activeCount : "IND"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-[3px] border border-[var(--wl-border)] bg-[var(--wl-bg)] p-2.5 shadow-lg">
          {/* ------------------------------------------------- EMAs ----- */}
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
              Moving averages
            </h3>
            <button
              type="button"
              onClick={() => reset(terminal)}
              title="Restore defaults"
              className="rounded-[3px] p-0.5 text-[var(--wl-muted)] hover:bg-[var(--wl-hover)]"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>

          <ul className="mt-1.5 space-y-1">
            {config.emas.map((e) => (
              <li key={e.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={e.visible}
                  onChange={() => toggleEma(terminal, e.id)}
                  aria-label={`Show EMA ${e.period}`}
                  className="h-3 w-3"
                />
                <span className="w-8 text-[11px] font-medium text-[var(--wl-text)]">EMA</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={e.period}
                  onChange={(ev) =>
                    patchEma(terminal, e.id, { period: Math.max(1, Number(ev.target.value) || 1) })
                  }
                  aria-label={`EMA ${e.period} period`}
                  className="w-12 rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[11px] tabular-nums text-[var(--wl-text)]"
                />
                <input
                  type="color"
                  value={e.color}
                  onChange={(ev) => patchEma(terminal, e.id, { color: ev.target.value })}
                  aria-label={`EMA ${e.period} colour`}
                  className="h-5 w-6 cursor-pointer rounded-[3px] border border-[var(--wl-border)] bg-transparent p-0"
                />
                <select
                  value={e.width}
                  onChange={(ev) => patchEma(terminal, e.id, { width: Number(ev.target.value) })}
                  aria-label={`EMA ${e.period} thickness`}
                  className="rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--wl-text)]"
                >
                  {[1, 2, 3].map((w) => (
                    <option key={w} value={w}>
                      {w}px
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          {/* -------------------------------------------- Bollinger ----- */}
          <h3 className="mt-3 border-t border-[var(--wl-border)] pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
            Bollinger Bands
          </h3>
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--wl-text)]">
              <input
                type="checkbox"
                checked={config.bollinger.visible}
                onChange={() => patchBollinger(terminal, { visible: !config.bollinger.visible })}
                aria-label="Show Bollinger Bands"
                className="h-3 w-3"
              />
              Show bands
            </label>

            <div className="flex items-center gap-1.5">
              <span className="w-12 text-[11px] text-[var(--wl-muted)]">Length</span>
              <input
                type="number"
                min={2}
                max={400}
                value={config.bollinger.length}
                onChange={(e) =>
                  patchBollinger(terminal, { length: Math.max(2, Number(e.target.value) || 20) })
                }
                aria-label="Bollinger length"
                className="w-14 rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[11px] tabular-nums text-[var(--wl-text)]"
              />
              <span className="ml-1 w-10 text-[11px] text-[var(--wl-muted)]">Dev</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={config.bollinger.deviations}
                onChange={(e) =>
                  patchBollinger(terminal, {
                    deviations: Math.max(0.1, Number(e.target.value) || 2),
                  })
                }
                aria-label="Bollinger deviations"
                className="w-14 rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[11px] tabular-nums text-[var(--wl-text)]"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-12 text-[11px] text-[var(--wl-muted)]">Colour</span>
              <input
                type="color"
                value={config.bollinger.color}
                onChange={(e) => patchBollinger(terminal, { color: e.target.value })}
                aria-label="Bollinger colour"
                className="h-5 w-6 cursor-pointer rounded-[3px] border border-[var(--wl-border)] bg-transparent p-0"
              />
              <label className="ml-1 flex items-center gap-1 text-[11px] text-[var(--wl-text)]">
                <input
                  type="checkbox"
                  checked={config.bollinger.fill}
                  onChange={() => patchBollinger(terminal, { fill: !config.bollinger.fill })}
                  aria-label="Bollinger background fill"
                  className="h-3 w-3"
                />
                Fill
              </label>
              <input
                type="range"
                min={0.02}
                max={0.4}
                step={0.02}
                value={config.bollinger.fillOpacity}
                onChange={(e) =>
                  patchBollinger(terminal, { fillOpacity: Number(e.target.value) })
                }
                aria-label="Bollinger fill opacity"
                disabled={!config.bollinger.fill}
                className="ml-auto w-16 disabled:opacity-40"
              />
            </div>
          </div>

          {/* ------------------------------------------------- RMI ------ */}
          <h3 className="mt-3 border-t border-[var(--wl-border)] pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
            RMI Scaled (Wilder&apos;s)
          </h3>
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--wl-text)]">
              <input
                type="checkbox"
                checked={config.rmi.visible}
                onChange={() => patchRmi(terminal, { visible: !config.rmi.visible })}
                aria-label="Show RMI Scaled"
                className="h-3 w-3"
              />
              Show in its own pane
            </label>

            <div className="grid grid-cols-2 gap-1.5">
              <NumberField
                label="Lookback"
                value={config.rmi.lookback}
                min={1}
                onChange={(lookback) => patchRmi(terminal, { lookback })}
              />
              <NumberField
                label="Smoothing"
                value={config.rmi.smoothLen}
                min={1}
                onChange={(smoothLen) => patchRmi(terminal, { smoothLen })}
              />
              <NumberField
                label="Divisor"
                value={config.rmi.scaleFactor}
                min={0.1}
                step={0.1}
                onChange={(scaleFactor) => patchRmi(terminal, { scaleFactor })}
              />
              <NumberField
                label="Signal len"
                value={config.rmi.signalLen}
                min={1}
                onChange={(signalLen) => patchRmi(terminal, { signalLen })}
              />
              <NumberField
                label="OB level"
                value={config.rmi.obLevel}
                step={0.5}
                onChange={(obLevel) => patchRmi(terminal, { obLevel })}
              />
              <NumberField
                label="OS level"
                value={config.rmi.osLevel}
                step={0.5}
                onChange={(osLevel) => patchRmi(terminal, { osLevel })}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--wl-muted)]">Signal</span>
              <select
                value={config.rmi.signalType}
                onChange={(e) =>
                  patchRmi(terminal, { signalType: e.target.value as "SMA" | "EMA" })
                }
                aria-label="RMI signal type"
                className="rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--wl-text)]"
              >
                <option value="EMA">EMA</option>
                <option value="SMA">SMA</option>
              </select>
              <input
                type="color"
                value={config.rmi.rmiColor}
                onChange={(e) => patchRmi(terminal, { rmiColor: e.target.value })}
                aria-label="RMI line colour"
                title="RMI line"
                className="h-5 w-6 cursor-pointer rounded-[3px] border border-[var(--wl-border)] bg-transparent p-0"
              />
              <input
                type="color"
                value={config.rmi.signalColor}
                onChange={(e) => patchRmi(terminal, { signalColor: e.target.value })}
                aria-label="RMI signal colour"
                title="Signal line"
                className="h-5 w-6 cursor-pointer rounded-[3px] border border-[var(--wl-border)] bg-transparent p-0"
              />
              <select
                value={config.rmi.width}
                onChange={(e) => patchRmi(terminal, { width: Number(e.target.value) })}
                aria-label="RMI thickness"
                className="ml-auto rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--wl-text)]"
              >
                {[1, 2, 3].map((w) => (
                  <option key={w} value={w}>
                    {w}px
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-[var(--wl-muted)]">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n);
        }}
        aria-label={label}
        className="w-full rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1 py-0.5 text-[11px] tabular-nums text-[var(--wl-text)]"
      />
    </label>
  );
}
