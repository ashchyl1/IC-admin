"use client";

/**
 * The one chart component all three panes use.
 *
 * Data flows in as plain arrays; everything imperative — series creation, price
 * lines, the sync registry — is kept behind refs so a tick does not rebuild the
 * chart. Closed bars are never re-sent: only the forming bar is `update()`d,
 * which is what keeps three live charts cheap.
 */

import * as React from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { registerChart, syncCrosshair, syncRange } from "@/lib/scalper/chartSync";
import type { Candle, IndicatorSeries, Level, VolumeProfileBin } from "@/lib/scalper/types";

const UP = "#22c55e";
const DOWN = "#f43f5e";
const GRID = "rgba(148,163,184,0.10)";
const TEXT = "#94a3b8";

// Shared empties. A default `[]` in the parameter list allocates a new array on
// every render, which would make the effects below re-run forever.
const NO_LEVELS: Level[] = [];
const NO_LINES: PositionLine[] = [];
const NO_PROFILE: VolumeProfileBin[] = [];

export interface PositionLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

interface Props {
  /** Stable id — also the sync-registry key. */
  id: string;
  /** Changing this forces a full reload rather than an incremental update. */
  seriesKey: string;
  candles: Candle[];
  indicators: IndicatorSeries;
  levels?: Level[];
  positionLines?: PositionLine[];
  profile?: VolumeProfileBin[];
  showIndicators: boolean;
  sync: boolean;
  /** The centre pane gets larger type and more vertical room for the price. */
  emphasis?: boolean;
  className?: string;
  onHover?: (candle: Candle | null) => void;
}

