"use client";

import * as React from "react";

import { compact, pct, price, timeframeLabel, toneFor } from "@/lib/scalper/format";
import { moneynessOf, useLegContract, useLegQuote, useOptionChart } from "@/lib/scalper/hooks";
import { useScalper } from "@/lib/scalper/store";
import { expiryLabel } from "@/lib/scalper/time";
import type { Candle, OptionType } from "@/lib/scalper/types";
import { ScalpChart, type PositionLine } from "./ScalpChart";
import { Badge, Panel, clsx } from "./ui";

/** Left (CE) and right (PE) panes. Identical instrumentation, mirrored colours. */
export function OptionChartCard({ leg }: { leg: OptionType }) {
  const contract = useLegContract(leg);
  const quote = useLegQuote(leg);
  const chart = useOptionChart(contract);
  const timeframe = useScalper((s) => s.optionTimeframe);
  const showIndicators = useScalper((s) => s.showIndicators);
  const sync = useScalper((s) => s.syncCharts);
  const spot = useScalper((s) => s.snapshot?.spot.ltp ?? 0);
  const position = useScalper((s) => (contract ? s.portfolio.positions[contract.symbol] : undefined));

  const [hover, setHover] = React.useState<Candle | null>(null);

  const positionLines = React.useMemo<PositionLine[]>(() => {
    if (!position) return [];
    const lines: PositionLine[] = [
      {
        price: position.averagePrice,
        color: position.quantity > 0 ? "#22c55e" : "#f43f5e",
        title: `${position.quantity > 0 ? "LONG" : "SHORT"} ${Math.abs(position.quantity)} @ ${position.averagePrice.toFixed(2)}`,
      },
    ];
    if (position.stopLoss !== null) {
      lines.push({ price: position.stopLoss, color: "#fb7185", title: "SL", dashed: true });
    }
    if (position.target !== null) {
      lines.push({ price: position.target, color: "#34d399", title: "TGT", dashed: true });
    }
    return lines;
  }, [position]);

  const last = chart.candles[chart.candles.length - 1];
  const i = chart.candles.length - 1;
  const shown = hover ?? last;

  const accent = leg === "CE" ? "text-emerald-300" : "text-rose-300";
  const moneyness = contract ? moneynessOf(contract, spot) : null;

  return (
    <Panel
      className="min-w-0"
      bodyClassName="flex flex-col min-h-0"
      title={
        <span className="flex items-center gap-1.5">
          <span className={clsx("font-mono text-[11px] font-bold", accent)}>
            {leg === "CE" ? "CALL" : "PUT"}
          </span>
          {contract ? (
            <span className="truncate font-mono text-[11px] text-slate-300">{contract.symbol}</span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </span>
      }
      right={
        <>
          {moneyness ? (
            <Badge tone={moneyness === "ITM" ? "green" : moneyness === "ATM" ? "cyan" : "slate"}>
              {moneyness}
            </Badge>
          ) : null}
          <Badge>{timeframeLabel(timeframe)}</Badge>
        </>
      }
    >
      <div className="shrink-0 border-b border-slate-800/70 px-2.5 py-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-bold text-slate-100">
              {quote ? price(quote.ltp) : "—"}
            </span>
            <span className={clsx("font-mono text-xs font-semibold", toneFor(quote?.change))}>
              {quote ? pct(quote.changePct) : "—"}
            </span>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              {contract ? `${expiryLabel(contract.expiry)} · ${contract.strike}` : "—"}
            </div>
            <div className="font-mono text-[11px] text-slate-400">
              {contract ? `${contract.lotSize} / lot` : ""}
            </div>
          </div>
        </div>

        <dl className="mt-1.5 grid grid-cols-4 gap-x-2 gap-y-0.5 text-[10px]">
          <Field label="Bid" value={quote ? price(quote.bid) : "—"} tone="text-emerald-300" />
          <Field label="Ask" value={quote ? price(quote.ask) : "—"} tone="text-rose-300" />
          <Field label="Vol" value={quote ? compact(quote.volume) : "—"} />
          <Field label="OI" value={quote ? compact(quote.openInterest) : "—"} />
          <Field label="VWAP" value={price(chart.indicators.vwap[i])} tone="text-sky-300" />
          <Field label="9 EMA" value={price(chart.indicators.ema9[i])} tone="text-amber-300" />
          <Field label="20 EMA" value={price(chart.indicators.ema20[i])} tone="text-violet-300" />
          <Field
            label="IV"
            value={quote ? `${(quote.iv * 100).toFixed(1)}%` : "—"}
          />
        </dl>
      </div>

      {shown ? (
        <div className="shrink-0 border-b border-slate-800/70 bg-slate-900/40 px-2.5 py-1 font-mono text-[10px] text-slate-400">
          O {shown.open.toFixed(2)} · H {shown.high.toFixed(2)} · L {shown.low.toFixed(2)} · C{" "}
          <span className="text-slate-200">{shown.close.toFixed(2)}</span>
          {hover ? <span className="ml-1 text-cyan-400">(hover)</span> : null}
        </div>
      ) : null}

      <ScalpChart
        id={`option-${leg}`}
        seriesKey={`${contract?.symbol ?? "none"}-${timeframe}`}
        candles={chart.candles}
        indicators={chart.indicators}
        positionLines={positionLines}
        showIndicators={showIndicators}
        sync={sync}
        onHover={setHover}
        className="min-h-0 flex-1"
      />
    </Panel>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className={clsx("font-mono font-semibold", tone ?? "text-slate-300")}>{value}</dd>
    </div>
  );
}
