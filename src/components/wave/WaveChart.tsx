"use client";

/**
 * The chart surface.
 *
 * Lightweight Charts draws the price series and the indicators; every drawing
 * tool is rendered as an SVG overlay on top, positioned by asking the chart to
 * convert (bar index, price) into pixels. That split is deliberate — the
 * library has no drawing layer, and an overlay keeps label typography, hit
 * targets and drag handles in the DOM where they are cheap to style and easy to
 * make accessible.
 *
 * Points are stored in chart time and price, never in pixels, so a count
 * survives zooming, resizing, a switch to log scale, and a reload.
 */

import * as React from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { MarketCandle } from "@/lib/market/types";
import type { PositionLevels } from "@/lib/wave/paper-levels";
import { DEGREES, decorateLabel } from "@/lib/wave/degrees";
import { RETRACEMENT_LEVELS, EXTENSION_LEVELS } from "@/lib/wave/fib";
import { hitTest, type HitShape } from "@/lib/wave/hit";
import { computeIndicators, heikinAshi } from "@/lib/wave/indicators";
import { TOOLS, labelAt } from "@/lib/wave/patterns";
import { barIndexer, type Drawing, type TerminalData, type TerminalState, type WavePoint } from "@/lib/wave/types";
import { WaveOverlay, type OverlayShape } from "./WaveOverlay";
import { registerWaveChart, syncWaveCrosshair, syncWaveRange } from "@/lib/wave/chartSync";

const UP = "#22c55e";
const DOWN = "#f43f5e";
const GRID = "rgba(148,163,184,0.08)";
const TEXT = "#94a3b8";
const BB_LINE = "rgba(129,140,248,0.85)";
const BB_FILL = "rgba(129,140,248,0.10)";

interface Props {
  terminal: TerminalState;
  data: TerminalData;
  /** Open simulated positions on this terminal, drawn as entry/stop/target lines. */
  positions: PositionLevels[];
  draft: Drawing | null;
  /** Drawings whose hard rules fail — drawn with a warning outline. */
  invalidIds: Set<string>;
  focused: boolean;
  sync: boolean;
  onPlacePoint: (point: WavePoint) => void;
  onMovePoint: (drawingId: string, pointIndex: number, point: WavePoint) => void;
  onSelect: (drawingId: string | null) => void;
  onFocus: () => void;
  onHover: (candle: MarketCandle | null) => void;
}

interface DragState {
  drawingId: string;
  pointIndex: number;
  x: number;
  y: number;
}

