"use client";

/**
 * Indicator settings popover: Bollinger Bands, exponential moving averages,
 * VWAP and volume.
 *
 * The EMA rows are editable rather than fixed presets — 20/50/200 is a sensible
 * default set, but a wave analyst counting on an hourly chart wants 8/21, and
 * making them type a period is cheaper than shipping six checkboxes.
 */

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import type { BollingerSettings, EmaLine, IndicatorSettings } from "@/lib/wave/types";
import { Toggle, clsx } from "@/components/scalper/ui";

interface Props {
  settings: IndicatorSettings;
  onChange: (update: Partial<IndicatorSettings>) => void;
}

export function IndicatorMenu({ settings, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeCount =
    settings.emas.filter((line) => line.enabled).length +
    (settings.bollinger.enabled ? 1 : 0) +
    (settings.vwap ? 1 : 0);

  const setBollinger = (patch: Partial<BollingerSettings>) =>
    onChange({ bollinger: { ...settings.bollinger, ...patch } });

  const setEma = (id: string, patch: Partial<EmaLine>) =>
    onChange({ emas: settings.emas.map((line) => (line.id === id ? { ...line, ...patch } : line)) });

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        aria-expanded={open}
        title="Indicators — Bollinger Bands, EMAs, VWAP, volume"
        className={clsx(
          "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors",
          activeCount > 0
            ? "border-slate-700 bg-slate-800 text-slate-100"
            : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
        )}
      >
        <SlidersHorizontal className="h-3 w-3" />
        Indicators
        {activeCount > 0 ? (
          <span className="rounded bg-cyan-600/30 px-1 text-[9px] font-bold text-cyan-200">{activeCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-40 w-72 rounded-md border border-slate-700 bg-[#0f1725] p-3 shadow-2xl">
          <Section title="Bollinger Bands">
            <Toggle
              checked={settings.bollinger.enabled}
              onChange={(enabled) => setBollinger({ enabled })}
              label="Show bands"
            />
            {settings.bollinger.enabled ? (
              <div className="mt-2 space-y-1.5">
                <Field label="Period">
                  <NumberInput
                    value={settings.bollinger.period}
                    min={2}
                    max={400}
                    onChange={(period) => setBollinger({ period })}
                  />
                </Field>
                <Field label="Std dev">
                  <NumberInput
                    value={settings.bollinger.stdDev}
                    min={0.5}
                    max={5}
                    step={0.1}
                    onChange={(stdDev) => setBollinger({ stdDev })}
                  />
                </Field>
                <Field label="Source">
                  <select
                    aria-label="Bollinger source"
                    value={settings.bollinger.source}
                    onChange={(event) =>
                      setBollinger({ source: event.target.value as BollingerSettings["source"] })
                    }
                    className="h-6 w-24 rounded border border-slate-800 bg-slate-900 px-1 text-[11px] text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="close">Close</option>
                    <option value="hlc3">HLC/3</option>
                  </select>
                </Field>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Toggle
                    checked={settings.bollinger.showBasis}
                    onChange={(showBasis) => setBollinger({ showBasis })}
                    label="Basis"
                  />
                  <Toggle
                    checked={settings.bollinger.fill}
                    onChange={(fill) => setBollinger({ fill })}
                    label="Fill"
                  />
                </div>
              </div>
            ) : null}
          </Section>

          <Section title="Exponential moving averages">
            <div className="space-y-1.5">
              {settings.emas.map((line) => (
                <div key={line.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={line.enabled}
                    aria-label={`EMA ${line.period}`}
                    onClick={() => setEma(line.id, { enabled: !line.enabled })}
                    className={clsx(
                      "h-4 w-4 shrink-0 rounded-sm border transition-colors",
                      line.enabled ? "border-transparent" : "border-slate-600 bg-transparent"
                    )}
                    style={line.enabled ? { backgroundColor: line.color } : undefined}
                  />
                  <span className="text-[11px] text-slate-400">EMA</span>
                  <NumberInput
                    value={line.period}
                    min={2}
                    max={400}
                    onChange={(period) => setEma(line.id, { period })}
                  />
                  <input
                    type="color"
                    aria-label={`EMA ${line.period} colour`}
                    value={line.color}
                    onChange={(event) => setEma(line.id, { color: event.target.value })}
                    className="h-6 w-8 cursor-pointer rounded border border-slate-800 bg-slate-900"
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Other">
            <div className="flex flex-wrap gap-1.5">
              <Toggle
                checked={settings.vwap}
                onChange={(vwap) => onChange({ vwap })}
                label="VWAP"
                hint="Session-anchored volume-weighted average price"
              />
              <Toggle
                checked={settings.volume}
                onChange={(volume) => onChange({ volume })}
                label="Volume"
              />
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-800 pb-2.5 last:border-0 last:pb-0 [&+&]:pt-2.5">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
      {label}
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
      }}
      className="h-6 w-16 rounded border border-slate-800 bg-slate-900 px-1 text-right font-mono text-[11px] text-slate-100 focus:border-cyan-500 focus:outline-none"
    />
  );
}
