"use client";

import * as React from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { PaperFill } from "@/lib/supabase/types";
import type { ReleasedCandle } from "@/lib/paper/types";
import { n } from "@/lib/paper/format";

type Props = {
  candles: ReleasedCandle[];
  fills: PaperFill[];
  timeZone: string;
  intraday: boolean;
  averageEntry: number;
  signedQuantity: number;
  onHover?: (candle: ReleasedCandle | null) => void;
};

/**
 * Candlestick + volume view of the replay.
 *
 * It is fed ONLY the candles the engine has released, so there is no way for a
 * future bar to reach the chart, the price scale, or anything derived from it.
 */
export function ReplayChart({
  candles,
  fills,
  timeZone,
  intraday,
  averageEntry,
  signedQuantity,
  onHover,
}: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = React.useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const entryLineRef = React.useRef<IPriceLine | null>(null);
  const hoverRef = React.useRef(onHover);
  hoverRef.current = onHover;

  // ---------------------------------------------------------------- setup ---
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const dark = document.documentElement.classList.contains("dark");
    const grid = dark ? "#1f2937" : "#e5e7eb";
    const text = dark ? "#9ca3af" : "#6b7280";
    const up = "#10b981";
    const down = "#ef4444";

    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: text, attributionLogo: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.08, bottom: 0.28 } },
      timeScale: { borderColor: grid, timeVisible: intraday, secondsVisible: false, rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "en-IN" },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      priceLineVisible: true, // current-price line
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      entryLineRef.current = null;
    };
  }, [intraday]);

  // Crosshair -> OHLC readout in the trading panel.
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byTime = new Map(candles.map((c) => [String(toTime(c.ts, timeZone, intraday)), c]));
    const handler = (param: { time?: Time }) => {
      hoverRef.current?.(param.time ? byTime.get(String(param.time)) ?? null : null);
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [candles, timeZone, intraday]);

  // ----------------------------------------------------------------- data ---
  React.useEffect(() => {
    const candleSeries = candleRef.current;
    const volumeSeries = volumeRef.current;
    if (!candleSeries || !volumeSeries) return;

    const rows = candles.map((c) => ({
      time: toTime(c.ts, timeZone, intraday),
      open: n(c.open),
      high: n(c.high),
      low: n(c.low),
      close: n(c.close),
      volume: n(c.volume),
    }));

    candleSeries.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    volumeSeries.setData(
      rows.map((r) => ({
        time: r.time,
        value: r.volume,
        color: r.close >= r.open ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)",
      }))
    );
  }, [candles, timeZone, intraday]);

  // -------------------------------------------------------------- markers ---
  React.useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;

    markers.setMarkers(
      fills
        .slice()
        .sort((a, b) => a.bar_index - b.bar_index)
        .map((f) => ({
          time: toTime(f.simulated_ts, timeZone, intraday),
          position: f.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
          color: f.side === "BUY" ? "#10b981" : "#ef4444",
          shape: f.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
          text: `${f.side} ${n(f.quantity)} @ ${n(f.fill_price).toFixed(2)}`,
        }))
    );
  }, [fills, timeZone, intraday]);

  // ---------------------------------------------- average-entry price line ---
  React.useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    if (entryLineRef.current) {
      series.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (signedQuantity !== 0 && averageEntry > 0) {
      entryLineRef.current = series.createPriceLine({
        price: averageEntry,
        color: signedQuantity > 0 ? "#10b981" : "#ef4444",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `avg entry ${signedQuantity > 0 ? "LONG" : "SHORT"}`,
      });
    }
  }, [averageEntry, signedQuantity]);

  return (
    <div
      ref={hostRef}
      className="h-[420px] w-full rounded-md border bg-card"
      role="img"
      aria-label="Replay candlestick chart with buy and sell markers"
    />
  );
}

/**
 * Lightweight Charts renders on a UTC axis. For intraday we shift each point by
 * the market zone's offset so the axis reads exchange wall-clock (09:15, not
 * 03:45). Daily bars use a business-day value and need no shift.
 */
function toTime(iso: string, timeZone: string, intraday: boolean): Time {
  const date = new Date(iso);
  if (!intraday) {
    const parts = zoneParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}` as Time;
  }
  return ((date.getTime() / 1000 + zoneOffsetSeconds(date, timeZone)) | 0) as UTCTimestamp;
}

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map as { year: string; month: string; day: string; hour: string; minute: string; second: string };
}

/** Offset of `timeZone` at `date`, in seconds. DST-aware. */
function zoneOffsetSeconds(date: Date, timeZone: string) {
  const p = zoneParts(date, timeZone);
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === "24" ? "00" : p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return Math.round((asUTC - date.getTime()) / 1000);
}
