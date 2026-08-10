"use client";

/**
 * The drawing layer.
 *
 * Pure presentation: it receives shapes already projected into pixels and
 * renders them. Nothing here knows about charts, times or prices, which is what
 * keeps the interactive bits — hit targets, drag handles — simple enough to
 * reason about.
 *
 * The layer never receives pointer events — Chromium will not hit-test into an
 * SVG subtree whose root is `pointer-events: none`, and the root must be `none`
 * so clicks reach the chart underneath. Selection and dragging are resolved by
 * `lib/wave/hit.ts` against the same projected geometry rendered here.
 */

import * as React from "react";

import { DEGREES, labelFontSize, type DegreeKey } from "@/lib/wave/degrees";
import { TOOLS, type ToolId } from "@/lib/wave/patterns";

interface Pt {
  x: number;
  y: number;
}

export interface OverlayShape {
  id: string;
  tool: ToolId;
  degree: DegreeKey;
  color: string;
  selected: boolean;
  invalid: boolean;
  draft: boolean;
  showLabels: boolean;
  points: (Pt & { label: string; index: number })[];
  levels: { y: number; x1: number; x2: number; label: string }[];
  channel: { base: [Pt, Pt]; parallel: [Pt, Pt] } | null;
}

interface Props {
  width: number;
  height: number;
  shapes: OverlayShape[];
  /** Filled polygon between the Bollinger bands, when the fill is switched on. */
  bandPath: string | null;
  rubberBand: { from: Pt; to: Pt } | null;
}

export function WaveOverlay({ width, height, shapes, bandPath, rubberBand }: Props) {
  if (width === 0 || height === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      aria-hidden="true"
    >
      {bandPath ? <path d={bandPath} fill="rgba(129,140,248,0.10)" stroke="none" /> : null}

      {shapes.map((shape) => (
        <Shape key={shape.id} shape={shape} width={width} />
      ))}

      {rubberBand ? (
        <line
          x1={rubberBand.from.x}
          y1={rubberBand.from.y}
          x2={rubberBand.to.x}
          y2={rubberBand.to.y}
          stroke="rgba(148,163,184,0.8)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      ) : null}
    </svg>
  );
}

function Shape({ shape, width }: { shape: OverlayShape; width: number }) {
  const spec = TOOLS[shape.tool];
  const stroke = shape.invalid ? "#f87171" : shape.color;
  const opacity = shape.draft ? 0.75 : 1;
  const path = shape.points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <g opacity={opacity}>
      {/* Channel first, so it sits behind the wave path. */}
      {shape.channel ? (
        <g stroke={stroke} strokeWidth={1} strokeDasharray="6 5" opacity={0.45} fill="none">
          <line
            x1={shape.channel.base[0].x}
            y1={shape.channel.base[0].y}
            x2={shape.channel.base[1].x}
            y2={shape.channel.base[1].y}
          />
          <line
            x1={shape.channel.parallel[0].x}
            y1={shape.channel.parallel[0].y}
            x2={shape.channel.parallel[1].x}
            y2={shape.channel.parallel[1].y}
          />
        </g>
      ) : null}

      {shape.levels.map((level, i) => (
        <g key={`level-${i}`}>
          <line
            x1={Math.min(level.x1, level.x2)}
            y1={level.y}
            x2={Math.max(level.x2, level.x1)}
            y2={level.y}
            stroke={stroke}
            strokeWidth={1}
            opacity={0.7}
          />
          <text
            x={Math.max(level.x1, level.x2) + 6}
            y={level.y + 3}
            fill={stroke}
            fontSize={10}
            opacity={0.9}
          >
            {level.label}
          </text>
        </g>
      ))}

      {shape.tool === "hline" && shape.points[0] ? (
        <>
          <line
            x1={0}
            y1={shape.points[0].y}
            x2={width}
            y2={shape.points[0].y}
            stroke={stroke}
            strokeWidth={shape.selected ? 2 : 1.25}
          />
        </>
      ) : shape.points.length >= 2 ? (
        <>
          <polyline
            points={path}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.selected ? 2.5 : 1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={spec.elliott ? undefined : "5 4"}
          />
        </>
      ) : null}

      {shape.points.map((point, i) => {
        const isEndpoint = i === 0 || i === shape.points.length - 1;
        return (
          <circle
            key={`handle-${i}`}
            data-wave-handle={`${shape.id}:${i}`}
            cx={point.x}
            cy={point.y}
            r={shape.selected ? 5 : 3.5}
            fill={shape.selected ? stroke : "#0b1220"}
            stroke={stroke}
            strokeWidth={1.5}
          >
            {isEndpoint ? null : <title>{point.label}</title>}
          </circle>
        );
      })}

      {shape.showLabels
        ? shape.points.map((point, i) => {
            if (!point.label) return null;
            const above = isPeak(shape.points, i);
            return (
              <WaveLabel
                key={`label-${i}`}
                x={point.x}
                y={point.y}
                above={above}
                text={point.label}
                degree={shape.degree}
                color={stroke}
                emphasised={shape.selected}
              />
            );
          })
        : null}
    </g>
  );
}

/**
 * A pivot is drawn above the point when it is a local high on screen. Getting
 * this wrong is what makes hand-drawn counts unreadable — labels land inside
 * the price action instead of clear of it.
 */
function isPeak(points: (Pt & { index: number })[], i: number): boolean {
  const prev = points[i - 1];
  const next = points[i + 1];
  if (prev && next) return points[i].y <= prev.y && points[i].y <= next.y;
  if (prev) return points[i].y <= prev.y;
  if (next) return points[i].y <= next.y;
  return true;
}

function WaveLabel({
  x,
  y,
  above,
  text,
  degree,
  color,
  emphasised,
}: {
  x: number;
  y: number;
  above: boolean;
  text: string;
  degree: DegreeKey;
  color: string;
  emphasised: boolean;
}) {
  const size = labelFontSize(degree);
  const offset = above ? -(size + 8) : size + 10;
  const halfWidth = Math.max(9, text.length * size * 0.34);

  return (
    <g>
      <rect
        x={x - halfWidth}
        y={y + offset - size * 0.82}
        width={halfWidth * 2}
        height={size * 1.35}
        rx={3}
        fill="rgba(8,13,22,0.82)"
        stroke={emphasised ? color : "transparent"}
        strokeWidth={1}
      />
      <text
        x={x}
        y={y + offset + size * 0.32}
        textAnchor="middle"
        fill={color}
        fontSize={size}
        fontWeight={600}
        style={{ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" }}
      >
        {text}
      </text>
    </g>
  );
}

export { DEGREES };
