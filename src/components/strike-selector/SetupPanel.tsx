"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Card, Input, Label, Select } from "@/components/ui/primitives";
import { INSTRUMENT_PRESETS } from "@/lib/strike-selector/presets";
import type { Direction, SelectorInput, Structure } from "@/lib/strike-selector/types";
import { cn } from "@/lib/utils";

interface Props {
  presetId: string;
  input: SelectorInput;
  onPreset: (id: string) => void;
  onChange: (patch: Partial<SelectorInput>) => void;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-baseline justify-between text-xs">
        <span>{label}</span>
        {suffix ? <span className="font-normal text-muted-foreground">{suffix}</span> : null}
      </Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const next = e.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
        className="h-8 text-sm tabular-nums"
      />
      {hint ? <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SetupPanel({ presetId, input, onPreset, onChange }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const edgeOn = input.edgeHitRate !== null;

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-1">
        <Label className="text-xs">Contract</Label>
        <Select
          value={presetId}
          onChange={(e) => onPreset(e.target.value)}
          className="h-8 w-full text-sm"
        >
          {INSTRUMENT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.exchange} {p.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Signal</Label>
          <Segmented<Direction>
            value={input.direction}
            onChange={(direction) => onChange({ direction })}
            options={[
              { value: "BUY", label: "Buy" },
              { value: "SELL", label: "Sell" },
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Structure</Label>
          <Segmented<Structure>
            value={input.structure}
            onChange={(structure) => onChange({ structure })}
            options={[
              { value: "LONG_OPTION", label: "Outright" },
              { value: "DEBIT_SPREAD", label: "Spread" },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Underlying"
          value={input.price}
          onChange={(price) => onChange({ price })}
          step={input.tickSize}
          min={0}
          suffix="futures"
        />
        <NumberField
          label="ATM IV"
          value={Math.round(input.iv * 1000) / 10}
          onChange={(v) => onChange({ iv: v / 100 })}
          step={0.5}
          min={1}
          suffix="%"
        />
        <NumberField
          label="IV rank"
          value={input.ivRank}
          onChange={(ivRank) => onChange({ ivRank })}
          step={1}
          min={0}
          max={100}
          suffix="0-100"
        />
        <NumberField
          label="Days to expiry"
          value={input.dte}
          onChange={(dte) => onChange({ dte })}
          step={1}
          min={0}
          suffix="calendar"
        />
        <NumberField
          label="Holding period"
          value={input.holdHours}
          onChange={(holdHours) => onChange({ holdHours })}
          step={0.25}
          min={0.05}
          suffix="hours"
        />
        <NumberField
          label="Session length"
          value={input.sessionHours}
          onChange={(sessionHours) => onChange({ sessionHours })}
          step={0.25}
          min={1}
          suffix="hours"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t pt-3">
        <NumberField
          label="Target"
          value={input.targetSigma}
          onChange={(targetSigma) => onChange({ targetSigma })}
          step={0.1}
          min={0.1}
          suffix="sigma"
        />
        <NumberField
          label="Stop"
          value={input.stopSigma}
          onChange={(stopSigma) => onChange({ stopSigma })}
          step={0.1}
          min={0.1}
          suffix="sigma"
        />
      </div>

      <div className="space-y-2 border-t pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={edgeOn}
            onChange={(e) => onChange({ edgeHitRate: e.target.checked ? 0.5 : null })}
            className="h-3.5 w-3.5 rounded border-input accent-[hsl(var(--primary))]"
          />
          Assume my signal has an edge
        </label>
        {edgeOn ? (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Hit rate on target</span>
              <span className="font-semibold tabular-nums">
                {Math.round((input.edgeHitRate ?? 0) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={95}
              step={1}
              value={Math.round((input.edgeHitRate ?? 0) * 100)}
              onChange={(e) => onChange({ edgeHitRate: e.target.valueAsNumber / 100 })}
              className="w-full accent-[hsl(var(--primary))]"
              aria-label="Assumed hit rate on target"
            />
          </div>
        ) : (
          <p className="text-[11px] leading-tight text-muted-foreground">
            Off by default. With no edge the model is a pure cost model, and the required hit rate
            column tells you what your signal has to beat.
          </p>
        )}
      </div>

      <div className="border-t pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Contract &amp; model detail
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
        </button>
        {showAdvanced ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField
              label="Lot size"
              value={input.lotSize}
              onChange={(lotSize) => onChange({ lotSize })}
              step={1}
              min={1}
            />
            <NumberField
              label="Strike step"
              value={input.strikeStep}
              onChange={(strikeStep) => onChange({ strikeStep })}
              step={1}
              min={0.05}
            />
            <NumberField
              label="Tick size"
              value={input.tickSize}
              onChange={(tickSize) => onChange({ tickSize })}
              step={0.05}
              min={0.01}
            />
            <NumberField
              label="Min spread"
              value={input.minSpreadTicks}
              onChange={(minSpreadTicks) => onChange({ minSpreadTicks })}
              step={1}
              min={0}
              suffix="ticks"
              hint="The floor that makes cheap wings unplayable."
            />
            <NumberField
              label="IV move on target"
              value={Math.round(input.ivCrushOnTarget * 100)}
              onChange={(v) => onChange({ ivCrushOnTarget: v / 100 })}
              step={1}
              suffix="%"
              hint="Negative = vol crushes into your target."
            />
            <NumberField
              label="Smile curvature"
              value={input.smileCurvature}
              onChange={(smileCurvature) => onChange({ smileCurvature })}
              step={0.01}
              min={0}
              suffix="per sigma²"
            />
            <NumberField
              label="Strikes each side"
              value={input.strikesEachSide}
              onChange={(strikesEachSide) => onChange({ strikesEachSide: Math.round(strikesEachSide) })}
              step={1}
              min={1}
              max={10}
            />
            {input.structure === "DEBIT_SPREAD" ? (
              <NumberField
                label="Spread width"
                value={input.spreadWidthSigma}
                onChange={(spreadWidthSigma) => onChange({ spreadWidthSigma })}
                step={0.25}
                min={0.25}
                suffix="sigma"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
