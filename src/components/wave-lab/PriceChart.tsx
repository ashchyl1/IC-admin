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
  BarSeries,
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

/**
 * The chart's coordinate converters, handed outward so the SVG overlay can
 * redraw from them (§1).
 *
 * The overlay cannot own these — only the chart knows where a price sits after
 * a pan, a zoom or a scale change — so it subscribes and re-renders whenever
 * `subscribe` fires.
 */
export interface ChartBridge {
  toScreen(point: { time: number; price: number }): { x: number; y: number } | null;
  toChart(point: { x: number; y: number }): { time: number; price: number } | null;
  /** Fires on visible-range change and on resize. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  size(): { width: number; height: number };
  /**
   * Freeze pan/zoom for the duration of a handle drag.
   *
   * Without this the same pointer movement that drags a pivot also scrolls the
   * chart underneath it, so the pivot appears to stick to the cursor while the
   * price behind it slides — which is §12.2's failure wearing a different hat.
   */
  setInteractive(enabled: boolean): void;
}

/** An indicator line drawn on the price pane (EMA, Bollinger edge). */
export interface OverlayLine {
  id: string;
  color: string;
  width: number;
  data: { time: number; value: number }[];
}

interface Props {
  candles: MarketCandle[];
  /** EMAs and Bollinger lines. Bollinger's *fill* is SVG — see §12.3. */
  lines?: OverlayLine[];
  style: SeriesStyle;
  logScale: boolean;
  showVolume: boolean;
  dark: boolean;
  onHover?: (readout: HoverReadout | null) => void;
  /** Called once the chart exists, and with null when it is torn down. */
  onBridge?: (bridge: ChartBridge | null) => void;
}

const NO_LINES: OverlayLine[] = [];

export function PriceChart({
  candles,
  lines = NO_LINES,
  style,
  logScale,
  showVolume,
  dark,
  onHover,
  onBridge,
}: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const priceRef = React.useRef<ISeriesApi<"Candlestick" | "Line" | "Area" | "Bar"> | null>(null);
  const volumeRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  /** Indicator lines, keyed by config id so only what changed is rebuilt. */
  const lineRefs = React.useRef(new Map<string, ISeriesApi<"Line">>());
  /** Overlay listeners, notified whenever the projection changes. */
  const bridgeListeners = React.useRef(new Set<() => void>());

  // Hover needs the current bars, but must not rebuild the chart when they
  // change — a ref keeps the subscription stable across data updates.
  const candlesRef = React.useRef(candles);
  candlesRef.current = candles;
  const onHoverRef = React.useRef(onHover);
  onHoverRef.current = onHover;
  const onBridgeRef = React.useRef(onBridge);
  onBridgeRef.current = onBridge;

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

    // ---- bridge -----------------------------------------------------------
    // Rebuilt with the chart, because every converter closes over this
    // instance. Handing a stale bridge to the overlay would project pivots
    // through a chart that no longer exists.
    const notify = () => bridgeListeners.current.forEach((l) => l());
    chart.timeScale().subscribeVisibleLogicalRangeChange(notify);
    const observer = new ResizeObserver(notify);
    observer.observe(host);

    const bridge: ChartBridge = {
      toScreen({ time, price }) {
        const series = priceRef.current;
        if (!series) return null;
        const y = series.priceToCoordinate(price);
        if (y === null) return null;

        const x = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
        if (x !== null) return { x, y };

        // Past the last bar there is no timestamp to look up, so the library
        // returns null. Extrapolate, exactly as toChart does in the other
        // direction — otherwise a pivot placed to the right of the data is
        // stored and rule-checked but never drawn, which is precisely where a
        // projected wave 5 goes.
        const bars = candlesRef.current;
        if (bars.length < 2) return null;
        const spacing = bars[bars.length - 1].time - bars[bars.length - 2].time;
        if (!spacing) return null;
        const lastIndex = bars.length - 1;
        const logical = lastIndex + (time - bars[lastIndex].time) / spacing;
        const extrapolatedX = chart.timeScale().logicalToCoordinate(logical as never);
        return extrapolatedX === null ? null : { x: extrapolatedX, y };
      },
      toChart({ x, y }) {
        const series = priceRef.current;
        if (!series) return null;
        const price = series.coordinateToPrice(y);
        if (price === null) return null;

        const time = chart.timeScale().coordinateToTime(x);
        if (time !== null) return { time: time as number, price };

        // Past the last bar, coordinateToTime returns null — there is no bar
        // there to name. Silently returning null makes the click vanish, which
        // is exactly what happens when someone places wave 5 out toward the
        // right edge. Extrapolate instead, from the logical index and the
        // series' own bar spacing.
        const logical = chart.timeScale().coordinateToLogical(x);
        const bars = candlesRef.current;
        if (logical === null || bars.length < 2) return null;

        const spacing = bars[bars.length - 1].time - bars[bars.length - 2].time;
        const lastIndex = bars.length - 1;
        const extrapolated = bars[lastIndex].time + (logical - lastIndex) * spacing;
        return { time: Math.round(extrapolated), price };
      },
      subscribe(listener) {
        bridgeListeners.current.add(listener);
        return () => bridgeListeners.current.delete(listener);
      },
      size: () => ({ width: host.clientWidth, height: host.clientHeight }),
      setInteractive(enabled) {
        chart.applyOptions({ handleScroll: enabled, handleScale: enabled });
      },
    };
    onBridgeRef.current?.(bridge);

    return () => {
      onBridgeRef.current?.(null);
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(notify);
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
          : style === "bars"
            ? // OHLC bars: open tick left, close tick right, coloured by
              // direction. `thinBars: false` keeps the ticks legible when the
              // chart is zoomed out.
              chart.addSeries(BarSeries, {
                upColor: KITE.up,
                downColor: KITE.down,
                thinBars: false,
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
    // `dark` and `logScale` are here because the chart effect above rebuilds
    // the whole chart when either changes, taking its series with it. Without
    // them this effect does not re-run, so the new chart ends up with no
    // series at all and priceRef points at a destroyed one — the chart goes
    // blank and every overlay stops projecting. Effects run in declaration
    // order within a commit, so the new chart already exists by the time this
    // runs.
  }, [style, showVolume, dark, logScale]);

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
    // Same reason as the series effect: a rebuilt chart needs its data back.
  }, [candles, style, showVolume, dark, logScale]);

  // --------------------------------------------------- indicator lines ----
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const live = lineRefs.current;

    // Drop series whose config has gone (indicator hidden or removed).
    for (const [id, series] of live) {
      if (!lines.some((l) => l.id === id)) {
        chart.removeSeries(series);
        live.delete(id);
      }
    }

    for (const line of lines) {
      let series = live.get(line.id);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: line.width as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        live.set(line.id, series);
      } else {
        series.applyOptions({ color: line.color, lineWidth: line.width as 1 | 2 | 3 | 4 });
      }
      series.setData(line.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }
  }, [lines, style, showVolume, dark, logScale]);

  // The chart is torn down whenever dark/logScale change, taking its series
  // with it — so the registry has to be emptied or the next pass tries to
  // reuse handles belonging to a destroyed chart.
  React.useEffect(() => {
    const live = lineRefs.current;
    return () => live.clear();
  }, [dark, logScale]);

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