export function WaveChart({
  terminal,
  data,
  positions,
  draft,
  invalidIds,
  focused,
  sync,
  onPlacePoint,
  onMovePoint,
  onSelect,
  onFocus,
  onHover,
}: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const priceRef = React.useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayRefs = React.useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = React.useRef<IPriceLine[]>([]);
  const positionLinesRef = React.useRef<IPriceLine[]>([]);

  const [shapes, setShapes] = React.useState<OverlayShape[]>([]);
  const [bandPath, setBandPath] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [cursor, setCursor] = React.useState<{ x: number; y: number } | null>(null);
  const [hoverHandle, setHoverHandle] = React.useState(false);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  const { candles } = data;
  const index = React.useMemo(() => barIndexer(candles), [candles]);
  const indicators = React.useMemo(
    () => computeIndicators(candles, terminal.indicators),
    [candles, terminal.indicators]
  );
  const display = React.useMemo(
    () => (terminal.chartType === "heikin" ? heikinAshi(candles) : candles),
    [candles, terminal.chartType]
  );

  // Latest values every imperative handler needs, without re-subscribing.
  const live = React.useRef({ terminal, candles, index, draft, onPlacePoint, onSelect, onFocus, onHover, sync });
  live.current = { terminal, candles, index, draft, onPlacePoint, onSelect, onFocus, onHover, sync };

  const drawing = terminal.activeTool !== "cursor";

  // ---------------------------------------------------------- create chart ---
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: TEXT,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,0.18)",
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.18)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 7,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(56,189,248,0.45)", labelBackgroundColor: "#0369a1" },
        horzLine: { color: "rgba(56,189,248,0.45)", labelBackgroundColor: "#0369a1" },
      },
      localization: { locale: "en-IN" },
    });
    chartRef.current = chart;

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeRef.current = volume;

    const measure = () =>
      setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volumeRef.current = null;
      overlayRefs.current = [];
      priceLinesRef.current = [];
      positionLinesRef.current = [];
    };
  }, []);

  // ------------------------------------------------- price series (by type) ---
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (priceRef.current) {
      chart.removeSeries(priceRef.current);
      priceRef.current = null;
      priceLinesRef.current = [];
      positionLinesRef.current = [];
    }

    const series =
      terminal.chartType === "line"
        ? chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2, priceLineVisible: true })
        : terminal.chartType === "area"
          ? chart.addSeries(AreaSeries, {
              lineColor: "#38bdf8",
              topColor: "rgba(56,189,248,0.28)",
              bottomColor: "rgba(56,189,248,0.02)",
              lineWidth: 2,
            })
          : terminal.chartType === "bars"
            ? chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN, thinBars: false })
            : chart.addSeries(CandlestickSeries, {
                upColor: UP,
                downColor: DOWN,
                borderUpColor: UP,
                borderDownColor: DOWN,
                wickUpColor: UP,
                wickDownColor: DOWN,
              });

    priceRef.current = series;
    return () => {
      // The next run of this effect removes it; nothing to do here beyond
      // dropping the reference so a stale series is never drawn to.
    };
  }, [terminal.chartType]);

  // Log scale is the default for wave work — see the store's comment.
  React.useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: terminal.scale === "log" ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [terminal.scale]);

  // -------------------------------------------------------------- set data ---
  React.useEffect(() => {
    const series = priceRef.current;
    const volume = volumeRef.current;
    if (!series || display.length === 0) return;

    if (terminal.chartType === "line" || terminal.chartType === "area") {
      series.setData(display.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    } else {
      series.setData(
        display.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    volume?.setData(
      terminal.indicators.volume
        ? display.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? "rgba(34,197,94,0.25)" : "rgba(244,63,94,0.25)",
          }))
        : []
    );
  }, [display, terminal.chartType, terminal.indicators.volume]);

  // ------------------------------------------------------------ indicators ---
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of overlayRefs.current) chart.removeSeries(series);
    overlayRefs.current = [];
    if (candles.length === 0) return;

    const addLine = (
      color: string,
      width: 1 | 2,
      values: (number | null)[],
      style: LineStyle = LineStyle.Solid
    ) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(
        candles
          .map((candle, i) => ({ time: candle.time as UTCTimestamp, value: values[i] }))
          .filter((point): point is { time: UTCTimestamp; value: number } => point.value != null)
      );
      overlayRefs.current.push(series);
    };

    const { bollinger } = indicators;
    if (bollinger) {
      // The band interior is drawn by the SVG overlay, not here: an Area series
      // fills from its line down to the price axis, which floods the whole
      // lower half of the chart rather than shading between the two bands.
      addLine(BB_LINE, 1, bollinger.upper);
      addLine(BB_LINE, 1, bollinger.lower);
      if (terminal.indicators.bollinger.showBasis) {
        addLine("rgba(129,140,248,0.55)", 1, bollinger.basis, LineStyle.Dashed);
      }
    }

    for (const line of indicators.emas) addLine(line.color, 2, line.values);
    if (indicators.vwap) addLine("#38bdf8", 2, indicators.vwap, LineStyle.Dotted);
  }, [candles, indicators, terminal.indicators.bollinger.showBasis]);

  // --------------------------------------------------- invalidation levels ---
  React.useEffect(() => {
    const series = priceRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    const selected = terminal.drawings.find((entry) => entry.id === terminal.selectedId);
    if (!selected || selected.points.length < 2) return;

    // Only the selected count's invalidation is drawn — six dotted lines from
    // six counts would make the chart unreadable.
    const level = invalidationLevel(selected);
    if (level === null) return;
    priceLinesRef.current = [
      series.createPriceLine({
        price: level,
        color: "rgba(248,113,113,0.8)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "invalidation",
      }),
    ];
  }, [terminal.drawings, terminal.selectedId, terminal.chartType]);

  // ------------------------------------------------------ position levels ---
  React.useEffect(() => {
    const series = priceRef.current;
    if (!series) return;

    for (const line of positionLinesRef.current) series.removePriceLine(line);
    positionLinesRef.current = [];

    // An open paper position is the one thing on this chart with money behind
    // it, so its levels are drawn solid while analysis stays dashed.
    positionLinesRef.current = positions.flatMap((position) =>
      position.levels.map((level) =>
        series.createPriceLine({
          price: level.price,
          color: level.color,
          lineWidth: 1,
          lineStyle: level.kind === "entry" ? LineStyle.Solid : LineStyle.Dotted,
          axisLabelVisible: true,
          title: level.title,
        })
      )
    );
  }, [positions, terminal.chartType]);

  // ------------------------------------------------------------ projection ---
  const project = React.useCallback(
    (point: WavePoint): { x: number; y: number } | null => {
      const chart = chartRef.current;
      const series = priceRef.current;
      if (!chart || !series) return null;
      // Projecting through the logical (bar) index rather than the timestamp
      // keeps pivots placeable to the right of the last bar, where a forecast
      // count has to live — `timeToCoordinate` returns null out there.
      const x = chart.timeScale().logicalToCoordinate(index.indexOf(point.time) as Logical);
      const y = series.priceToCoordinate(point.price);
      return x === null || y === null ? null : { x: Number(x), y: Number(y) };
    },
    [index]
  );

  const recompute = React.useCallback(() => {
    const chart = chartRef.current;
    const series = priceRef.current;
    if (!chart || !series) return;

    const all: OverlayShape[] = [];
    const entries: { drawing: Drawing; isDraft: boolean }[] = [
      ...terminal.drawings.filter((entry) => !entry.hidden).map((entry) => ({ drawing: entry, isDraft: false })),
      ...(draft ? [{ drawing: draft, isDraft: true }] : []),
    ];

    for (const { drawing: entry, isDraft } of entries) {
      const points = entry.points.map((point, i) => {
        const dragged =
          drag && drag.drawingId === entry.id && drag.pointIndex === i
            ? { x: drag.x, y: drag.y }
            : project(point);
        if (!dragged) return null;
        // Decorate here, not in the overlay: the whole point of degree notation
        // is that a Primary ③ is distinguishable from a Minute [iii] on the
        // chart itself. The origin is unlabelled and must stay that way.
        const base = labelAt(entry.tool, i);
        return { ...dragged, label: base ? decorateLabel(base, entry.degree) : "", index: i };
      });
      if (points.some((point) => point === null)) continue;

      all.push({
        id: entry.id,
        tool: entry.tool,
        degree: entry.degree,
        color: entry.color ?? DEGREES[entry.degree].color,
        selected: entry.id === terminal.selectedId,
        invalid: invalidIds.has(entry.id),
        draft: isDraft,
        showLabels: terminal.showLabels,
        points: points as { x: number; y: number; label: string; index: number }[],
        levels: levelsFor(entry, project),
        channel: entry.id === terminal.selectedId ? channelFor(entry, project) : null,
      });
    }
    setShapes(all);
    setBandPath(
      terminal.indicators.bollinger.enabled && terminal.indicators.bollinger.fill
        ? bollingerBandPath(chart, series, indicators.bollinger, candles.length)
        : null
    );
  }, [
    terminal.drawings,
    terminal.selectedId,
    terminal.showLabels,
    terminal.indicators.bollinger.enabled,
    terminal.indicators.bollinger.fill,
    indicators.bollinger,
    candles.length,
    draft,
    drag,
    invalidIds,
    project,
  ]);

  // Re-project on pan, zoom, resize, and whenever the model changes.
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onRange = (range: LogicalRange | null) => {
      recompute();
      if (live.current.sync) syncWaveRange(terminal.id, range);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const frame = requestAnimationFrame(recompute);

    return () => {
      cancelAnimationFrame(frame);
      // On unmount React runs cleanups in mount order, so the create effect has
      // already called `chart.remove()` by the time this runs. It nulls the ref
      // on the way out — that is the signal that the chart is gone.
      if (chartRef.current) chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
    };
  }, [recompute, terminal.id]);

  React.useEffect(() => {
    recompute();
  }, [size, display, terminal.scale, recompute]);

  // --------------------------------------------------------- chart events ---
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onMove = (param: MouseEventParams) => {
      const bars = live.current.candles;
      // `param.point` is set only while the pointer is inside the plot area, so
      // this doubles as the authoritative "is the cursor over the pane" test
      // that the click handler below relies on.
      paneCursorRef.current = param.point ? { x: param.point.x, y: param.point.y } : null;
      setCursor(paneCursorRef.current);

      const hovered = param.time
        ? bars.find((candle) => (candle.time as unknown as Time) === param.time) ?? null
        : null;
      live.current.onHover(hovered);
      if (live.current.sync) syncWaveCrosshair(terminal.id, param.time);
    };

    chart.subscribeCrosshairMove(onMove);
    return () => {
      if (!chartRef.current) return; // chart already disposed — see above
      chart.unsubscribeCrosshairMove(onMove);
    };
  }, [terminal.id]);

  /**
   * Point placement is handled here rather than through `chart.subscribeClick`.
   * The library discriminates clicks from double-clicks, so two pivots placed
   * within half a second collapse into one event and the second click is lost
   * — which is exactly the rhythm of laying down a five-wave count. Watching
   * pointerdown/pointerup ourselves keeps every click, and the movement
   * threshold below still lets a drag pan the chart instead of dropping a pivot.
   */
  const paneCursorRef = React.useRef<{ x: number; y: number } | null>(null);
  const pressRef = React.useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const pointFrom = React.useCallback((pane: { x: number; y: number }): WavePoint | null => {
    const chart = chartRef.current;
    const series = priceRef.current;
    if (!chart || !series) return null;
    const { candles: bars, index: idx, terminal: term } = live.current;

    const logical = chart.timeScale().coordinateToLogical(pane.x);
    const price = series.coordinateToPrice(pane.y);
    if (logical === null || price === null) return null;

    const barIndex = Math.round(Number(logical));
    const candle = bars[barIndex];

    // Magnet: land on the bar's own high or low, whichever the click is nearer.
    // Wave pivots are extremes — one placed a few pixels off the wick quietly
    // corrupts every ratio measured from it.
    if (term.magnet && candle) {
      return {
        time: candle.time,
        price:
          Math.abs(Number(price) - candle.high) <= Math.abs(Number(price) - candle.low)
            ? candle.high
            : candle.low,
      };
    }
    return { time: idx.timeAt(barIndex), price: Number(price) };
  }, []);

  // Register for cross-terminal sync once the price series exists.
  React.useEffect(() => {
    const chart = chartRef.current;
    const series = priceRef.current;
    if (!chart || !series) return;
    return registerWaveChart(terminal.id, {
      chart,
      series,
      priceAt: (time) => {
        const match = live.current.candles.find((candle) => (candle.time as unknown as Time) === time);
        return match ? match.close : null;
      },
    });
  }, [terminal.id, terminal.chartType]);

  // ---------------------------------------------------------------- drags ---
  /** Geometry the JS hit-test runs against — see `lib/wave/hit.ts`. */
  const hitShapes = React.useMemo<HitShape[]>(
    () =>
      shapes
        .filter((shape) => !shape.draft)
        .map((shape) => ({
          id: shape.id,
          points: shape.points.map((point) => ({ x: point.x, y: point.y })),
          fullWidth: shape.tool === "hline",
        })),
    [shapes]
  );

  const startDrag = React.useCallback(
    (drawingId: string, pointIndex: number, pane: { x: number; y: number }) => {
      const chart = chartRef.current;
      if (!chart) return;
      // Stop the chart panning under the pivot being moved. The option is read
      // on each move, so setting it now is in time for this gesture.
      chart.applyOptions({ handleScroll: false, handleScale: false });
      setDrag({ drawingId, pointIndex, x: pane.x, y: pane.y });
      onSelect(drawingId);
      onFocus();
    },
    [onSelect, onFocus]
  );

  const onOverlayPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      const pane = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
      if (drag) {
        setDrag({ ...drag, ...pane });
        return;
      }
      // Cursor affordance: show the grab hand only when a handle is under the
      // pointer, so a drawing's handles are discoverable without clicking.
      if (live.current.terminal.activeTool !== "cursor") return;
      const hit = hitTest(hitShapes, pane);
      const grab = hit !== null && hit.pointIndex !== null;
      setHoverHandle((current) => (current === grab ? current : grab));
    },
    [drag, hitShapes]
  );

  const endDrag = React.useCallback(() => {
    const chart = chartRef.current;
    const series = priceRef.current;
    if (!drag || !chart || !series) {
      setDrag(null);
      return;
    }
    chart.applyOptions({ handleScroll: true, handleScale: true });

    const logical = chart.timeScale().coordinateToLogical(drag.x);
    const price = series.coordinateToPrice(drag.y);
    if (logical !== null && price !== null) {
      const barIndex = Math.round(Number(logical));
      const candle = candles[barIndex];
      const point: WavePoint =
        terminal.magnet && candle
          ? {
              time: candle.time,
              price:
                Math.abs(Number(price) - candle.high) <= Math.abs(Number(price) - candle.low)
                  ? candle.high
                  : candle.low,
            }
          : { time: index.timeAt(barIndex), price: Number(price) };
      onMovePoint(drag.drawingId, drag.pointIndex, point);
    }
    setDrag(null);
  }, [drag, candles, index, terminal.magnet, onMovePoint]);

  // Rubber band from the last placed point to the cursor, so a half-drawn
  // pattern reads as in-progress rather than broken.
  const rubberBand = React.useMemo(() => {
    if (!draft || !cursor || draft.points.length === 0) return null;
    const from = project(draft.points[draft.points.length - 1]);
    return from ? { from, to: cursor } : null;
  }, [draft, cursor, project]);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      onFocus();
      pressRef.current = { x: event.clientX, y: event.clientY, dragging: drag !== null };
      if (live.current.terminal.activeTool !== "cursor") return;

      const rect = hostRef.current?.getBoundingClientRect();
      const pane = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
      const hit = hitTest(hitShapes, pane);
      if (hit && hit.pointIndex !== null) {
        event.preventDefault();
        pressRef.current = { x: event.clientX, y: event.clientY, dragging: true };
        startDrag(hit.drawingId, hit.pointIndex, pane);
      }
    },
    [onFocus, drag, hitShapes, startDrag]
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent) => {
      const press = pressRef.current;
      const wasDragging = drag !== null;
      pressRef.current = null;
      endDrag();

      if (!press || press.dragging || wasDragging) return;
      // A press that travelled is a pan, not a pivot.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;

      const term = live.current.terminal;
      const pane = paneCursorRef.current;
      if (term.activeTool === "cursor") {
        const rect = hostRef.current?.getBoundingClientRect();
        const at = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
        const hit = hitTest(hitShapes, at);
        // A click on a drawing selects it; a click on empty chart deselects.
        if (hit) live.current.onSelect(hit.drawingId);
        else if (term.selectedId) live.current.onSelect(null);
        return;
      }
      if (!pane) return;
      const point = pointFrom(pane);
      if (point) live.current.onPlacePoint(point);
    },
    [drag, endDrag, pointFrom, hitShapes]
  );

  return (
    <div
      className="relative min-h-0 flex-1"
      onPointerDown={onPointerDown}
      onPointerMove={onOverlayPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
    >
      <div
        ref={hostRef}
        className={`h-full w-full ${drawing ? "cursor-crosshair" : hoverHandle ? "cursor-grab" : ""}`}
        role="img"
        aria-label={`${terminal.title} ${terminal.interval} chart with ${terminal.drawings.length} wave drawings`}
      />
      <WaveOverlay
        width={size.width}
        height={size.height}
        shapes={shapes}
        bandPath={bandPath}
        rubberBand={rubberBand}
      />
      {focused ? (
        <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-sky-500/40" />
      ) : null}
    </div>
  );
}