export function ScalpChart({
  id,
  seriesKey,
  candles,
  indicators,
  levels = NO_LEVELS,
  positionLines = NO_LINES,
  profile = NO_PROFILE,
  showIndicators,
  sync,
  emphasis = false,
  className,
  onHover,
}: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref = React.useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref = React.useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = React.useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = React.useRef<IPriceLine[]>([]);

  const dataRef = React.useRef({ key: "", length: 0 });
  const candlesRef = React.useRef<Candle[]>(candles);
  candlesRef.current = candles;
  const syncRef = React.useRef(sync);
  syncRef.current = sync;
  const hoverRef = React.useRef(onHover);
  hoverRef.current = onHover;

  const [profileRects, setProfileRects] = React.useState<{ y: number; w: number; poc: boolean }[]>([]);

  // ------------------------------------------------------------- create ---
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: TEXT,
        fontSize: emphasis ? 11 : 10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,0.18)",
        scaleMargins: { top: 0.08, bottom: emphasis ? 0.22 : 0.26 },
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.18)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: emphasis ? 7 : 5,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(56,189,248,0.5)", labelBackgroundColor: "#0369a1" },
        horzLine: { color: "rgba(56,189,248,0.5)", labelBackgroundColor: "#0369a1" },
      },
      localization: { locale: "en-IN" },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineColor: "rgba(148,163,184,0.6)",
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });

    const line = (color: string, width: 1 | 2) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    ema9Ref.current = line("#facc15", 1);
    ema20Ref.current = line("#a78bfa", 1);
    vwapRef.current = line("#38bdf8", 2);

    const unregister = registerChart(id, {
      chart,
      series: candleSeries,
      priceAt: (time) => {
        const match = candlesRef.current.find((c) => (c.time as unknown as Time) === time);
        return match ? match.close : null;
      },
    });

    const onRange = (range: LogicalRange | null) => {
      if (syncRef.current) syncRange(id, range);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    const onCrosshair = (param: { time?: Time }) => {
      if (syncRef.current) syncCrosshair(id, param.time);
      if (hoverRef.current) {
        const match = param.time
          ? candlesRef.current.find((c) => (c.time as unknown as Time) === param.time) ?? null
          : null;
        hoverRef.current(match);
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onCrosshair);
      unregister();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      ema9Ref.current = null;
      ema20Ref.current = null;
      vwapRef.current = null;
      priceLinesRef.current = [];
      dataRef.current = { key: "", length: 0 };
    };
  }, [id, emphasis]);

  // --------------------------------------------------------------- data ---
  React.useEffect(() => {
    const candleSeries = candleRef.current;
    const volumeSeries = volumeRef.current;
    if (!candleSeries || !volumeSeries || candles.length === 0) return;

    const full = dataRef.current.key !== seriesKey || dataRef.current.length !== candles.length;
    const last = candles[candles.length - 1];
    const bar = (c: Candle) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
    const vol = (c: Candle) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? "rgba(34,197,94,0.30)" : "rgba(244,63,94,0.30)",
    });

    if (full) {
      candleSeries.setData(candles.map(bar));
      volumeSeries.setData(candles.map(vol));
      dataRef.current = { key: seriesKey, length: candles.length };
      // A fresh instrument or timeframe should show the recent action, not
      // wherever the previous series happened to be scrolled to.
      chartRef.current?.timeScale().scrollToRealTime();
    } else {
      // Only the forming bar can have changed.
      candleSeries.update(bar(last));
      volumeSeries.update(vol(last));
    }

    const applyLine = (
      ref: React.MutableRefObject<ISeriesApi<"Line"> | null>,
      values: (number | null)[]
    ) => {
      const series = ref.current;
      if (!series) return;
      if (!showIndicators) {
        series.setData([]);
        return;
      }
      if (full) {
        series.setData(
          candles
            .map((c, i) => ({ time: c.time as UTCTimestamp, value: values[i] }))
            .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null && p.value !== undefined)
        );
      } else {
        const v = values[values.length - 1];
        if (v !== null && v !== undefined) series.update({ time: last.time as UTCTimestamp, value: v });
      }
    };

    applyLine(ema9Ref, indicators.ema9);
    applyLine(ema20Ref, indicators.ema20);
    applyLine(vwapRef, indicators.vwap);
  }, [candles, indicators, seriesKey, showIndicators]);

  // Re-send indicator lines when they are switched back on mid-session.
  React.useEffect(() => {
    dataRef.current = { ...dataRef.current, length: -1 };
  }, [showIndicators]);

  // -------------------------------------------------------- price lines ---
  React.useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    const created: IPriceLine[] = [];
    for (const level of levels) {
      created.push(
        series.createPriceLine({
          price: level.price,
          color: levelColor(level),
          lineWidth: 1,
          lineStyle: level.kind === "prevDay" ? LineStyle.Dashed : LineStyle.Dotted,
          axisLabelVisible: true,
          title: level.label,
        })
      );
    }
    for (const line of positionLines) {
      created.push(
        series.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: 2,
          lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: line.title,
        })
      );
    }
    priceLinesRef.current = created;
  }, [levels, positionLines]);

  // ----------------------------------------------------- volume profile ---
  React.useEffect(() => {
    const series = candleRef.current;
    if (!series || profile.length === 0) {
      // Keep the identity when already empty — a fresh [] here would re-trigger
      // this effect through the render it causes.
      setProfileRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const peak = Math.max(...profile.map((b) => b.volume)) || 1;
    const frame = requestAnimationFrame(() => {
      const rects: { y: number; w: number; poc: boolean }[] = [];
      for (const bin of profile) {
        const y = series.priceToCoordinate(bin.price);
        if (y === null) continue;
        rects.push({ y: Number(y), w: Math.max(2, (bin.volume / peak) * 100), poc: bin.isPoc });
      }
      setProfileRects(rects);
    });
    return () => cancelAnimationFrame(frame);
  }, [profile, candles]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={hostRef} className="h-full w-full" role="img" aria-label="Candlestick chart" />
      {profileRects.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-y-0 left-0 w-[110px]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          {profileRects.map((r, i) => (
            <rect
              key={i}
              x={0}
              y={Math.max(0, r.y - 3)}
              width={r.w}
              height={6}
              fill={r.poc ? "rgba(56,189,248,0.45)" : "rgba(148,163,184,0.22)"}
              rx={1}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}

function levelColor(level: Level): string {
  switch (level.kind) {
    case "resistance":
      return "rgba(244,63,94,0.75)";
    case "support":
      return "rgba(34,197,94,0.75)";
    case "prevDay":
      return "rgba(251,191,36,0.75)";
    case "openingRange":
      return "rgba(56,189,248,0.7)";
    default:
      return "rgba(148,163,184,0.7)";
  }
}
