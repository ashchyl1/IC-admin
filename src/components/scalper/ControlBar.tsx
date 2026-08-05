"use client";

import * as React from "react";

import {
  OPTION_TIMEFRAMES,
  SPOT_TIMEFRAMES,
  SYNC_TIMEFRAMES,
  UNDERLYING_KEYS,
  UNDERLYINGS,
} from "@/lib/scalper/config";
import { strikeLabel } from "@/lib/scalper/format";
import { useScalper } from "@/lib/scalper/store";
import { expiryLabel } from "@/lib/scalper/time";
import type { Timeframe } from "@/lib/scalper/types";
import { Button, Segmented, Select, Toggle, clsx } from "./ui";

const NO_EXPIRIES: string[] = [];

export function ControlBar() {
  const underlying = useScalper((s) => s.underlying);
  const setUnderlying = useScalper((s) => s.setUnderlying);
  const expiry = useScalper((s) => s.expiry);
  const setExpiry = useScalper((s) => s.setExpiry);
  // NO_EXPIRIES, not a fresh []: a zustand selector that allocates on every
  // call never compares equal, and React spins on it until it bails out.
  const expiries = useScalper((s) => s.snapshot?.expiries ?? NO_EXPIRIES);
  const strike = useScalper((s) => s.strike);
  const atmStrike = useScalper((s) => s.snapshot?.atmStrike ?? null);
  const setStrike = useScalper((s) => s.setStrike);
  const stepStrike = useScalper((s) => s.stepStrike);
  const autoAtm = useScalper((s) => s.autoAtm);
  const snapToAtm = useScalper((s) => s.snapToAtm);
  const setAutoAtm = useScalper((s) => s.setAutoAtm);

  const syncCharts = useScalper((s) => s.syncCharts);
  const setSync = useScalper((s) => s.setSync);
  const spotTimeframe = useScalper((s) => s.spotTimeframe);
  const setSpotTimeframe = useScalper((s) => s.setSpotTimeframe);
  const optionTimeframe = useScalper((s) => s.optionTimeframe);
  const setOptionTimeframe = useScalper((s) => s.setOptionTimeframe);

  const showIndicators = useScalper((s) => s.showIndicators);
  const toggleIndicators = useScalper((s) => s.toggleIndicators);
  const showLevels = useScalper((s) => s.showLevels);
  const toggleLevels = useScalper((s) => s.toggleLevels);
  const showVolumeProfile = useScalper((s) => s.showVolumeProfile);
  const toggleVolumeProfile = useScalper((s) => s.toggleVolumeProfile);

  const instantOrder = useScalper((s) => s.instantOrder);
  const setInstantOrder = useScalper((s) => s.setInstantOrder);

  const [instantPrompt, setInstantPrompt] = React.useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = React.useState(false);

  const step = UNDERLYINGS[underlying].strikeStep;
  const strikeOptions = React.useMemo(() => {
    if (atmStrike === null) return [];
    const out: number[] = [];
    for (let i = -10; i <= 10; i += 1) out.push(atmStrike + i * step);
    if (strike !== null && !out.includes(strike)) out.push(strike);
    return out.sort((a, b) => a - b);
  }, [atmStrike, step, strike]);

  const timeframeOptions: Timeframe[] = syncCharts ? SYNC_TIMEFRAMES : SPOT_TIMEFRAMES;

  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-[#0d131c] px-3 py-1.5">
      <Segmented
        ariaLabel="Underlying"
        value={underlying}
        onChange={setUnderlying}
        options={UNDERLYING_KEYS.map((k) => ({ value: k, label: k }))}
      />

      <Divider />

      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Expiry
        <Select
          ariaLabel="Expiry date"
          value={expiry}
          onChange={setExpiry}
          options={expiries.map((iso) => ({ value: iso, label: expiryLabel(iso) }))}
        />
      </label>

      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-400">Strike</span>
        <Button
          tone="ghost"
          onClick={() => stepStrike(-1)}
          aria-label="Previous strike"
          className="w-7 px-0"
        >
          ‹
        </Button>
        <Select
          ariaLabel="ATM strike"
          value={strike === null ? "" : String(strike)}
          onChange={(v) => setStrike(Number(v))}
          options={strikeOptions.map((s) => ({
            value: String(s),
            label: s === atmStrike ? `${strikeLabel(s)} · ATM` : strikeLabel(s),
          }))}
          className="w-[122px] text-center"
        />
        <Button tone="ghost" onClick={() => stepStrike(1)} aria-label="Next strike" className="w-7 px-0">
          ›
        </Button>
      </div>

      <Button
        tone={autoAtm ? "accent" : "neutral"}
        onClick={autoAtm ? () => setAutoAtm(false) : snapToAtm}
        title={
          autoAtm
            ? "The pad follows the at-the-money strike as spot moves. Click to pin the current strike."
            : "Jump to the at-the-money strike and follow it"
        }
      >
        {autoAtm ? "Auto ATM ✓" : "Auto-select ATM"}
      </Button>

      <Divider />

      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        {syncCharts ? "All charts" : "Spot"}
        <Segmented
          ariaLabel="Chart timeframe"
          value={spotTimeframe}
          onChange={setSpotTimeframe}
          options={timeframeOptions.map((tf) => ({ value: tf, label: tf }))}
        />
      </label>

      {!syncCharts ? (
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          Options
          <Segmented
            ariaLabel="Option chart timeframe"
            value={optionTimeframe}
            onChange={setOptionTimeframe}
            options={OPTION_TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
          />
        </label>
      ) : null}

      <div className="relative">
        <Button
          tone={indicatorsOpen ? "accent" : "neutral"}
          onClick={() => setIndicatorsOpen((v) => !v)}
          aria-expanded={indicatorsOpen}
        >
          Indicators
        </Button>
        {indicatorsOpen ? (
          <>
            <button
              type="button"
              aria-label="Close indicators menu"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setIndicatorsOpen(false)}
            />
            <div className="absolute left-0 top-9 z-20 w-56 rounded-lg border border-slate-700 bg-[#111823] p-2 shadow-xl">
              <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Overlays
              </div>
              <div className="flex flex-col gap-1.5">
                <Toggle
                  checked={showIndicators}
                  onChange={toggleIndicators}
                  label="9 EMA · 20 EMA · VWAP"
                />
                <Toggle
                  checked={showLevels}
                  onChange={toggleLevels}
                  label="PDH/PDL, opening range, S/R"
                />
                <Toggle
                  checked={showVolumeProfile}
                  onChange={toggleVolumeProfile}
                  label="Horizontal volume profile"
                />
              </div>
              <p className="mt-2 px-1 text-[10px] leading-relaxed text-slate-500">
                Levels and the profile draw on the index chart. EMAs and VWAP draw on all three.
              </p>
            </div>
          </>
        ) : null}
      </div>

      <Divider />

      <Toggle
        checked={syncCharts}
        onChange={setSync}
        label="Sync charts"
        hint="Share one timeframe, zoom and crosshair across all three panes"
      />

      <Toggle
        checked={instantOrder}
        tone="warn"
        onChange={(next) => {
          if (next) setInstantPrompt(true);
          else setInstantOrder(false);
        }}
        label="Instant order"
        hint="Skip the confirmation dialog on buys"
      />

      {instantPrompt ? (
        <InstantOrderPrompt
          onAccept={() => {
            setInstantOrder(true);
            setInstantPrompt(false);
          }}
          onCancel={() => setInstantPrompt(false)}
        />
      ) : null}
    </div>
  );
}

