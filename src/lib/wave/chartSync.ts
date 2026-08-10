"use client";

/**
 * Cross-terminal synchronisation for the Wave Lab.
 *
 * Same idea as the scalper's registry — a module-level map rather than React
 * state, because pan and crosshair events fire per mouse pixel — but typed for
 * any series type, since a Wave Lab terminal may be showing candles, bars, a
 * line or an area.
 *
 * `reentrant` is the load-bearing detail: applying a range to terminal B fires
 * B's own range handler, which would bounce straight back to A.
 */

import type { IChartApi, ISeriesApi, LogicalRange, SeriesType, Time } from "lightweight-charts";

interface Entry {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  priceAt: (time: Time) => number | null;
}

const registry = new Map<string, Entry>();
let reentrant = false;

export function registerWaveChart(id: string, entry: Entry): () => void {
  registry.set(id, entry);
  return () => {
    registry.delete(id);
  };
}

export function syncWaveRange(fromId: string, range: LogicalRange | null): void {
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

export function syncWaveCrosshair(fromId: string, time: Time | undefined): void {
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