/**
 * Polygon between the Bollinger upper and lower bands, over the visible range
 * only and sampled down to a few hundred points — a 1,000-bar path rebuilt on
 * every pan would be the most expensive thing on screen, and at one point per
 * two pixels nobody can see the difference.
 */
function bollingerBandPath(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  bands: { upper: (number | null)[]; lower: (number | null)[] } | null,
  barCount: number
): string | null {
  if (!bands || barCount === 0) return null;

  const range = chart.timeScale().getVisibleLogicalRange();
  const from = Math.max(0, Math.floor(range ? range.from : 0));
  const to = Math.min(barCount - 1, Math.ceil(range ? range.to : barCount - 1));
  if (to <= from) return null;

  const step = Math.max(1, Math.ceil((to - from) / 400));
  const upper: string[] = [];
  const lower: string[] = [];

  for (let i = from; i <= to; i += step) {
    const high = bands.upper[i];
    const low = bands.lower[i];
    if (high == null || low == null) continue;
    const x = chart.timeScale().logicalToCoordinate(i as Logical);
    const yHigh = series.priceToCoordinate(high);
    const yLow = series.priceToCoordinate(low);
    if (x === null || yHigh === null || yLow === null) continue;
    upper.push(`${Number(x).toFixed(1)},${Number(yHigh).toFixed(1)}`);
    lower.push(`${Number(x).toFixed(1)},${Number(yLow).toFixed(1)}`);
  }
  if (upper.length < 2) return null;

  return `M${upper.join("L")}L${lower.reverse().join("L")}Z`;
}

