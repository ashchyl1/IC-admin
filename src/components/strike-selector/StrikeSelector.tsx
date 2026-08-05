"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui/primitives";
import { evaluate } from "@/lib/strike-selector/engine";
import { defaultInput, presetById } from "@/lib/strike-selector/presets";
import type { SelectorInput } from "@/lib/strike-selector/types";
import { cn } from "@/lib/utils";

import { SetupPanel } from "./SetupPanel";
import { StrikeTable } from "./StrikeTable";
import { AdvisoryList, ScenarioLegend, VerdictCard } from "./VerdictCard";

const INITIAL_PRESET = "mcx-silver";

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate text-lg font-bold tabular-nums",
          tone === "up" && "text-emerald-600 dark:text-emerald-400",
          tone === "down" && "text-red-600 dark:text-red-400"
        )}
      >
        {value}
      </div>
      {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function StrikeSelector() {
  const [presetId, setPresetId] = useState(INITIAL_PRESET);
  const [input, setInput] = useState<SelectorInput>(() => defaultInput(presetById(INITIAL_PRESET)));

  const result = useMemo(() => evaluate(input), [input]);
  const blocked = result.advisories.filter((a) => a.severity === "block");
  const notes = result.advisories.filter((a) => a.severity !== "block");

  function onChange(patch: Partial<SelectorInput>) {
    setInput((prev) => ({ ...prev, ...patch }));
  }

  /** Swapping contracts keeps how you trade and replaces only what you trade. */
  function onPreset(id: string) {
    setPresetId(id);
    setInput((prev) => ({
      ...defaultInput(presetById(id)),
      direction: prev.direction,
      structure: prev.structure,
      holdHours: prev.holdHours,
      targetSigma: prev.targetSigma,
      stopSigma: prev.stopSigma,
      edgeHitRate: prev.edgeHitRate,
      ivRank: prev.ivRank,
      dte: prev.dte,
      strikesEachSide: prev.strikesEachSide,
    }));
  }

  const preset = presetById(presetId);
  const favourWord = input.direction === "BUY" ? "above" : "below";

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Strike Selector</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          A directional call fixes the right — buy is a call, sell is a put. What is left to decide is the
          strike, the expiry and the structure. This ranks them by the hit rate each one needs before it
          stops losing money, which is the only comparison that survives repetition.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <SetupPanel presetId={presetId} input={input} onPreset={onPreset} onChange={onChange} />
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="divide-y sm:grid sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <Stat
              label="Expected move (1σ)"
              value={`₹${result.sigmaHold.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              sub={`${result.sigmaHoldPct.toFixed(2)}% over ${input.holdHours}h`}
            />
            <Stat
              label="Target"
              value={result.targetPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              sub={`${input.targetSigma}σ ${favourWord} spot`}
              tone="up"
            />
            <Stat
              label="Stop"
              value={result.stopPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              sub={`${input.stopSigma}σ against you`}
              tone="down"
            />
            <Stat
              label="At the money"
              value={`${result.atmStrike.toLocaleString("en-IN")} ${result.right}`}
              sub={`${input.dte}d to expiry · lot ${input.lotSize}`}
            />
          </Card>

          {blocked.length > 0 ? (
            <Card className="border-red-500/40 bg-red-500/5 p-4">
              <AdvisoryList advisories={blocked} />
            </Card>
          ) : null}

          <VerdictCard result={result} edgeOn={input.edgeHitRate !== null} />

          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Exit states</h2>
              <span className="text-[11px] text-muted-foreground">
                {input.edgeHitRate === null ? "Model probabilities, no edge assumed" : "Rescaled to your asserted edge"}
              </span>
            </div>
            <ScenarioLegend result={result} />
            {notes.length > 0 ? (
              <div className="border-t pt-3">
                <AdvisoryList advisories={notes} />
              </div>
            ) : null}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">
                {preset.exchange} {preset.label} · {result.right} ladder
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {input.structure === "DEBIT_SPREAD"
                  ? `Debit spreads, short leg ${input.spreadWidthSigma}σ further out`
                  : "Outright long options"}
              </span>
            </div>
            <StrikeTable
              candidates={result.candidates}
              best={result.best}
              lotSize={input.lotSize}
              isSpread={input.structure === "DEBIT_SPREAD"}
            />
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">How this is calculated</h2>
            <ul className="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li>
                Premiums use Black-76, the model for options on futures, on a smile in standardised
                moneyness. A strike&apos;s IV slides along that smile as the underlying moves, so its vol at
                exit is not its vol at entry.
              </li>
              <li>
                The expected move scales by <strong className="text-foreground">trading</strong> hours
                ({input.sessionHours}h a session), because an intraday window only accrues the volatility of
                the hours the contract is open. Decay runs in calendar time, which is how IV is quoted.
              </li>
              <li>
                Every round trip pays the spread twice — entry at the ask, exit at the bid — with a floor of{" "}
                {input.minSpreadTicks} ticks. That floor, not probability alone, is what makes cheap wings
                unplayable.
              </li>
              <li>
                Hitting your target usually <strong className="text-foreground">lowers</strong> implied vol
                ({Math.round(input.ivCrushOnTarget * 100)}% here), which is how a correct directional call
                still loses money on a long option.
              </li>
              <li>
                Probabilities are terminal, not path-aware: a stop touched by a wick that later recovers is
                not modelled, so treat the required hit rates as a floor rather than a promise.
              </li>
            </ul>
            <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
              A decision aid, not advice. It prices the setup you describe — it does not know whether your
              signal is any good, which is exactly what the &ldquo;needs to win&rdquo; column asks you to be
              honest about.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
