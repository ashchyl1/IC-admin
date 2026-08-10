"use client";

/**
 * The price canvas for one terminal.
 *
 * Deliberately dumb: it takes bars and settings and draws them. No fetching, no
 * store access. Phase 3 will mount an SVG overlay over this for wave labels and
 * Fibonacci grids, which is why `onViewportChange` reports the coordinate
 * converters outward on every range change and resize — that overlay has to
 * redraw from them, and it cannot if the chart keeps them to itself.
 */

import * as React from "react";
import {
  AreaSeries,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { toHeikinAshi } from "@/lib/wave-lab/candles";
import type { MarketCandle } from "@/lib/wave-lab/types";
import type { SeriesStyle } from "@/lib/wave-lab/workspace-store";

/** Kite's palette (§10). Numbers carry the colour; the chrome does not. */
const KITE = {
  up: "#00b386",
  down: "#eb5b3c",
  grid: "#e5e5e5",
  text: "#9b9b9b",
  blue: "#387ed1",
} as const;

const DARK = {
  grid: "#333333",
  text: "#8a8a8a",
} as const;

export interface HoverReadout {
  candle: MarketCandle;
  /** Elliott time analysis counts bars, so the index must be visible (§3). */
  barIndex: number;
  changePercent: number;
}

interface Props {
  candles: MarketCandle[];
  style: SeriesStyle;
  logScale: boolean;
  showVolume: boolean;
  dark: boolean;
  onHover?: (readout: HoverReadout | null) => void;
}

export function PriceChart({ candles, style, logScale, showVolume, dark, onHover }: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const priceRef = React.useRef<ISeriesApi<"Candlestick" | "Line" | "Area"> | null>(null);
  const volumeRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);

  // Hover needs the current bars, but must not rebuild the chart when they
  // change — a ref keeps the subscription stable across data updates.
  const candlesRef = React.useRef(candles);
  candlesRef.current = candles;
  const onHoverRef = React.useRef(onHover);
  onHoverRef.current = onHover;

  // ---------------------------------------------------------------- chart ---
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const palette = dark ? DARK : { grid: KITE.grid, text: KITE.text };
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: palette.text,
        fontSize: 11,
        fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.grid, mode: logScale ? 1 : 0 },
      timeScale: { borderColor: palette.grid, rightOffset: 6, timeVisible: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: palette.text, width: 1, style: 3, labelBackgroundColor: KITE.blue },
        horzLine: { color: palette.text, width: 1, style: 3, labelBackgroundColor: KITE.blue },
      },
    });
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volumeRef.current = null;
    };
    // Rebuilding on theme or scale change is cheap and avoids a pile of
    // imperative applyOptions paths that drift out of sync.
  }, [dark, logScale]);

  // ------------------------------------------------------------- series ----
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (priceRef.current) chart.removeSeries(priceRef.current);
    if (volumeRef.current) {
      chart.removeSeries(volumeRef.current);
      volumeRef.current = null;
    }

    priceRef.current =
      style === "line"
        ? chart.addSeries(LineSeries, { color: KITE.blue, lineWidth: 2 })
        : style === "area"
          ? chart.addSeries(AreaSeries, {
              lineColor: KITE.blue,
              topColor: "rgba(56,126,209,0.22)",
              bottomColor: "rgba(56,126,209,0.02)",
              lineWidth: 2,
            })
          : chart.addSeries(CandlestickSeries, {
              upColor: KITE.up,
              downColor: KITE.down,
              borderUpColor: KITE.up,
              borderDownColor: KITE.down,
              wickUpColor: KITE.up,
              wickDownColor: KITE.down,
            });

    if (showVolume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      // Pin volume to the bottom fifth so it never crowds the price action.
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeRef.current = vol;
    }
  }, [style, showVolume]);

  // --------------------------------------------------------------- data ----
  React.useEffect(() => {
    const price = priceRef.current;
    if (!price) return;

    const source = style === "heikin-ashi" ? toHeikinAshi(candles) : candles;

    if (style === "line" || style === "area") {
      price.setData(source.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    } else {
      price.setData(
        source.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    volumeRef.current?.setData(
      source.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(0,179,134,0.35)" : "rgba(235,91,60,0.35)",
      }))
    );

    if (source.length) chartRef.current?.timeScale().fitContent();
  }, [candles, style, showVolume]);

  // -------------------------------------------------------------- hover ----
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: MouseEventParams<Time>) => {
      const report = onHoverRef.current;
      if (!report) return;
      if (!param.time || param.point === undefined) {
        report(null);
        return;
      }
      const bars = candlesRef.current;
      const index = bars.findIndex((c) => c.time === param.time);
      if (index < 0) {
        report(null);
        return;
      }
      const candle = bars[index];
      const prev = index > 0 ? bars[index - 1] : null;
      report({
        candle,
        barIndex: index,
        changePercent: prev && prev.close ? ((candle.close - prev.close) / prev.close) * 100 : 0,
      });
    };

    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, []);

  return <div ref={hostRef} className="h-full w-full" data-testid="wave-lab-chart" />;
}
