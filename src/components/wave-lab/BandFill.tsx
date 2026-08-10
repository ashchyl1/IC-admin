"use client";

/**
 * The shaded Bollinger band, drawn as an SVG polygon. §7, and §12.3.
 *
 * Why not an area series: area series fill to the *baseline*, not to another
 * series. Adding one for the lower band floods the entire bottom of the pane
 * with colour and hides the price. There is no option to stop it — the shape
 * has to be drawn.
 *
 * The polygon samples across the visible range rather than plotting every bar.
 * A three-year daily series is ~750 points per edge and the band is a smooth
 * envelope, so ~400 samples is visually identical and keeps the path short
 * enough to re-render on every pan without stuttering.
 */

import * as React from "react";
import type { IndicatorPoint } from "@/lib/wave-lab/indicators";
import type { ChartBridge } from "./PriceChart";

const MAX_SAMPLES = 400;

interface Props {
  upper: IndicatorPoint[];
  lower: IndicatorPoint[];
  bridge: ChartBridge | null;
  colour: string;
  opacity: number;
}

export function BandFill({ upper, lower, bridge, colour, opacity }: Props) {
  // Redraw whenever the projection moves; the bridge owns that signal.
  const [tick, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => bridge?.subscribe(bump), [bridge]);

  // `tick` is a dependency on purpose. The bridge object is created when the
  // chart is, but its converters only work once the price series exists — so
  // the first pass can legitimately project nothing and return null. Without
  // `tick` in the deps the memo would be frozen at that null for good, and the
  // band would stay invisible until some unrelated prop happened to change.
  // Reproduced exactly that way: reload with Bollinger already on and no fill
  // appeared until it was toggled off and back.
  const path = React.useMemo(() => {
    if (!bridge || !upper.length) return null;

    // Pair the two edges by index and keep only warmed-up, on-screen points.
    const step = Math.max(1, Math.ceil(upper.length / MAX_SAMPLES));
    const top: { x: number; y: number }[] = [];
    const bottom: { x: number; y: number }[] = [];

    for (let i = 0; i < upper.length; i += step) {
      const u = upper[i];
      const l = lower[i];
      if (u?.value == null || l?.value == null) continue;
      const pu = bridge.toScreen({ time: u.time, price: u.value });
      const pl = bridge.toScreen({ time: l.time, price: l.value });
      if (!pu || !pl) continue;
      top.push(pu);
      bottom.push(pl);
    }
    if (top.length < 2) return null;

    // Out along the upper edge, back along the lower — a closed ribbon.
    const forward = top.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
    const back = bottom
      .reverse()
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" L");
    return `M${forward} L${back} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upper, lower, bridge, tick]);

  if (!path) return null;
  const size = bridge?.size() ?? { width: 0, height: 0 };

  return (
    <svg
      width={size.width}
      height={size.height}
      className="absolute inset-0"
      style={{ pointerEvents: "none" }}
      data-testid="bollinger-fill"
    >
      <path d={path} fill={colour} fillOpacity={opacity} stroke="none" />
    </svg>
  );
}
