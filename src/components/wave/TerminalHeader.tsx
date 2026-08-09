"use client";

/**
 * Per-terminal control strip: instrument, interval, chart type, price scale,
 * indicators, and the data-source badge.
 *
 * The source badge is not decoration. A wave count drawn on synthetic prices
 * looks exactly like one drawn on the real market, so the pane says which it is
 * at all times, and says it loudly when the answer is "simulated".
 */

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import type { Instrument, Interval } from "@/lib/market/types";
import { INTERVALS, INTERVAL_KEYS } from "@/lib/market/types";
import { CHART_TYPES, type ChartType, type PriceScaleKind, type TerminalData, type TerminalState } from "@/lib/wave/types";
import { Badge, Button, Segmented, Select, clsx } from "@/components/scalper/ui";
import { IndicatorMenu } from "./IndicatorMenu";
import { SymbolSearch } from "./SymbolSearch";

interface Props {
  terminal: TerminalState;
  data: TerminalData;
  hovered: { close: number; time: number } | null;
  onSymbol: (instrument: Instrument) => void;
  onInterval: (interval: Interval) => void;
  onChartType: (chartType: ChartType) => void;
  onScale: (scale: PriceScaleKind) => void;
  onIndicators: (update: Partial<TerminalState["indicators"]>) => void;
  onReload: () => void;
}

/** Intervals offered in the quick strip; the rest live in the dropdown. */
const QUICK: Interval[] = ["15minute", "60minute", "day", "week"];

export function TerminalHeader({
  terminal,
  data,
  hovered,
  onSymbol,
  onInterval,
  onChartType,
  onScale,
  onIndicators,
  onReload,
}: Props) {
  const last = data.candles[data.candles.length - 1];
  const previous = data.candles[data.candles.length - 2];
  const shown = hovered?.close ?? last?.close ?? null;
  const change = shown !== null && previous ? shown - previous.close : null;

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-800/80 bg-[#0d141f] px-2 py-1.5">
      <SymbolSearch value={terminal.symbol} title={terminal.title} onPick={onSymbol} />

      <div className="flex items-baseline gap-1.5 px-1">
        <span className="font-mono text-sm font-bold text-slate-100">
          {shown === null ? "—" : shown.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
        {change !== null ? (
          <span
            className={clsx(
              "font-mono text-[11px] font-semibold",
              change >= 0 ? "text-emerald-400" : "text-rose-400"
            )}
          >
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}
          </span>
        ) : null}
      </div>

      <Segmented
        ariaLabel="Interval"
        value={QUICK.includes(terminal.interval) ? terminal.interval : QUICK[0]}
        onChange={(value) => onInterval(value)}
        options={QUICK.map((key) => ({ value: key, label: INTERVALS[key].label }))}
      />
      <Select
        ariaLabel="All intervals"
        value={terminal.interval}
        onChange={(value) => onInterval(value as Interval)}
        options={INTERVAL_KEYS.map((key) => ({ value: key, label: INTERVALS[key].label }))}
        className="w-[62px]"
      />

      <Select
        ariaLabel="Chart type"
        value={terminal.chartType}
        onChange={(value) => onChartType(value as ChartType)}
        options={CHART_TYPES.map((type) => ({ value: type.id, label: type.label }))}
        className="w-[96px]"
      />

      <Segmented
        ariaLabel="Price scale"
        value={terminal.scale}
        onChange={(value) => onScale(value)}
        options={[
          { value: "log" as PriceScaleKind, label: "Log", title: "Logarithmic — wave proportions are ratios, so this is the honest axis for multi-year counts" },
          { value: "linear" as PriceScaleKind, label: "Lin", title: "Linear price axis" },
        ]}
      />

      <IndicatorMenu settings={terminal.indicators} onChange={onIndicators} />

      <div className="ml-auto flex items-center gap-1.5">
        <SourceBadge data={data} />
        <Button
          tone="ghost"
          onClick={onReload}
          title="Reload history from the data provider"
          aria-label="Reload chart data"
        >
          <RefreshCw className={clsx("h-3 w-3", data.loading && "animate-spin")} />
        </Button>
      </div>
    </header>
  );
}

function SourceBadge({ data }: { data: TerminalData }) {
  if (data.loading && data.candles.length === 0) return <Badge tone="slate">Loading…</Badge>;
  if (data.error) {
    return (
      <Badge tone="red" title={data.error}>
        <AlertTriangle className="h-2.5 w-2.5" />
        Data error
      </Badge>
    );
  }
  if (!data.provider) return <Badge tone="slate">No data</Badge>;

  return (
    <span className="flex items-center gap-1">
      <Badge
        tone={data.provider.live ? "green" : "amber"}
        title={
          data.provider.live
            ? `${data.provider.label} — ${data.provider.detail ?? "connected"}`
            : "These prices are generated, not received from an exchange. Do not trade them."
        }
      >
        {data.provider.live ? data.provider.label : "Simulated"}
      </Badge>
      {data.warning ? (
        <Badge tone="amber" title={data.warning}>
          Fallback
        </Badge>
      ) : null}
      <span className="font-mono text-[10px] text-slate-500">{data.candles.length} bars</span>
    </span>
  );
}