function Divider() {
  return <span className="h-5 w-px bg-slate-800" aria-hidden="true" />;
}

/**
 * Instant mode is off by default and stays off until this is accepted. A
 * scalping pad wired to the arrow keys with no confirmation step is exactly how
 * an accidental keypress becomes a position.
 */
function InstantOrderPrompt({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => ref.current?.focus(), []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="instant-title"
    >
      <div className="w-full max-w-md rounded-xl border border-amber-700/60 bg-[#141a24] p-5 shadow-2xl">
        <h2 id="instant-title" className="text-sm font-bold text-amber-300">
          Enable instant orders?
        </h2>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-slate-300">
          <p>With instant orders on, a buy fills the moment you click or press an arrow key. There is no confirmation step and no undo.</p>
          <p>
            The arrow keys are live: <strong className="text-slate-100">↑</strong> buys a call and{" "}
            <strong className="text-slate-100">↓</strong> buys a put.
          </p>
          <p className="text-slate-400">
            Selling an option still asks for confirmation while &ldquo;Confirm before selling&rdquo; is on
            in Settings — instant mode does not switch that off.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button tone="ghost" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={ref} tone="accent" size="md" onClick={onAccept} className={clsx("min-w-[9rem]")}>
            I understand — enable
          </Button>
        </div>
      </div>
    </div>
  );
}
