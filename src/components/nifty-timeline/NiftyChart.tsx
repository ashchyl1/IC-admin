"use client";
import * as React from "react";
import type { Recommendation } from "@/lib/nifty-timeline/recommendations";
import {
  formatDate,
  formatLevel,
  parseLevels,
  type DayPoint,
  type Regime,
} from "@/lib/nifty-timeline/series";
import { CHART_COLORS as C, DIRECTION_STYLE } from "./direction";

// Fixed vertical bands; only the width follows the container, so labels keep a
// real pixel size instead of scaling with a viewBox.
const PAD_TOP = 12;
const PRICE_H = 360;
const RAIL_H = 15; // publication markers, directly under the price area
const GAP = 12;
const VOL_H = 38;
const AXIS_H = 22;
const PAD_LEFT = 6;
const GUTTER = 62; // right-hand price axis

const PRICE_TOP = PAD_TOP;
const PRICE_BOTTOM = PRICE_TOP + PRICE_H;
const RAIL_TOP = PRICE_BOTTOM + 3;
const VOL_TOP = RAIL_TOP + RAIL_H + GAP;
const VOL_BOTTOM = VOL_TOP + VOL_H;
const HEIGHT = VOL_BOTTOM + AXIS_H;

const MONTH_FMT = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

/** Roughly `count` gridlines on a round step, so the axis reads 23,500 not 23,486. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  const rawStep = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

interface Props {
  points: DayPoint[];
  /** Index into `points`, or -1. */
  selected: number;
  onSelect: (index: number) => void;
  regimes: Regime[];
  /** Levels from this call are drawn across the plot. */
  activeRec: Recommendation | null;
}

