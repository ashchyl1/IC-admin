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
import { TOOL_SPECS, labelForPivot, type Drawing } from "@/lib/wave-lab/drawings/tools";
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
  const select = useDrawings((s) => s.select);
  const beginDrag = useDrawings((s) => s.beginDrag);
  const movePivot = useDrawings((s) => s.movePivot);

  // Re-render whenever the chart's projection moves. A counter is enough —
  // the actual coordinates are recomputed from the bridge during render.
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
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

  const screenDrawings = React.useMemo(
    () => drawings.map(project).filter((s): s is ScreenDrawing => s !== null),
    [drawings, project]
  );

  // ------------------------------------------------------------- pointer ---
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || !bridge) return;

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
        host.setPointerCapture(e.pointerId);
      }
    };

    const onMove = (e: PointerEvent) => {
      const point = local(e);
      const drag = dragRef.current;

      if (drag) {
        const chartPoint = bridge.toChart(point);
        if (chartPoint) movePivot(terminal, drag.drawingId, drag.pointIndex, chartPoint);
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
        if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
        return;
      }

      // Movement beyond the slop was a pan, not a click — §12.1.
      if (!down || !isClick(down, point)) return;

      if (activeTool) {
        const chartPoint = bridge.toChart(point);
        if (chartPoint) addPivot(terminal, chartPoint);
        return;
      }

      const hit = hitTest(point, screenDrawings, bridge.size().width);
      select(hit ? hit.drawingId : null);
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
    };
  }, [bridge, activeTool, screenDrawings, terminal, addPivot, select, beginDrag, movePivot]);

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
  }, [selected, candles, bridge]);

  return (
    <div
      ref={hostRef}
      data-testid="wave-lab-overlay-host"
      // `auto` so the container receives pointer events; the SVG inside stays
      // `none` so the chart below still pans and zooms normally.
      className="absolute inset-0"
      style={{
        pointerEvents: "auto",
        cursor: activeTool ? "crosshair" : cursorHit ? "pointer" : "default",
        touchAction: "none",
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

        {drawings.map((d) => (
          <DrawnStructure
            key={d.id}
            drawing={d}
            bridge={bridge}
            selected={d.id === selectedId}
            labelColour={labelColour}
            paneWidth={size.width}
          />
        ))}

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
