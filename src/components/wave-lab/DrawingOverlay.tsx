"use client";

/**
 * SVG overlay: wave labels, legs and handles, plus all pointer handling. §4.3.
 *
 * Two rules from §12 shape this whole component:
 *
 *  - The SVG is `pointer-events: none`. It has to be, or the chart underneath
 *    cannot be panned. So the browser will never hit-test it for us and every
 *    selection and drag is resolved by our own geometry (§12.2).
 *  - Pointer handling is `pointerdown`/`pointerup` on the container, not the
 *    charting library's click subscription. That subscription swallows
 *    alternate single clicks to discriminate double-clicks, so placing six
 *    pivots in a row silently loses three (§12.1).
 *
 * Labels are decorated at render from the drawing's current degree, never
 * stored decorated (§12.4).
 */

import * as React from "react";
import { decorateLabel, DEGREE_META } from "@/lib/wave-lab/drawings/degrees";
import {
  hitTest,
  isClick,
  type ScreenDrawing,
  type ScreenPoint,
} from "@/lib/wave-lab/drawings/hit-test";
import {
  DEFAULT_STYLE,
  TOOL_SPECS,
  dashArray,
  isChannel,
  labelForPivot,
  type Drawing,
} from "@/lib/wave-lab/drawings/tools";
import { channelGeometry, extendToEdges } from "@/lib/wave-lab/drawings/channels";
import { snapToExtreme } from "@/lib/wave-lab/drawings/snap";
import type { Pivot } from "@/lib/wave-lab/drawings/tools";
import { useDrawings } from "@/lib/wave-lab/drawings/store";
import { analyse } from "@/lib/wave-lab/analysis/rules";
import type { MarketCandle } from "@/lib/wave-lab/types";
import type { TerminalId } from "@/lib/wave-lab/workspace-store";
import type { ChartBridge } from "./PriceChart";

const COLOUR = {
  leg: "#387ed1",
  legPending: "#9b9b9b",
  selected: "#f6a821",
  handle: "#ffffff",
  label: "#222222",
  labelDark: "#eaeaea",
  invalid: "#ff5722",
} as const;

interface Props {
  terminal: TerminalId;
  bridge: ChartBridge | null;
  dark: boolean;
  /** Needed for the rule engine's bar counts behind the invalidation line. */
  candles: MarketCandle[];
}