// ------------------------------------------------------------------ shapes ---

/** Fibonacci levels for the measurement tools, already projected to pixels. */
function levelsFor(
  drawing: Drawing,
  project: (point: WavePoint) => { x: number; y: number } | null
): OverlayShape["levels"] {
  if (drawing.tool === "fibRetracement" && drawing.points.length >= 2) {
    const [from, to] = drawing.points;
    const span = to.price - from.price;
    return RETRACEMENT_LEVELS.map((level) => {
      const price = to.price - span * level;
      const projected = project({ time: to.time, price });
      const start = project({ time: from.time, price });
      return projected && start
        ? { y: projected.y, x1: start.x, x2: projected.x, label: `${(level * 100).toFixed(1)}% · ${round(price)}` }
        : null;
    }).filter(Boolean) as OverlayShape["levels"];
  }

  if (drawing.tool === "fibExtension" && drawing.points.length >= 3) {
    const [a, b, c] = drawing.points;
    const span = b.price - a.price;
    return EXTENSION_LEVELS.map((level) => {
      const price = c.price + span * level;
      const projected = project({ time: c.time, price });
      const start = project({ time: b.time, price });
      return projected && start
        ? { y: projected.y, x1: start.x, x2: projected.x, label: `${level.toFixed(3).replace(/\.?0+$/, "")}× · ${round(price)}` }
        : null;
    }).filter(Boolean) as OverlayShape["levels"];
  }

  return [];
}

