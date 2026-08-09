"use client";

/**
 * Wave Lab — two chart terminals side by side, an inspector, and the Claude
 * hand-off.
 *
 * Two terminals rather than one because Elliott work is comparative: the higher
 * degree fixes the context and the lower one carries the trade, and a count
 * that only survives on a single timeframe is not a count. Sync ties their pan,
 * zoom and crosshair together when both panes are showing the same instrument.
 */

import * as React from "react";
import { Activity, Columns2, PanelRightClose, PanelRightOpen, Rows2, Share2, Square, X } from "lucide-react";

import { INTERVALS } from "@/lib/market/types";
import type { TerminalSnapshot } from "@/lib/wave/export";
import { TOOLS, TOOL_ORDER } from "@/lib/wave/patterns";
import { LIVE_POLL_INTERVAL_MS, useWaveStore } from "@/lib/wave/store";
import { Badge, Button, Toggle, clsx } from "@/components/scalper/ui";
import { ChartTerminal } from "./ChartTerminal";
import { ConnectZerodha } from "./ConnectZerodha";
import { PaperTradePanel } from "./PaperTradePanel";
import { ExportDialog } from "./ExportDialog";
import { WaveInspector } from "./WaveInspector";

export function WaveLabWorkspace() {
  const store = useWaveStore();
  const {
    terminals,
    data,
    layout,
    syncCharts,
    livePolling,
    focusedTerminal,
    inspectorOpen,
    exportOpen,
    notices,
    hydrated,
  } = store;

  React.useEffect(() => {
    store.hydrate();
    // Hydration is idempotent and must run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live tail. Polling rather than a socket — see the store's comment.
  React.useEffect(() => {
    if (!livePolling) return;
    const timer = setInterval(() => void store.pollQuotes(), LIVE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePolling]);

  // Tool shortcuts apply to whichever terminal has focus, which is the one you
  // last clicked in — the same rule every multi-pane charting app uses.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const id = store.focusedTerminal;
      const terminal = store.terminals.find((entry) => entry.id === id);
      if (!terminal) return;

      if (event.key === "Escape") {
        store.cancelDraft(id);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && terminal.selectedId) {
        event.preventDefault();
        store.deleteDrawing(id, terminal.selectedId);
        return;
      }

      const match = TOOL_ORDER.find(
        (tool) => TOOLS[tool].shortcut?.toLowerCase() === event.key.toLowerCase()
      );
      if (match) {
        event.preventDefault();
        store.setActiveTool(id, match);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshots: TerminalSnapshot[] = terminals.map((terminal) => ({
    state: terminal,
    candles: data[terminal.id]?.candles ?? [],
    provider: data[terminal.id]?.provider ?? null,
  }));

  const focused = terminals.find((terminal) => terminal.id === focusedTerminal) ?? terminals[0];
  // Both terminals keep loading and keep their counts in single view — only the
  // rendering is narrowed, so switching back is instant and nothing is lost.
  const visible = layout === "single" ? [focused].filter(Boolean) : terminals;
  const focusedData = data[focused?.id ?? ""] ?? { candles: [] };
  const simulated = snapshots.some((snapshot) => snapshot.provider && !snapshot.provider.live);
  const totalDrawings = terminals.reduce((sum, terminal) => sum + terminal.drawings.length, 0);
  const openTrades = store.positions.filter((position) => position.status === "OPEN").length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b111b] text-slate-200">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-[#0d141f] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-cyan-600/20 text-cyan-300">
            <Activity className="h-3.5 w-3.5" />
          </span>
          <div className="leading-tight">
            <div className="text-xs font-bold text-slate-100">Wave Lab</div>
            <div className="text-[10px] text-slate-500">Elliott · Fibonacci · Lucas</div>
          </div>
        </div>

        <div className="mx-1 h-6 w-px bg-slate-800" />

        <Toggle
          checked={syncCharts}
          onChange={store.toggleSync}
          label="Sync charts"
          hint="Share pan, zoom and crosshair between both terminals"
        />
        <Toggle
          checked={livePolling}
          onChange={store.toggleLivePolling}
          label="Live"
          hint={`Extend the last bar with the traded price every ${LIVE_POLL_INTERVAL_MS / 1000}s`}
        />

        <div className="inline-flex overflow-hidden rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
          {(
            [
              { value: "single" as const, icon: Square, title: "One chart" },
              { value: "columns" as const, icon: Columns2, title: "Two charts, side by side" },
              { value: "rows" as const, icon: Rows2, title: "Two charts, stacked" },
            ]
          ).map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                aria-label={option.title}
                title={option.title}
                aria-pressed={layout === option.value}
                onClick={() => store.setLayout(option.value)}
                className={clsx(
                  "rounded px-2 py-1 transition-colors",
                  layout === option.value ? "bg-cyan-600 text-white" : "text-slate-400 hover:bg-slate-800"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>

        {/* With one chart on screen you still need to reach the other one, and
            which is showing has to be obvious — hence names, not just A / B. */}
        {layout === "single" ? (
          <div
            role="radiogroup"
            aria-label="Visible chart"
            className="inline-flex overflow-hidden rounded-md border border-slate-800 bg-slate-900/60 p-0.5"
          >
            {terminals.map((terminal) => (
              <button
                key={terminal.id}
                type="button"
                role="radio"
                aria-checked={terminal.id === focusedTerminal}
                title={`Show ${terminal.title} ${INTERVALS[terminal.interval].label}`}
                onClick={() => store.setFocused(terminal.id)}
                className={clsx(
                  "max-w-[150px] truncate rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                  terminal.id === focusedTerminal
                    ? "bg-cyan-600 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                {terminal.title} · {INTERVALS[terminal.interval].label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {simulated ? (
            <Badge tone="amber" title="At least one terminal is showing generated prices, not the market.">
              Simulated data
            </Badge>
          ) : null}
          <ConnectZerodha onNotify={store.notify} onReload={() => void store.loadAll()} />
          {openTrades > 0 ? (
            <Badge tone="cyan" title="Simulated positions currently open">
              {openTrades} paper {openTrades === 1 ? "position" : "positions"}
            </Badge>
          ) : null}
          <Badge tone="slate">{totalDrawings} drawings</Badge>
          <Button tone="accent" onClick={() => store.setExportOpen(true)}>
            <Share2 className="h-3 w-3" />
            Send to Claude
          </Button>
          <Button
            tone="ghost"
            onClick={() => store.setInspectorOpen(!inspectorOpen)}
            aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
            title={inspectorOpen ? "Hide inspector" : "Show inspector"}
          >
            {inspectorOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main
          className={clsx(
            "flex min-h-0 min-w-0 flex-1 gap-2 p-2",
            // Stacked panes scroll rather than shrink: two charts sharing a
            // phone's height would leave neither tall enough to count on.
            layout === "columns" ? "flex-row" : "flex-col overflow-y-auto"
          )}
        >
          {!hydrated ? (
            <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
              Restoring workspace…
            </div>
          ) : (
            visible.map((terminal) => (
              <ChartTerminal
                key={terminal.id}
                terminal={terminal}
                data={data[terminal.id] ?? { candles: [], provider: null, loading: true, error: null, loadedAt: null }}
                focused={terminal.id === focusedTerminal}
              />
            ))
          )}
        </main>

        {inspectorOpen && focused ? (
          <aside
            className="flex w-[320px] shrink-0 flex-col border-l border-slate-800 bg-[#0d141f]"
            aria-label="Wave inspector"
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-2 py-1.5">
              {(
                [
                  { id: false, label: "Inspector" },
                  { id: true, label: "Paper" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  aria-pressed={store.paperOpen === tab.id}
                  onClick={() => store.setPaperOpen(tab.id)}
                  className={clsx(
                    "rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors",
                    store.paperOpen === tab.id
                      ? "bg-slate-800 text-slate-100"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {tab.label}
                  {tab.id && openTrades > 0 ? (
                    <span className="ml-1 rounded bg-cyan-600/30 px-1 text-[9px] text-cyan-200">
                      {openTrades}
                    </span>
                  ) : null}
                </button>
              ))}
              <Badge tone="cyan">Chart {focused.id}</Badge>
              <span className="ml-auto truncate text-[10px] text-slate-500">{focused.title}</span>
            </div>
            <div className="min-h-0 flex-1">
              {store.paperOpen ? (
                <PaperTradePanel terminal={focused} candles={focusedData.candles} />
              ) : (
                <WaveInspector
                  terminal={focused}
                  candles={focusedData.candles}
                  onSelect={(drawingId) => store.selectDrawing(focused.id, drawingId)}
                  onUpdate={(drawingId, patch) => store.updateDrawing(focused.id, drawingId, patch)}
                  onDelete={(drawingId) => store.deleteDrawing(focused.id, drawingId)}
                />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {notices.length > 0 ? (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-1.5">
          {notices.map((notice) => (
            <div
              key={notice.id}
              role="status"
              className={clsx(
                "pointer-events-auto flex max-w-lg items-start gap-2 rounded-md border px-3 py-2 text-[11px] shadow-lg",
                notice.tone === "error"
                  ? "border-rose-800 bg-rose-950/90 text-rose-200"
                  : notice.tone === "success"
                    ? "border-emerald-800 bg-emerald-950/90 text-emerald-200"
                    : "border-slate-700 bg-slate-900/95 text-slate-300"
              )}
            >
              <span className="min-w-0 flex-1">{notice.message}</span>
              <button
                type="button"
                onClick={() => store.dismissNotice(notice.id)}
                aria-label="Dismiss"
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <ExportDialog
        open={exportOpen}
        snapshots={snapshots}
        positions={store.positions}
        onClose={() => store.setExportOpen(false)}
        onImport={(terminalId, json, mode) => store.importDrawings(terminalId, json, mode)}
        onNotify={store.notify}
      />
    </div>
  );
}
