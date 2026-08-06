"use client";
import * as React from "react";
import { Check, Copy, FileText, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISCLAIMER, daysSince } from "@/lib/nifty-timeline/recommendations";
import { formatDate, formatLevel, formatWeekday, type DayPoint } from "@/lib/nifty-timeline/series";
import { DIRECTION_STYLE } from "./direction";

/** A labelled block of the document's prose. Omitted when the field is blank. */
function TextBlock({ label, body }: { label: string; body: string }) {
  if (!body) return null;
  return (
    <section className="rounded-[3px] border bg-background px-3 py-2.5">
      <h4 className="kite-label">{label}</h4>
      <p className="mt-1.5 text-[13px] leading-[1.65] text-foreground">{body}</p>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="kite-label">{label}</div>
      <div className="kite-num mt-1 truncate text-[13px] font-medium">{children}</div>
    </div>
  );
}

/**
 * The text box the chart drives: everything the document published for the
 * selected day, in the document's own words.
 *
 * It is deliberately verbose. The point of clicking a bar is to read the call
 * that was live when that bar printed, so the panel shows the whole entry --
 * view, levels, reasoning, and what would have confirmed or invalidated it --
 * rather than a summary line that would send you back to the .docx anyway.
 */
export function RecommendationPanel({ point }: { point: DayPoint }) {
  const [copied, setCopied] = React.useState(false);
  const rec = point.rec;

  // Reset the tick whenever the reader moves to another day.
  React.useEffect(() => setCopied(false), [point.date]);

  const plainText = React.useMemo(() => {
    if (!rec) return "";
    const lines = [
      `Nifty — recommendation in force on ${formatDate(point.date)}`,
      `Published ${formatDate(rec.date)}${rec.midWeek ? " (mid-week contingency note)" : ""}`,
      "",
      `Published view: ${rec.publishedView}`,
      rec.explanatoryNote && `Explanatory note: ${rec.explanatoryNote}`,
      "",
      `Reason: ${rec.reason}`,
      "",
      `Confirmation / risk: ${rec.confirmation}`,
      rec.bankNifty && `\nBank Nifty / intermarket evidence: ${rec.bankNifty}`,
      "",
      rec.phase,
    ];
    return lines.filter(Boolean).join("\n");
  }, [rec, point.date]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const change = point.changePoints;
  const tone = change > 0 ? "text-buy" : change < 0 ? "text-sell" : "text-muted-foreground";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[3px] border bg-card">
      {/* ----------------------------------------------- the selected day --- */}
      <header className="border-b px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold text-foreground">
            {formatDate(point.date)}
          </span>
          <span className="text-[12px] text-muted-foreground">{formatWeekday(point.date)}</span>
          <span className={cn("kite-num ml-auto text-[15px] font-semibold", tone)}>
            {formatLevel(point.close)}
          </span>
          <span className={cn("kite-num text-[12px]", tone)}>
            {change >= 0 ? "+" : ""}
            {formatLevel(Math.round(change * 100) / 100)} (
            {point.changePercent >= 0 ? "+" : ""}
            {point.changePercent.toFixed(2)}%)
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <Stat label="Open">{formatLevel(point.open)}</Stat>
          <Stat label="High">{formatLevel(point.high)}</Stat>
          <Stat label="Low">{formatLevel(point.low)}</Stat>
          <Stat label="Close">{formatLevel(point.close)}</Stat>
        </div>
      </header>

      {/* ------------------------------------------------ the call itself --- */}
      {!rec ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <FileText className="h-7 w-7 text-muted-foreground" />
          <p className="text-[13px] font-medium text-foreground">
            No recommendation for this day
          </p>
          <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            The document&rsquo;s timeline opens on 3 May 2026. Bars before it are shown for
            context — the six-month window is wider than the casebook covers.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-[3px] px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                DIRECTION_STYLE[rec.direction].pill
              )}
            >
              {rec.trend}
            </span>
            {rec.midWeek && (
              <span className="inline-flex items-center rounded-[3px] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                Mid-week note
              </span>
            )}
            <button
              type="button"
              onClick={copy}
              className="ml-auto inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-buy" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy text"}
            </button>
          </div>

          <p className="mt-2 text-[12px] text-muted-foreground">
            Published <span className="font-medium text-foreground">{formatDate(rec.date)}</span> ·
            session {point.sessionOfCall} under this call · day{" "}
            {daysSince(rec.date, point.date)} after publication
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 rounded-[3px] border bg-background px-3 py-2.5 sm:grid-cols-3">
            <Stat label="Trend">{rec.headline}</Stat>
            <Stat label="Target">{rec.target}</Stat>
            <Stat label="Reversal">{rec.reversal}</Stat>
          </div>

          <div className="mt-2 space-y-2">
            <TextBlock label="Explanatory note" body={rec.explanatoryNote} />
            <TextBlock label="Reason" body={rec.reason} />
            <TextBlock label="Confirmation / risk" body={rec.confirmation} />
            <TextBlock label="Bank Nifty / intermarket evidence" body={rec.bankNifty} />
            <TextBlock label="At a glance" body={rec.primaryReason} />
          </div>

          <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            {rec.phase}
          </p>

          <p className="mt-3 flex gap-1.5 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{DISCLAIMER}</span>
          </p>
        </div>
      )}
    </div>
  );
}
