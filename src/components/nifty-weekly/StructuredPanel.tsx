"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { formatIndex, type Bias, type Recommendation, type Trend } from "@/lib/nifty-weekly/schema";

/** Kite pills: green for the buy side, orange-red for the sell side. */
const BIAS_STYLES: Record<Bias, string> = {
  BUY: "bg-buy/10 text-buy ring-buy/30",
  SELL: "bg-sell/10 text-sell ring-sell/30",
  HOLD: "bg-muted text-muted-foreground ring-border",
  AVOID: "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400",
};

const TREND_STYLES: Record<Trend, string> = {
  Bullish: "text-buy",
  Bearish: "text-sell",
  Sideways: "text-muted-foreground",
  Neutral: "text-muted-foreground",
};

export function BiasPill({ bias, className }: { bias: Bias; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset",
        BIAS_STYLES[bias],
        className
      )}
    >
      {bias}
    </span>
  );
}

/** Small grey caption + value, the standard Kite panel unit. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="kite-label">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/**
 * One row of levels. Rendered as chips so a five-target list stays readable at
 * card width instead of running into a single comma-separated line.
 */
function LevelRow({
  label,
  levels,
  tone,
}: {
  label: string;
  levels: number[];
  tone: "buy" | "sell" | "target" | "invalid";
}) {
  const chip = {
    buy: "border-buy/25 bg-buy/[0.07] text-buy",
    sell: "border-sell/25 bg-sell/[0.07] text-sell",
    target: "border-primary/25 bg-primary/[0.07] text-primary",
    invalid: "border-border bg-muted text-muted-foreground line-through decoration-1",
  }[tone];

  return (
    <div>
      <div className="kite-label">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {levels.length === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          levels.map((lvl, i) => (
            <span
              key={`${lvl}-${i}`}
              className={cn(
                "kite-num rounded-[3px] border px-1.5 py-0.5 text-[13px] font-medium",
                chip
              )}
            >
              {formatIndex(lvl, 0)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** "17 Jul 2026" from a yyyy-mm-dd string, without a timezone shift. */
export function formatWeek(iso: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

interface Props {
  rec: Recommendation;
  /** The modal shows the full analysis; the card clamps it. */
  variant?: "card" | "detail";
}

export function StructuredPanel({ rec, variant = "card" }: Props) {
  const detail = variant === "detail";
  const up = (rec.changePoints ?? 0) >= 0;
  const hasChange = rec.changePoints !== null || rec.changePercent !== null;

  return (
    <div className="flex min-w-0 flex-col">
      {/* ------------------------------------------------ header ------- */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          {rec.symbol}
        </span>
        <span className="rounded-[3px] border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {rec.timeframe}
        </span>
        <BiasPill bias={rec.bias} />
        <span className="ml-auto text-[13px] text-muted-foreground">
          Week ending{" "}
          <span className="kite-num font-medium text-foreground">{formatWeek(rec.weekEnding)}</span>
        </span>
      </div>

      {/* ------------------------------------------------ price -------- */}
      {(rec.spotPrice !== null || hasChange) && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {rec.spotPrice !== null && (
            <span className="kite-num text-2xl font-semibold leading-none text-foreground">
              {formatIndex(rec.spotPrice)}
            </span>
          )}
          {hasChange && (
            <span className={cn("kite-num text-[13px] font-medium", up ? "text-buy" : "text-sell")}>
              {up ? "+" : "−"}
              {formatIndex(Math.abs(rec.changePoints ?? 0))}
              {rec.changePercent !== null && (
                <> ({up ? "+" : "−"}{formatIndex(Math.abs(rec.changePercent))}%)</>
              )}
            </span>
          )}
        </div>
      )}

      {/* ------------------------------------------------ trend/setup -- */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3.5">
        <Field label="Trend">
          <span className={cn("font-medium", TREND_STYLES[rec.trend])}>{rec.trend}</span>
        </Field>
        <Field label="Setup">
          <span className="font-medium text-foreground">{rec.setupStatus}</span>
        </Field>
      </div>

      {/* ------------------------------------------------ levels ------- */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t pt-3.5">
        <LevelRow label="Support" levels={rec.supportLevels} tone="buy" />
        <LevelRow label="Resistance" levels={rec.resistanceLevels} tone="sell" />
        <LevelRow label="Targets" levels={rec.targetLevels} tone="target" />
        <LevelRow label="Invalidation" levels={rec.invalidationLevels} tone="invalid" />
      </div>

      {/* ------------------------------------------------ analysis ----- */}
      {rec.analysis && (
        <div className="mt-3.5 border-t pt-3.5">
          <div className="kite-label">Analysis</div>
          <p
            className={cn(
              "mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground",
              !detail && "line-clamp-4"
            )}
          >
            {rec.analysis}
          </p>
        </div>
      )}
    </div>
  );
}