/** The 2–4 base line and its parallel through wave 3. */
function channelFor(
  drawing: Drawing,
  project: (point: WavePoint) => { x: number; y: number } | null
): OverlayShape["channel"] {
  if (drawing.tool !== "impulse" || drawing.points.length < 5) return null;
  const two = project(drawing.points[2]);
  const four = project(drawing.points[4]);
  const three = project(drawing.points[3]);
  if (!two || !four || !three) return null;

  const dx = four.x - two.x;
  const dy = four.y - two.y;
  if (dx === 0) return null;
  const offset = three.y - (two.y + (dy / dx) * (three.x - two.x));

  return {
    base: [two, four],
    parallel: [
      { x: two.x, y: two.y + offset },
      { x: four.x, y: four.y + offset },
    ],
  };
}

/** Mirrors `rules.ts`, kept here so the chart can draw the level without a full validation pass. */
function invalidationLevel(drawing: Drawing): number | null {
  if (drawing.tool === "impulse") {
    const diagonal = drawing.variant === "leadingDiagonal" || drawing.variant === "endingDiagonal";
    if (drawing.points.length >= 4 && !diagonal) return drawing.points[1].price;
    return drawing.points[0].price;
  }
  if (drawing.tool === "correction" && drawing.variant === "zigzag") return drawing.points[0].price;
  if (drawing.tool === "triangle" && drawing.points.length >= 4) return drawing.points[3].price;
  return null;
}

function round(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}

export { TOOLS };
