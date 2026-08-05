"use client";

import { AlertTriangle, Ban } from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { pnl, strikeLabel } from "@/lib/scalper/format";
import type { StrikeCandidate } from "@/lib/strike-selector/types";
import { cn } from "@/lib/utils";

interface Props {
  candidates: StrikeCandidate[];
  best: StrikeCandidate | null;
  /** Rupee columns are per lot; the header says so once rather than every cell. */
  lotSize: number;
  isSpread: boolean;
}

/** Green under a third, red past a coin flip. */
function rateTone(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate < 0.35) return "text-emerald-600 dark:text-emerald-400";
  if (rate < 0.55) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function rateBar(rate: number | null): string {
  if (rate === null) return "bg-muted";
  if (rate < 0.35) return "bg-emerald-500";
  if (rate < 0.55) return "bg-amber-500";
  return "bg-red-500";
}

function moneynessTone(m: StrikeCandidate["moneyness"]): "blue" | "slate" | "amber" {
  return m === "ATM" ? "blue" : m === "ITM" ? "slate" : "amber";
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(0)}%`;
}

function pnlTone(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

export function StrikeTable({ candidates, best, lotSize, isSpread }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Strike</th>
            <th className="px-3 py-2 text-right font-medium">σ out</th>
            <th className="px-3 py-2 text-right font-medium">Delta</th>
            <th className="px-3 py-2 text-right font-medium">Pay</th>
            <th className="px-3 py-2 text-right font-medium">Spread</th>
            <th className="px-3 py-2 text-right font-medium" title="Move needed by exit just to scratch">
              Scratch
            </th>
            <th className="px-3 py-2 text-right font-medium">Capital</th>
            <th className="px-3 py-2 text-right font-medium">On target</th>
            <th className="px-3 py-2 text-right font-medium">Stopped</th>
            <th className="px-3 py-2 text-right font-medium">Expectancy</th>
            <th className="px-3 py-2 text-right font-medium">Needs to win</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const blocked = c.advisories.some((a) => a.severity === "block");
            const warned = c.advisories.some((a) => a.severity === "warn");
            const isBest = best?.strike === c.strike;
            const rate = c.breakevenHitRate;

            return (
              <tr
                key={c.strike}
                className={cn(
                  "border-b last:border-0 transition-colors",
                  isBest && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                  blocked && "opacity-50"
                )}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{strikeLabel(c.strike)}</span>
                    <Badge tone={moneynessTone(c.moneyness)}>{c.moneyness}</Badge>
                    {isBest ? <Badge tone="green">Pick</Badge> : null}
                    {blocked ? (
                      <Ban className="h-3.5 w-3.5 text-red-500" aria-label="Not playable" />
                    ) : warned ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="Carries a warning" />
                    ) : null}
                  </div>
                  {isSpread && c.shortStrike !== null ? (
                    <div className="text-[11px] text-muted-foreground">
                      short {strikeLabel(c.shortStrike)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.sigmaDistance >= 0 ? "+" : "−"}
                  {Math.abs(c.sigmaDistance).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{Math.abs(c.delta).toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.entryFill.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    c.spreadPct > 8 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                  )}
                >
                  {c.spreadPct.toFixed(1)}%
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    c.scratchSigma === null || c.scratchSigma > 1
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                  )}
                >
                  {c.scratchSigma === null ? "—" : `${c.scratchSigma.toFixed(2)}σ`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Math.round(c.capitalPerLot).toLocaleString("en-IN")}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pnlTone(c.outcomes.target.pnl))}>
                  {signedPct(c.outcomes.target.returnPct)}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pnlTone(c.outcomes.adverse.pnl))}>
                  {signedPct(c.outcomes.adverse.returnPct)}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pnlTone(c.expectancy))}>
                  {pnl(c.expectancy)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className={cn("h-full rounded-full", rateBar(rate))}
                        style={{ width: `${Math.min(100, (rate ?? 1) * 100)}%` }}
                      />
                    </div>
                    <span className={cn("w-14 text-right font-semibold tabular-nums", rateTone(rate))}>
                      {rate === null ? "never" : `${(rate * 100).toFixed(0)}%`}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Rupee columns are per lot of {lotSize}. <strong className="font-medium text-foreground">Pay</strong> is
        the ask you cross at entry{isSpread ? " net of the short leg" : ""};{" "}
        <strong className="font-medium text-foreground">on target</strong> and{" "}
        <strong className="font-medium text-foreground">stopped</strong> already unwind at the bid.{" "}
        <strong className="font-medium text-foreground">Scratch</strong> is the move needed by your exit time
        to get back to flat — not the expiry breakeven, which is the wrong yardstick for a hold this short.{" "}
        <strong className="font-medium text-foreground">Needs to win</strong> is the hit rate at which the
        strike stops losing money over a series — the only column that compares strikes fairly.
      </p>
    </div>
  );
}