export function DrawingOverlay({ terminal, bridge, dark, candles }: Props) {
  const drawings = useDrawings((s) => s.byTerminal[terminal]?.drawings ?? []);
  const activeTool = useDrawings((s) => s.activeTool);
  const pending = useDrawings((s) => s.pending);
  const selectedId = useDrawings((s) => s.selectedId);
  const addPivot = useDrawings((s) => s.addPivot);
  const magnet = useDrawings((s) => s.magnet);
  const select = useDrawings((s) => s.select);
  const beginDrag = useDrawings((s) => s.beginDrag);
  const movePivot = useDrawings((s) => s.movePivot);

  // Re-render whenever the chart's projection moves.
  //
  // `tick` is fed into the projection memos below, not just used to force a
  // render. The bridge exists before its converters work — they need the price
  // series — so a first pass can project nothing, and a memo keyed only on
  // [drawings, bridge] would stay frozen at that empty result. On a reload
  // with saved drawings that means the count never appears.
  const [tick, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => bridge?.subscribe(bump), [bridge]);

  const hostRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ drawingId: string; pointIndex: number } | null>(null);
  const downAtRef = React.useRef<ScreenPoint | null>(null);
  const [cursorHit, setCursorHit] = React.useState(false);

  const pendingPivots = pending?.terminal === terminal ? pending.pivots : [];

  // ---------------------------------------------------------- projection ---
  const project = React.useCallback(
    (d: Drawing): ScreenDrawing | null => {
      if (!bridge) return null;
      const points = d.pivots.map((p) => bridge.toScreen(p));
      // A drawing with any pivot scrolled off-screen still needs its visible
      // part drawn, so nulls become gaps rather than dropping the drawing.
      const usable = points.filter((p): p is ScreenPoint => p !== null);
      if (!usable.length) return null;
      return {
        id: d.id,
        kind: d.kind === "horizontal" ? "horizontal" : "polyline",
        points: usable,
      };
    },
    [bridge]
  );

  // Hidden and locked drawings are excluded from hit-testing entirely: hidden
  // ones are not on screen to aim at, and a locked one must not be grabbed —
  // that is the whole point of locking a reference channel you keep clicking
  // near.
  const screenDrawings = React.useMemo(
    () =>
      drawings
        .filter((d) => !d.hidden && !d.locked)
        .map(project)
        .filter((s): s is ScreenDrawing => s !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawings, project, tick]
  );

  // ------------------------------------------------------------- pointer ---
  React.useEffect(() => {
    const host = hostRef.current;
    // Listeners go on the CONTAINER, not on the overlay — §12.1 says so and
    // this is why: lightweight-charts stamps z-index 1 and 2 onto its
    // canvases, so they sit above an auto-z-index overlay and swallow every
    // real click. The overlay is pointer-events:none and purely visual;
    // events bubble up from the canvas to the container and we read them
    // there, which also leaves the chart free to pan and zoom natively.
    const surface = host?.parentElement ?? null;
    if (!host || !surface || !bridge) return;

    const local = (e: PointerEvent): ScreenPoint => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const point = local(e);
      downAtRef.current = point;

      // A tool being armed means the next click places a pivot; selection and
      // dragging are suspended so a click near an existing drawing does not
      // grab it instead of placing.
      if (activeTool) return;

      const hit = hitTest(point, screenDrawings, bridge.size().width);
      if (hit?.type === "handle") {
        dragRef.current = { drawingId: hit.drawingId, pointIndex: hit.pointIndex };
        select(hit.drawingId);
        beginDrag(terminal);
        bridge.setInteractive(false); // stop the chart panning under the drag
        surface.setPointerCapture(e.pointerId);
      }
    };

    const onMove = (e: PointerEvent) => {
      const point = local(e);
      const drag = dragRef.current;

      if (drag) {
        const chartPoint = bridge.toChart(point);
        if (chartPoint) {
          const placed = magnet ? snapToExtreme(chartPoint, candles, bridge).pivot : chartPoint;
          movePivot(terminal, drag.drawingId, drag.pointIndex, placed);
        }
        return;
      }
      if (activeTool) return;
      // Cursor affordance: without it there is no way to tell a grabbable
      // handle from empty chart, since the overlay cannot receive hover.
      setCursorHit(hitTest(point, screenDrawings, bridge.size().width) !== null);
    };

    const onUp = (e: PointerEvent) => {
      const point = local(e);
      const down = downAtRef.current;
      downAtRef.current = null;

      if (dragRef.current) {
        dragRef.current = null;
        bridge.setInteractive(true);
        if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
        return;
      }

      // Movement beyond the slop was a pan, not a click — §12.1.
      if (!down || !isClick(down, point)) return;

      if (activeTool) {
        const chartPoint = bridge.toChart(point);
        if (chartPoint) {
          // Snap on placement too, not only on drag — a pivot placed three
          // ticks off the real high poisons every ratio computed from it.
          addPivot(terminal, magnet ? snapToExtreme(chartPoint, candles, bridge).pivot : chartPoint);
        }
        return;
      }

      const hit = hitTest(point, screenDrawings, bridge.size().width);
      select(hit ? hit.drawingId : null);
    };

    // The cursor has to live on the container too, since the overlay is not a
    // pointer target and cannot show one.
    surface.style.cursor = activeTool ? "crosshair" : cursorHit ? "pointer" : "";
    // While a tool is armed, freeze pan/zoom so a slightly-dragged click still
    // places a pivot instead of scrolling the chart out from under it.
    bridge.setInteractive(!activeTool);

    // Capture phase, not bubble. lightweight-charts stops propagation inside
    // its own canvas handlers, so a bubble-phase listener on the container
    // never sees a real click — it only sees synthetic ones dispatched
    // straight at the element, which is precisely why this passed every
    // automated test and failed under an actual mouse. Capture runs before the
    // target, so nothing downstream can swallow it.
    const opts = { capture: true } as const;
    surface.addEventListener("pointerdown", onDown, opts);
    surface.addEventListener("pointermove", onMove, opts);
    surface.addEventListener("pointerup", onUp, opts);
    return () => {
      surface.style.cursor = "";
      surface.removeEventListener("pointerdown", onDown, opts);
      surface.removeEventListener("pointermove", onMove, opts);
      surface.removeEventListener("pointerup", onUp, opts);
    };
  }, [
    bridge,
    activeTool,
    screenDrawings,
    terminal,
    addPivot,
    select,
    beginDrag,
    movePivot,
    magnet,
    candles,
    cursorHit,
  ]);

  // Escape abandons a half-placed structure rather than stranding it.
  const cancelPending = useDrawings((s) => s.cancelPending);
  const setActiveTool = useDrawings((s) => s.setActiveTool);
  React.useEffect(() => {
    if (!activeTool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelPending();
        setActiveTool(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeTool, cancelPending, setActiveTool]);

  const size = bridge?.size() ?? { width: 0, height: 0 };
  const labelColour = dark ? COLOUR.labelDark : COLOUR.label;

  // The invalidation level for whatever is selected. §5 calls this the most
  // actionable output the app produces, so it is drawn on the chart rather
  // than left in a side panel.
  const selected = drawings.find((d) => d.id === selectedId) ?? null;
  const invalidation = React.useMemo(() => {
    if (!selected || !bridge) return null;
    const result = analyse(selected, candles);
    if (!result?.invalidation) return null;
    const at = bridge.toScreen({ time: selected.pivots[0].time, price: result.invalidation.price });
    return at ? { y: at.y, price: result.invalidation.price } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, candles, bridge, tick]);

  return (
    <div
      ref={hostRef}
      data-testid="wave-lab-overlay-host"
      // `auto` so the container receives pointer events; the SVG inside stays
      // `none` so the chart below still pans and zooms normally.
      className="absolute inset-0"
      style={{
        // Never a pointer target: the container below handles input, and
        // making this interactive would block the chart's own pan and zoom.
        pointerEvents: "none",
        // Above lightweight-charts' canvases, which carry z-index 1 and 2.
        // At `auto` the drawings paint *behind* the candles and wave labels
        // disappear wherever a candle happens to sit.
        zIndex: 3,
      }}
    >
      <svg
        width={size.width}
        height={size.height}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
        data-testid="wave-lab-overlay"
      >
        {invalidation && (
          <g data-testid="invalidation-line">
            <line
              x1={0}
              y1={invalidation.y}
              x2={size.width}
              y2={invalidation.y}
              stroke={COLOUR.invalid}
              strokeWidth={1}
              strokeDasharray="6 4"
            />
            <rect
              x={4}
              y={invalidation.y - 15}
              width={128}
              height={14}
              rx={2}
              fill={COLOUR.invalid}
              opacity={0.92}
            />
            <text x={8} y={invalidation.y - 4.5} fontSize={10} fontWeight={600} fill="#ffffff">
              INVALID BELOW{" "}
              {invalidation.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </text>
          </g>
        )}

        {drawings
          .filter((d) => !d.hidden)
          .map((d) =>
            isChannel(d.kind) ? (
              <DrawnChannel
                key={d.id}
                drawing={d}
                bridge={bridge}
                selected={d.id === selectedId}
                paneWidth={size.width}
              />
            ) : (
              <DrawnStructure
                key={d.id}
                drawing={d}
                bridge={bridge}
                selected={d.id === selectedId}
                labelColour={labelColour}
                paneWidth={size.width}
              />
            )
          )}

        {/* The structure currently being placed, in grey until committed. */}
        {activeTool && pendingPivots.length > 0 && bridge && (
          <PendingStructure
            kind={activeTool}
            pivots={pendingPivots}
            bridge={bridge}
            labelColour={labelColour}
          />
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------- rendering -- */

function DrawnStructure({
  drawing,
  bridge,
  selected,
  labelColour,
  paneWidth,
}: {
  drawing: Drawing;
  bridge: ChartBridge | null;
  selected: boolean;
  labelColour: string;
  paneWidth: number;
}) {
  if (!bridge) return null;
  const pts = drawing.pivots.map((p) => bridge.toScreen(p));
  const stroke = selected ? COLOUR.selected : COLOUR.leg;
  const fontSize = DEGREE_META[drawing.degree].fontSize;

  if (drawing.kind === "horizontal") {
    const p = pts[0];
    if (!p) return null;
    return (
      <g>
        <line x1={0} y1={p.y} x2={paneWidth} y2={p.y} stroke={stroke} strokeWidth={1} />
        <circle cx={p.x} cy={p.y} r={4} fill={COLOUR.handle} stroke={stroke} strokeWidth={1.5} />
      </g>
    );
  }

  return (
    <g>
      {pts.slice(0, -1).map((from, i) => {
        const to = pts[i + 1];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={stroke}
            strokeWidth={selected ? 2 : 1.5}
          />
        );
      })}

      {pts.map((p, i) => {
        if (!p) return null;
        const base = labelForPivot(drawing.kind, i);
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={selected ? 4.5 : 3.5}
              fill={COLOUR.handle}
              stroke={stroke}
              strokeWidth={1.5}
            />
            {/* Decorated here, from the CURRENT degree — never stored. */}
            {base && (
              <text
                x={p.x}
                y={p.y - 9}
                textAnchor="middle"
                fontSize={fontSize}
                fontWeight={600}
                fill={labelColour}
                style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.8)", strokeWidth: 3 }}
              >
                {decorateLabel(base, drawing.degree)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * A channel: two lines and the fill between them.
 *
 * The fill is a quadrilateral joining the two segments' endpoints, which works
 * for both geometries — parallel and converging alike — because it never
 * assumes the lines stay the same distance apart.
 */
function DrawnChannel({
  drawing,
  bridge,
  selected,
  paneWidth,
}: {
  drawing: Drawing;
  bridge: ChartBridge | null;
  selected: boolean;
  paneWidth: number;
}) {
  if (!bridge) return null;
  const geometry = channelGeometry(drawing);
  if (!geometry) return null;

  const s = { ...DEFAULT_STYLE, ...drawing.style };
  const stroke = selected ? COLOUR.selected : s.color;
  const dash = dashArray(s.lineStyle, s.thickness);

  const toSeg = (seg: { from: Pivot; to: Pivot }) => {
    const a = bridge.toScreen(seg.from);
    const b = bridge.toScreen(seg.to);
    if (!a || !b) return null;
    const raw = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    return drawing.extend ? extendToEdges(raw, paneWidth) : raw;
  };

  const one = toSeg(geometry.primary);
  const two = toSeg(geometry.secondary);
  if (!one || !two) return null;

  return (
    <g data-testid="channel" opacity={drawing.locked ? 0.75 : 1}>
      {s.fill && (
        <polygon
          points={`${one.x1},${one.y1} ${one.x2},${one.y2} ${two.x2},${two.y2} ${two.x1},${two.y1}`}
          fill={s.color}
          fillOpacity={s.fillOpacity}
          stroke="none"
        />
      )}
      {[one, two].map((seg, i) => (
        <line
          key={i}
          x1={seg.x1}
          y1={seg.y1}
          x2={seg.x2}
          y2={seg.y2}
          stroke={stroke}
          strokeWidth={selected ? s.thickness + 0.75 : s.thickness}
          strokeDasharray={dash}
        />
      ))}

      {/* Handles stay on the real pivots even when the lines are extended,
          because that is what a drag has to move. */}
      {!drawing.locked &&
        drawing.pivots.map((p, i) => {
          const at = bridge.toScreen(p);
          if (!at) return null;
          return (
            <circle
              key={i}
              cx={at.x}
              cy={at.y}
              r={selected ? 4.5 : 3.5}
              fill={COLOUR.handle}
              stroke={stroke}
              strokeWidth={1.5}
            />
          );
        })}
    </g>
  );
}

function PendingStructure({
  kind,
  pivots,
  bridge,
  labelColour,
}: {
  kind: keyof typeof TOOL_SPECS;
  pivots: { time: number; price: number }[];
  bridge: ChartBridge;
  labelColour: string;
}) {
  const pts = pivots.map((p) => bridge.toScreen(p));
  return (
    <g opacity={0.75}>
      {pts.slice(0, -1).map((from, i) => {
        const to = pts[i + 1];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={COLOUR.legPending}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        );
      })}
      {pts.map((p, i) => {
        if (!p) return null;
        const base = labelForPivot(kind, i);
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill={COLOUR.handle} stroke={COLOUR.legPending} strokeWidth={1.5} />
            {base && (
              <text
                x={p.x}
                y={p.y - 9}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={labelColour}
                opacity={0.7}
              >
                {base}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
