"use client";

/**
 * One chart terminal: header, drawing rail, chart, and a status line.
 *
 * The status line is doing real work — while a pattern is being placed it says
 * which pivot comes next, which is the difference between a tool that teaches
 * the sequence and one that leaves you counting clicks.
 */

import * as React from "react";

import type { Instrument, Interval, MarketCandle } from "@/lib/market/types";
import { computeMetrics } from "@/lib/wave/metrics";
import { TOOLS, labelAt } from "@/lib/wave/patterns";
import { validate } from "@/lib/wave/rules";
import { decorateLabel } from "@/lib/wave/degrees";
import { useWaveStore } from "@/lib/wave/store";
import { barIndexer, type TerminalData, type TerminalState } from "@/lib/wave/types";
import { clsx } from "@/components/scalper/ui";
import { DrawingToolbar } from "./DrawingToolbar";
import { TerminalHeader } from "./TerminalHeader";
import { WaveChart } from "./WaveChart";

interface Props {
  terminal: TerminalState;
  data: TerminalData;
  focused: boolean;
}

export function ChartTerminal({ terminal, data, focused }: Props) {
  const store = useWaveStore();
  const draft = store.drafts[terminal.id] ?? null;
  const [hovered, setHovered] = React.useState<MarketCandle | null>(null);

  // Counts that break a hard rule are outlined in red on the chart itself, so a
  // broken count is visible without opening the inspector.
  const invalidIds = React.useMemo(() => {
    const index = barIndexer(data.candles);
    const failing = new Set<string>();
    for (const drawing of terminal.drawings) {
      if (!TOOLS[drawing.tool].elliott) continue;
      const metrics = computeMetrics(drawing, data.candles, index);
      if (metrics && validate(drawing, metrics).hardFailures > 0) failing.add(drawing.id);
    }
    return failing;
  }, [terminal.drawings, data.candles]);

  const spec = TOOLS[terminal.activeTool];
  const placed = draft?.points.length ?? 0;
  const nextLabel = terminal.activeTool !== "cursor" ? labelAt(terminal.activeTool, placed) : "";

  return (
    <section
      className={clsx(
        "flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-[#111823] transition-colors",
        focused ? "border-slate-700" : "border-slate-800/80"
      )}
      aria-label={`Chart terminal ${terminal.id}`}
    >
      <TerminalHeader
        terminal={terminal}
        data={data}
        hovered={hovered ? { close: hovered.close, time: hovered.time } : null}
        onSymbol={(instrument: Instrument) =>
          store.setSymbol(
            terminal.id,
            instrument.key,
            instrument.name ?? instrument.tradingSymbol,
            instrument.instrumentToken
          )
        }
        onInterval={(interval: Interval) => store.setInterval(terminal.id, interval)}
        onChartType={(chartType) => store.setChartType(terminal.id, chartType)}
        onScale={(scale) => store.setScale(terminal.id, scale)}
        onIndicators={(update) => store.setIndicators(terminal.id, update)}
        onReload={() => void store.loadTerminal(terminal.id)}
      />

      <div className="flex min-h-0 flex-1">
        <DrawingToolbar
          activeTool={terminal.activeTool}
          degree={terminal.degree}
          variant={terminal.variant}
          magnet={terminal.magnet}
          showLabels={terminal.showLabels}
          hasDrawings={terminal.drawings.length > 0}
          onTool={(tool) => store.setActiveTool(terminal.id, tool)}
          onDegree={(degree) => store.setDegree(terminal.id, degree)}
          onVariant={(variant) => store.setVariant(terminal.id, variant)}
          onMagnet={() => store.toggleMagnet(terminal.id)}
          onLabels={() => store.toggleLabels(terminal.id)}
          onClear={() => store.clearDrawings(terminal.id)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {data.error && data.candles.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <p className="text-xs font-semibold text-rose-300">Could not load {terminal.symbol}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{data.error}</p>
                <button
                  type="button"
                  onClick={() => void store.loadTerminal(terminal.id)}
                  className="mt-3 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <WaveChart
              terminal={terminal}
              data={data}
              draft={draft}
              invalidIds={invalidIds}
              focused={focused}
              sync={store.syncCharts}
              onPlacePoint={(point) => store.placePoint(terminal.id, point)}
              onMovePoint={(drawingId, pointIndex, point) =>
                store.movePoint(terminal.id, drawingId, pointIndex, point)
              }
              onSelect={(drawingId) => store.selectDrawing(terminal.id, drawingId)}
              onFocus={() => store.setFocused(terminal.id)}
              onHover={setHovered}
            />
          )}

          <footer className="flex shrink-0 items-center gap-2 border-t border-slate-800/80 px-2 py-1 text-[10px] text-slate-500">
            {terminal.activeTool === "cursor" ? (
              <span className="truncate">
                {terminal.drawings.length === 0
                  ? "Pick a tool from the rail to start a count."
                  : "Click a drawing to select it; drag a handle to move a pivot."}
              </span>
            ) : (
              <span className="truncate text-cyan-300">
                {spec.label} — click{" "}
                {placed === 0 ? (
                  "the origin"
                ) : (
                  <>
                    pivot{" "}
                    <span className="font-mono font-bold">{decorateLabel(nextLabel, terminal.degree)}</span>
                  </>
                )}{" "}
                ({placed}/{spec.points} placed) · Esc to cancel
              </span>
            )}
            {hovered ? (
              <span className="ml-auto shrink-0 font-mono">
                O {fmt(hovered.open)} H {fmt(hovered.high)} L {fmt(hovered.low)} C {fmt(hovered.close)}
              </span>
            ) : null}
          </footer>
        </div>
      </div>
    </section>
  );
}

function fmt(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}
