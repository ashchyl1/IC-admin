"use client";

import * as React from "react";

import { UNDERLYINGS } from "@/lib/scalper/config";
import { compact, pct, price, timeframeLabel, toneFor } from "@/lib/scalper/format";
import { useSpotChart } from "@/lib/scalper/hooks";
import { useScalper } from "@/lib/scalper/store";
import type { Candle } from "@/lib/scalper/types";
import { ScalpChart } from "./ScalpChart";
import { Badge, Panel, clsx } from "./ui";

/**
 * The centre pane — the largest chart and the one carrying every level.
 *
 * The option legs tell you what you own; this tells you whether to own it, so
 * it gets the type size and the vertical space.
 */
export function SpotChartCard() {
  const underlying = useScalper((s) => s.underlying);
  const spot = useScalper((s) => s.snapshot?.spot);
  const timeframe = useScalper((s) => s.spotTimeframe);
  const showIndicators = useScalper((s) => s.showIndicators);
  const showProfile = useScalper((s) => s.showVolumeProfile);
  const sync = useScalper((s) => s.syncCharts);
  const chart = useSpotChart();

  const [hover, setHover] = React.useState<Candle | null>(null);

  const i = chart.candles.length - 1;
  const shown = hover ?? chart.candles[i];
  const spec = UNDERLYINGS[underlying];

  const byKind = React.useMemo(() => {
    const find = (label: string) => chart.levels.find((l) => l.label === label)?.price ?? null;
    return {
      pdh: find("PDH"),
      pdl: find("PDL"),
      orh: chart.levels.find((l) => l.kind === "openingRange" && l.label.startsWith("ORH"))?.price ?? null,
      orl: chart.levels.find((l) => l.kind === "openingRange" && l.label.startsWith("ORL"))?.price ?? null,
      resistance: chart.levels.filter((l) => l.kind === "resistance").map((l) => l.price),
      support: chart.levels.filter((l) => l.kind === "support").map((l) => l.price),
    };
  }, [chart.levels]);

  return (
    <Panel
      className="min-w-0 ring-1 ring-cyan-900/40"
      bodyClassName="flex flex-col min-h-0"
      title={
        <span className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-slate-200">{spec.label}</span>
          <span className="text-[10px] font-normal normal-case text-slate-500">spot index</span>
        </span>
      }
      right={
        <>
          {showProfile ? <Badge tone="cyan">Volume profile</Badge> : null}
          <Badge>{timeframeLabel(timeframe)}</Badge>
        </>
      }
    >
      <div className="shrink-0 border-b border-slate-800/70 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold leading-none text-slate-50">
              {spot ? price(spot.ltp) : "—"}
            </span>
            <span className={clsx("font-mono text-sm font-semibold", toneFor(spot?.change))}>
              {spot ? `${spot.change >= 0 ? "+" : "−"}${Math.abs(spot.change).toFixed(2)}` : "—"}{" "}
              {spot ? pct(spot.changePct) : ""}
            </span>
          </div>
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px]">
            <Metric label="VWAP" value={price(chart.indicators.vwap[i])} tone="text-sky-300" />
            <Metric label="9 EMA" value={price(chart.indicators.ema9[i])} tone="text-amber-300" />
            <Metric label="20 EMA" value={price(chart.indicators.ema20[i])} tone="text-violet-300" />
            <Metric label="Vol" value={spot ? compact(spot.volume) : "—"} />
          </dl>
        </div>

        <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[10px]">
          <Metric label="PDH" value={price(byKind.pdh)} tone="text-amber-300" small />
          <Metric label="PDL" value={price(byKind.pdl)} tone="text-amber-300" small />
          <Metric label="OR high" value={price(byKind.orh)} tone="text-cyan-300" small />
          <Metric label="OR low" value={price(byKind.orl)} tone="text-cyan-300" small />
          <Metric
            label="Resistance"
            value={byKind.resistance.length ? byKind.resistance.map((p) => price(p, 0)).join(" · ") : "—"}
            tone="text-rose-300"
            small
          />
          <Metric
            label="Support"
            value={byKind.support.length ? byKind.support.map((p) => price(p, 0)).join(" · ") : "—"}
            tone="text-emerald-300"
            small
          />
        </dl>
      </div>

      {shown ? (
        <div className="shrink-0 border-b border-slate-800/70 bg-slate-900/40 px-3 py-1 font-mono text-[10px] text-slate-400">
          O {shown.open.toFixed(2)} · H {shown.high.toFixed(2)} · L {shown.low.toFixed(2)} · C{" "}
          <span className="text-slate-200">{shown.close.toFixed(2)}</span> · V {compact(shown.volume)}
          {hover ? <span className="ml-1 text-cyan-400">(hover)</span> : null}
        </div>
      ) : null}

      <ScalpChart
        id="spot"
        seriesKey={`${underlying}-${timeframe}`}
        candles={chart.candles}
        indicators={chart.indicators}
        levels={chart.levels}
        profile={chart.profile}
        showIndicators={showIndicators}
        sync={sync}
        emphasis
        onHover={setHover}
        className="min-h-0 flex-1"
      />
    </Panel>
  );
}

function Metric({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className={clsx("uppercase tracking-wide text-slate-500", small ? "text-[10px]" : "text-[10px]")}>
        {label}
      </dt>
      <dd className={clsx("font-mono font-semibold", small ? "text-[10px]" : "text-[11px]", tone ?? "text-slate-300")}>
        {value}
      </dd>
    </div>
  );
}