export function NiftyChart({ points, selected, onSelect, regimes, activeRec }: Props) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(960);
  const [hover, setHover] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const plotLeft = PAD_LEFT;
  const plotRight = Math.max(plotLeft + 40, width - GUTTER);
  const plotW = plotRight - plotLeft;
  const slot = n ? plotW / n : 0;
  const barW = Math.max(1.5, Math.min(11, slot * 0.66));
  const x = React.useCallback((i: number) => plotLeft + slot * (i + 0.5), [plotLeft, slot]);

  // The active call's levels widen the price domain, but only far enough to
  // stay readable: a 25,268 target should be visible from a three-month view,
  // while "No new weekly target" must not flatten the candles into a ribbon.
  const { lo, hi, levelLines } = React.useMemo(() => {
    if (!n) return { lo: 0, hi: 1, levelLines: [] as { value: number; kind: string }[] };
    let min = Math.min(...points.map((p) => p.low));
    let max = Math.max(...points.map((p) => p.high));
    const lines = activeRec
      ? [
          ...parseLevels(activeRec.target).map((value) => ({ value, kind: "Target" })),
          ...parseLevels(activeRec.reversal).map((value) => ({ value, kind: "Reversal" })),
        ]
      : [];
    for (const { value } of lines) {
      if (value > max && value < max * 1.08) max = value;
      if (value < min && value > min * 0.92) min = value;
    }
    const pad = (max - min) * 0.06 || 1;
    return { lo: min - pad, hi: max + pad, levelLines: lines };
  }, [points, activeRec, n]);

  const y = React.useCallback(
    (price: number) => PRICE_TOP + ((hi - price) / (hi - lo)) * PRICE_H,
    [hi, lo]
  );

  const maxVol = React.useMemo(() => Math.max(1, ...points.map((p) => p.volume)), [points]);
  const ticks = React.useMemo(() => niceTicks(lo, hi), [lo, hi]);

  // First visible bar of each month, for the date axis.
  const monthMarks = React.useMemo(() => {
    const out: { i: number; label: string }[] = [];
    let last = "";
    points.forEach((p, i) => {
      const m = p.date.slice(0, 7);
      if (m !== last) {
        last = m;
        out.push({ i, label: MONTH_FMT.format(new Date(`${p.date}T00:00:00Z`)) });
      }
    });
    return out;
  }, [points]);

  // Regimes are indexed against the full series, so shift them into this slice.
  const offset = points[0]?.index ?? 0;
  const visibleRegimes = React.useMemo(
    () =>
      regimes
        .map((r) => ({
          rec: r.rec,
          from: r.fromIndex - offset,
          to: r.toIndex - offset,
        }))
        .filter((r) => r.to >= 0 && r.from <= n - 1)
        .map((r) => ({ ...r, from: Math.max(0, r.from), to: Math.min(n - 1, r.to) })),
    [regimes, offset, n]
  );

  // The stretch the document says nothing about, drawn once rather than per bar.
  const uncoveredTo = React.useMemo(() => {
    let last = -1;
    points.forEach((p, i) => {
      if (!p.rec) last = i;
    });
    return last;
  }, [points]);

  function move(delta: number) {
    if (!n) return;
    const base = selected < 0 ? n - 1 : selected;
    onSelect(Math.min(n - 1, Math.max(0, base + delta)));
  }

  function handleKey(e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowDown: -5,
      ArrowUp: 5,
      PageDown: -20,
      PageUp: 20,
    };
    if (e.key in step) {
      e.preventDefault();
      move(step[e.key]);
    } else if (e.key === "Home") {
      e.preventDefault();
      onSelect(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSelect(n - 1);
    }
  }

  // Hover only. Pinning the tooltip to the selection would park a box over the
  // chart permanently, and the panel already says everything it would.
  const cursorPoint = hover === null ? null : points[hover] ?? null;

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="Nifty daily bars. Use the left and right arrow keys to move between days; the panel shows the recommendation in force on the selected day."
      onKeyDown={handleKey}
      onMouseLeave={() => setHover(null)}
      className="relative w-full rounded-[3px] border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg width={width} height={HEIGHT} className="block select-none">
        <defs>
          <pattern
            id="nt-uncovered"
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="7" stroke={C.muted} strokeWidth="1" opacity={0.16} />
          </pattern>
        </defs>

        {/* --------------------------------------------- regime bands ----- */}
        {visibleRegimes.map((r) => (
          <rect
            key={r.rec.date}
            x={x(r.from) - slot / 2}
            y={PRICE_TOP}
            width={Math.max(1, slot * (r.to - r.from + 1))}
            height={PRICE_H}
            fill={DIRECTION_STYLE[r.rec.direction].swatch}
            opacity={0.06}
          />
        ))}

        {/* Days the casebook does not cover, hatched rather than hidden. */}
        {uncoveredTo >= 0 && (
          <>
            <rect
              x={plotLeft}
              y={PRICE_TOP}
              width={Math.max(0, x(uncoveredTo) + slot / 2 - plotLeft)}
              height={PRICE_H}
              fill="url(#nt-uncovered)"
            />
            <text
              x={plotLeft + 8}
              y={PRICE_TOP + 14}
              fontSize={10}
              fill={C.muted}
              className="uppercase tracking-wide"
            >
              Before the document&rsquo;s timeline
            </text>
          </>
        )}

        {/* --------------------------------------------- price gridlines -- */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={y(t)}
              y2={y(t)}
              stroke={C.border}
              strokeWidth={1}
            />
            <text
              x={plotRight + 7}
              y={y(t) + 3.5}
              fontSize={10}
              fill={C.muted}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatLevel(Math.round(t))}
            </text>
          </g>
        ))}

        {/* --------------------------------------- active call's levels --- */}
        {/* Tags sit inside the plot, right-aligned: the gutter belongs to the
            price axis, and a tag placed there hides the very gridline label a
            reader uses to locate the level. */}
        {levelLines.map(({ value, kind }, i) => {
          if (value < lo || value > hi) return null;
          const colour = kind === "Target" ? C.buy : C.sell;
          const tagW = 58;
          return (
            <g key={`${kind}-${value}-${i}`}>
              <line
                x1={plotLeft}
                x2={plotRight - tagW - 4}
                y1={y(value)}
                y2={y(value)}
                stroke={colour}
                strokeWidth={1.25}
                strokeDasharray="5 4"
                opacity={0.85}
              />
              <rect
                x={plotRight - tagW - 2}
                y={y(value) - 8}
                width={tagW}
                height={16}
                rx={2}
                fill={colour}
              />
              <text
                x={plotRight - 2 - tagW / 2}
                y={y(value) + 3.5}
                fontSize={9.5}
                fill="#fff"
                textAnchor="middle"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {kind[0]} {formatLevel(Math.round(value))}
              </text>
            </g>
          );
        })}

        {/* --------------------------------------------------- candles ---- */}
        {points.map((p, i) => {
          const up = p.close >= p.open;
          const colour = up ? C.buy : C.sell;
          const bodyTop = y(Math.max(p.open, p.close));
          const bodyH = Math.max(1, y(Math.min(p.open, p.close)) - bodyTop);
          return (
            <g key={p.date} opacity={p.rec ? 1 : 0.55}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={y(p.high)}
                y2={y(p.low)}
                stroke={colour}
                strokeWidth={Math.min(1.4, Math.max(0.8, barW * 0.18))}
              />
              <rect
                x={x(i) - barW / 2}
                y={bodyTop}
                width={barW}
                height={bodyH}
                fill={colour}
                rx={barW > 4 ? 0.5 : 0}
              />
            </g>
          );
        })}

        {/* ------------------------------------------------ volume strip -- */}
        {points.map((p, i) => (
          <rect
            key={`v-${p.date}`}
            x={x(i) - barW / 2}
            y={VOL_BOTTOM - (p.volume / maxVol) * VOL_H}
            width={barW}
            height={Math.max(0.6, (p.volume / maxVol) * VOL_H)}
            fill={p.close >= p.open ? C.buy : C.sell}
            opacity={p.rec ? 0.4 : 0.22}
          />
        ))}
        <line
          x1={plotLeft}
          x2={plotRight}
          y1={VOL_BOTTOM}
          y2={VOL_BOTTOM}
          stroke={C.border}
          strokeWidth={1}
        />
        <text x={plotLeft + 2} y={VOL_TOP + 9} fontSize={9} fill={C.muted}>
          Volume
        </text>

        {/* ------------------------------------- publication marker rail -- */}
        {visibleRegimes.map((r) => {
          const cx = x(r.from);
          const swatch = DIRECTION_STYLE[r.rec.direction].swatch;
          return (
            <g key={`m-${r.rec.date}`}>
              <line
                x1={x(r.from) - slot / 2}
                x2={x(r.to) + slot / 2}
                y1={RAIL_TOP + RAIL_H / 2}
                y2={RAIL_TOP + RAIL_H / 2}
                stroke={swatch}
                strokeWidth={2.5}
                opacity={0.55}
              />
              <path
                d={`M ${cx} ${RAIL_TOP + 1} L ${cx + 4.5} ${RAIL_TOP + 7.5} L ${cx} ${RAIL_TOP + 14} L ${cx - 4.5} ${RAIL_TOP + 7.5} Z`}
                fill={swatch}
              />
            </g>
          );
        })}

        {/* ---------------------------------------------------- x axis ---- */}
        {monthMarks.map((m) => (
          <text
            key={m.label + m.i}
            x={x(m.i)}
            y={VOL_BOTTOM + 15}
            fontSize={10}
            fill={C.muted}
            textAnchor="middle"
          >
            {m.label}
          </text>
        ))}

        {/* -------------------------------------------------- selection --- */}
        {selected >= 0 && selected < n && (
          <>
            <line
              x1={x(selected)}
              x2={x(selected)}
              y1={PRICE_TOP}
              y2={VOL_BOTTOM}
              stroke={C.primary}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.9}
            />
            <rect
              x={x(selected) - Math.max(barW, 5) / 2 - 2}
              y={y(points[selected].high) - 3}
              width={Math.max(barW, 5) + 4}
              height={y(points[selected].low) - y(points[selected].high) + 6}
              fill="none"
              stroke={C.primary}
              strokeWidth={1.25}
              rx={2}
            />
          </>
        )}
        {hover !== null && hover !== selected && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PRICE_TOP}
            y2={VOL_BOTTOM}
            stroke={C.muted}
            strokeWidth={1}
            opacity={0.4}
          />
        )}

        {/* ------------------------------------------------- hit areas ---- */}
        {points.map((p, i) => (
          <rect
            key={`h-${p.date}`}
            x={x(i) - slot / 2}
            y={PRICE_TOP}
            width={Math.max(slot, 2)}
            height={VOL_BOTTOM - PRICE_TOP}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onClick={() => onSelect(i)}
            className="cursor-pointer"
          >
            <title>{`${formatDate(p.date)} — close ${formatLevel(p.close)}`}</title>
          </rect>
        ))}
      </svg>

      {/* Tooltip in HTML: wrapping prose inside <text> is not worth the trouble. */}
      {cursorPoint && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-[178px] rounded-[3px] border bg-card/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur"
          style={{
            left: Math.min(Math.max(x(hover ?? 0) + 12, 8), Math.max(8, width - 190)),
          }}
        >
          <div className="font-semibold text-foreground">{formatDate(cursorPoint.date)}</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
            {(["open", "high", "low", "close"] as const).map((k) => (
              <React.Fragment key={k}>
                <dt className="capitalize">{k}</dt>
                <dd className="kite-num text-right text-foreground">
                  {formatLevel(cursorPoint[k])}
                </dd>
              </React.Fragment>
            ))}
          </dl>
          <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">
            {cursorPoint.rec ? (
              <>
                <span className="font-medium text-foreground">{cursorPoint.rec.trend}</span>
                <br />
                published {formatDate(cursorPoint.rec.date)}
              </>
            ) : (
              "No recommendation on file"
            )}
          </div>
        </div>
      )}
    </div>
  );
}
