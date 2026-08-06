"use client";
import * as React from "react";
import { CalendarRange, FlaskConical, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DOC_RANGE,
  DOC_SUBTITLE,
  DOC_TITLE,
  HOW_TO_READ,
} from "@/lib/nifty-timeline/recommendations";
import {
  ACTIVE_RECOMMENDATIONS,
  DAILY_NOTE,
  DAILY_SOURCE,
  DAY_POINTS,
  REGIMES,
  formatDate,
  formatLevel,
} from "@/lib/nifty-timeline/series";
import { CHART_COLORS as C, DIRECTION_STYLE } from "./direction";
import { NiftyChart } from "./NiftyChart";
import { RecommendationPanel } from "./RecommendationPanel";

const LAST = DAY_POINTS[DAY_POINTS.length - 1];
const FIRST_COVERED = DAY_POINTS.find((p) => p.rec) ?? LAST;

/** Windows over the same series; the document only speaks for the middle one. */
const RANGES = [
  { id: "6m", label: "6M", from: () => DAY_POINTS[0].date },
  { id: "doc", label: "Document window", from: () => FIRST_COVERED.date },
  { id: "1m", label: "1M", from: () => DAY_POINTS[Math.max(0, DAY_POINTS.length - 22)].date },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

function LegendSwatch({ colour, children }: { colour: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {colour}
      <span>{children}</span>
    </span>
  );
}

/**
 * Six months of Nifty daily bars, wired to the recommendation that was live on
 * each of them: click a bar, read the call.
 *
 * The chart owns nothing but geometry. Selection lives here as a *date* rather
 * than an index, because switching range re-slices the series and an index
 * would quietly select a different day underneath the reader.
 */
export function NiftyTimeline() {
  const [rangeId, setRangeId] = React.useState<RangeId>("6m");
  const [selectedDate, setSelectedDate] = React.useState(LAST.date);

  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const points = React.useMemo(() => {
    const from = range.from();
    return DAY_POINTS.filter((p) => p.date >= from);
  }, [range]);

  // A day outside the new window snaps to its nearest edge rather than
  // vanishing, so narrowing the range never empties the panel.
  const selectedIndex = React.useMemo(() => {
    const exact = points.findIndex((p) => p.date === selectedDate);
    if (exact >= 0) return exact;
    return selectedDate < points[0].date ? 0 : points.length - 1;
  }, [points, selectedDate]);

  const selectedPoint = points[selectedIndex] ?? LAST;
  const activeRec = selectedPoint.rec;

  const live = DAILY_SOURCE === "yahoo";

  return (
    <div className="kite-theme -m-4 min-h-screen bg-background p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      {/* --------------------------------------------------------- header -- */}
      <header className="mb-4 border-b pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[3px] bg-primary/10 text-primary">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold leading-tight text-foreground">{DOC_TITLE}</h1>
            <p className="text-[13px] text-muted-foreground">
              {DOC_SUBTITLE} · {DOC_RANGE}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span
              title={DAILY_NOTE}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[11px] font-medium ring-1 ring-inset",
                live
                  ? "bg-buy/10 text-buy ring-buy/30"
                  : "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400"
              )}
            >
              {live ? <Radio className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />}
              {live ? "Live bars (^NSEI)" : "Reconstructed bars"}
            </span>

            <div
              role="group"
              aria-label="Chart range"
              className="flex items-center rounded-[3px] border p-0.5"
            >
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRangeId(r.id)}
                  aria-pressed={r.id === rangeId}
                  className={cn(
                    "rounded-[2px] px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    r.id === rangeId
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-3 max-w-4xl text-[12px] leading-relaxed text-muted-foreground">
          {HOW_TO_READ} Click any daily bar — or focus the chart and use the arrow keys — to read
          the call that was live when it printed.
        </p>

        {!live && (
          <p className="mt-2 max-w-4xl rounded-[3px] border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
            {DAILY_NOTE}
          </p>
        )}
      </header>

      {/* ---------------------------------------------------------- body --- */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-3">
          <NiftyChart
            points={points}
            selected={selectedIndex}
            onSelect={(i) => setSelectedDate(points[i].date)}
            regimes={REGIMES}
            activeRec={activeRec}
          />

          {/* ------------------------------------------------- legend ----- */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
            <LegendSwatch
              colour={<span className="h-2.5 w-2 rounded-[1px]" style={{ background: C.buy }} />}
            >
              Up day
            </LegendSwatch>
            <LegendSwatch
              colour={<span className="h-2.5 w-2 rounded-[1px]" style={{ background: C.sell }} />}
            >
              Down day
            </LegendSwatch>
            <LegendSwatch
              colour={
                <svg width="18" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="18"
                    y2="4"
                    stroke={C.buy}
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                </svg>
              }
            >
              Target
            </LegendSwatch>
            <LegendSwatch
              colour={
                <svg width="18" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="18"
                    y2="4"
                    stroke={C.sell}
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                </svg>
              }
            >
              Reversal
            </LegendSwatch>
            <LegendSwatch
              colour={
                <svg width="10" height="10" aria-hidden>
                  <path d="M5 0 L9.5 5 L5 10 L0.5 5 Z" fill={C.muted} />
                </svg>
              }
            >
              Call published
            </LegendSwatch>
            <span className="ml-auto">
              Band tint = published trend · shaded stripe = outside the document
            </span>
          </div>

          {/* --------------------------------------- the fifteen calls ---- */}
          <div>
            <h2 className="kite-label mb-1.5 px-1">
              {ACTIVE_RECOMMENDATIONS.length} calls in this document
            </h2>
            <div className="flex gap-1.5 overflow-x-auto pb-1 scroll-thin">
              {ACTIVE_RECOMMENDATIONS.map((rec) => {
                const firstSession = DAY_POINTS.find(
                  (p) => p.rec?.date === rec.date && p.isFirstSession
                );
                const isActive = activeRec?.date === rec.date;
                return (
                  <button
                    key={rec.date}
                    type="button"
                    onClick={() => firstSession && setSelectedDate(firstSession.date)}
                    aria-pressed={isActive}
                    className={cn(
                      "shrink-0 rounded-[3px] border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive ? "border-primary bg-primary/[0.07]" : "hover:bg-accent"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: DIRECTION_STYLE[rec.direction].swatch }}
                      />
                      <span className="text-[12px] font-medium text-foreground">
                        {formatDate(rec.date).replace(" 2026", "")}
                      </span>
                    </span>
                    <span className="mt-0.5 block whitespace-nowrap text-[11px] text-muted-foreground">
                      {rec.midWeek ? "Mid-week note" : rec.headline}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------- the text box -- */}
        {/* A definite height, not max-height: the panel's inner scroller is a
            flex child, and it can only scroll if the column it sits in has a
            height to measure against. Below xl the box just runs full length. */}
        <div className="min-w-0 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]">
          <RecommendationPanel point={selectedPoint} />
        </div>
      </div>

      <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
        Window {formatDate(points[0].date)} – {formatDate(LAST.date)} · {points.length} sessions ·
        close {formatLevel(LAST.close)}
      </p>
    </div>
  );
}
