"use client";

import { AlertTriangle, Ban, Info, Target } from "lucide-react";

import { Badge, Card } from "@/components/ui/primitives";
import { strikeLabel } from "@/lib/scalper/format";
import type { Advisory, SelectorResult, StrikeCandidate } from "@/lib/strike-selector/types";
import { cn } from "@/lib/utils";

function AdvisoryRow({ advisory }: { advisory: Advisory }) {
  const Icon = advisory.severity === "block" ? Ban : advisory.severity === "warn" ? AlertTriangle : Info;
  const tone =
    advisory.severity === "block"
      ? "text-red-600 dark:text-red-400"
      : advisory.severity === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <li className="flex gap-2 text-xs leading-relaxed">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
      <span className="text-muted-foreground">{advisory.message}</span>
    </li>
  );
}

export function AdvisoryList({ advisories }: { advisories: Advisory[] }) {
  if (advisories.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {advisories.map((a) => (
        <AdvisoryRow key={a.code} advisory={a} />
      ))}
    </ul>
  );
}

function rateTone(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate < 0.35) return "text-emerald-600 dark:text-emerald-400";
  if (rate < 0.55) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * The written verdict.
 *
 * The comparison against the furthest wing is the whole argument in one line:
 * the cheap strike is not cheap, it is a higher hurdle. Showing both numbers
 * next to each other is more persuasive than any amount of table.
 */
export function VerdictCard({ result, edgeOn }: { result: SelectorResult; edgeOn: boolean }) {
  const best = result.best;
  if (!best) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          No playable strike in this setup. Widen the grid or fix the blocking advisory above.
        </p>
      </Card>
    );
  }

  const wing = result.candidates[result.candidates.length - 1];
  const showWing: StrikeCandidate | null = wing && wing.strike !== best.strike ? wing : null;
  const bestRate = best.breakevenHitRate;
  const wingRate = showWing?.breakevenHitRate ?? null;
  const gap = bestRate !== null && wingRate !== null ? (wingRate - bestRate) * 100 : null;

  const rightLabel = result.right === "CE" ? "call" : "put";
  const isSpread = best.shortStrike !== null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/40 p-4">
        <div className="space-y-1">
          {/* The ranking basis changes with the edge toggle, so the label has to. */}
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            {edgeOn ? "Best return on capital" : "Lowest hurdle"}
          </div>
          <div className="text-xl font-bold tabular-nums">
            {strikeLabel(best.strike)} {result.right}
            {isSpread && best.shortStrike !== null ? (
              <span className="text-muted-foreground"> / {strikeLabel(best.shortStrike)}</span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {isSpread ? "Debit spread" : `Long ${rightLabel}`} · delta {Math.abs(best.delta).toFixed(2)} ·{" "}
            {Math.round(best.capitalPerLot).toLocaleString("en-IN")} per lot
          </p>
        </div>
        <div className="text-right">
          <div className={cn("text-3xl font-bold tabular-nums", rateTone(bestRate))}>
            {bestRate === null ? "—" : `${(bestRate * 100).toFixed(0)}%`}
          </div>
          <div className="text-xs text-muted-foreground">hit rate to break even</div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-sm leading-relaxed">
          Your signal has to be right{" "}
          <strong className="font-semibold">
            {bestRate === null ? "more often than is possible" : `${(bestRate * 100).toFixed(0)}% of the time`}
          </strong>{" "}
          for this strike to make money over a series. It needs a{" "}
          <strong className="font-semibold tabular-nums">
            {best.scratchSigma === null ? "—" : `${best.scratchSigma.toFixed(2)}σ`}
          </strong>{" "}
          move by your exit just to scratch —{" "}
          {best.scratchSigma !== null && best.scratchSigma <= 1
            ? "inside the move you already expect"
            : "more than the move you expect, so it needs the tail"}
          , because you cross a {best.spreadPct.toFixed(1)}% spread twice and pay decay in between.
        </p>

        {showWing && gap !== null ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
            The cheap wing is not cheaper.{" "}
            <strong className="font-semibold tabular-nums">{strikeLabel(showWing.strike)}</strong> costs only{" "}
            <strong className="font-semibold tabular-nums">
              {Math.round(showWing.capitalPerLot).toLocaleString("en-IN")}
            </strong>{" "}
            a lot against{" "}
            <strong className="font-semibold tabular-nums">
              {Math.round(best.capitalPerLot).toLocaleString("en-IN")}
            </strong>
            , and pays {showWing.outcomes.target.returnPct.toFixed(0)}% on target against{" "}
            {best.outcomes.target.returnPct.toFixed(0)}% — but it needs{" "}
            <strong className={cn("font-semibold tabular-nums", rateTone(wingRate))}>
              {wingRate === null ? "an impossible" : `${(wingRate * 100).toFixed(0)}%`}
            </strong>{" "}
            {wingRate === null ? "hit rate" : <>hit rate, {gap.toFixed(0)} points more.</>}
          </div>
        ) : null}

        {edgeOn ? (
          <p className="text-sm leading-relaxed">
            At the hit rate you asserted this strike returns{" "}
            <strong
              className={cn(
                "font-semibold tabular-nums",
                best.expectancy > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {best.expectancy >= 0 ? "+" : "−"}₹
              {Math.abs(Math.round(best.expectancy)).toLocaleString("en-IN")}
            </strong>{" "}
            per lot per trade, {(best.edgeRatio * 100).toFixed(1)}% of the capital you commit.
          </p>
        ) : null}

        {best.advisories.length > 0 ? (
          <div className="border-t pt-3">
            <AdvisoryList advisories={best.advisories} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function ScenarioLegend({ result }: { result: SelectorResult }) {
  return (
    <div className="flex flex-wrap gap-2">
      {result.scenarios.map((s) => (
        <Badge key={s.id} tone="slate" className="gap-1.5">
          <span>{s.label}</span>
          <span className="tabular-nums opacity-70">
            {s.sigmaMove >= 0 ? "+" : "−"}
            {Math.abs(s.sigmaMove).toFixed(2)}σ
          </span>
          <span className="tabular-nums font-semibold">{(s.probability * 100).toFixed(0)}%</span>
        </Badge>
      ))}
    </div>
  );
}
