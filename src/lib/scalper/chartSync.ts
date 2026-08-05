"use client";

/**
 * Cross-chart synchronisation.
 *
 * A tiny registry rather than React state: pan/zoom and crosshair events fire
 * at pointer-move frequency, and routing them through the component tree would
 * re-render three charts per mouse pixel. Charts register imperatively, talk to
 * each other directly, and unregister on unmount.
 *
 * `reentrant` is the important detail — applying a range to chart B fires B's
 * own range handler, which would bounce straight back to A.
 */

import type { IChartApi, ISeriesApi, LogicalRange, Time } from "lightweight-charts";

interface Entry {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  /** Close at `time`, so a crosshair can be placed on each chart's own scale. */
  priceAt: (time: Time) => number | null;
}

const registry = new Map<string, Entry>();
let reentrant = false;

export function registerChart(id: string, entry: Entry): () => void {
  registry.set(id, entry);
  return () => {
    registry.delete(id);
  };
}

export function syncRange(fromId: string, range: LogicalRange | null): void {
  if (reentrant || !range) return;
  reentrant = true;
  try {
    for (const [id, entry] of Array.from(registry.entries())) {
      if (id === fromId) continue;
      entry.chart.timeScale().setVisibleLogicalRange(range);
    }
  } finally {
    reentrant = false;
  }
}

export function syncCrosshair(fromId: string, time: Time | undefined): void {
  if (reentrant) return;
  reentrant = true;
  try {
    for (const [id, entry] of Array.from(registry.entries())) {
      if (id === fromId) continue;
      if (time === undefined) {
        entry.chart.clearCrosshairPosition();
        continue;
      }
      const price = entry.priceAt(time);
      if (price === null) {
        entry.chart.clearCrosshairPosition();
        continue;
      }
      entry.chart.setCrosshairPosition(price, time, entry.series);
    }
  } finally {
    reentrant = false;
  }
}

export function clearAllCrosshairs(exceptId?: string): void {
  for (const [id, entry] of Array.from(registry.entries())) {
    if (id === exceptId) continue;
    entry.chart.clearCrosshairPosition();
  }
}
