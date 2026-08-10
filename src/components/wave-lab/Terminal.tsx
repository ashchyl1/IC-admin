"use client";

/**
 * One terminal: its own symbol, interval, style, scale and data. §3.
 *
 * Fetching lives here rather than in the workspace so the two terminals load
 * independently — a slow weekly fetch must not hold up the daily beside it.
 */

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { INTERVALS, type Interval, type MarketCandle } from "@/lib/wave-lab/types";
import {
  useWorkspace,
  type SeriesStyle,
  type TerminalConfig,
  type TerminalId,
} from "@/lib/wave-lab/workspace-store";
import { PriceChart, type ChartBridge, type HoverReadout } from "./PriceChart";
import { AnalysisPanel } from "./AnalysisPanel";
import { DrawingOverlay } from "./DrawingOverlay";
import { DrawingToolbar } from "./DrawingToolbar";
import { SymbolSearch } from "./SymbolSearch";

const STYLES: { value: SeriesStyle; label: string }[] = [
  { value: "candles", label: "Candles" },
  { value: "heikin-ashi", label: "Heikin-Ashi" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
];

interface LoadState {
  candles: MarketCandle[];
  warning: string | null;
  stale: boolean;
  providerLabel: string;
  live: boolean;
  loading: boolean;
  error: string | null;
  needsAuth: boolean;
}

const EMPTY: LoadState = {
  candles: [],
  warning: null,
  stale: false,
  providerLabel: "",
  live: false,
  loading: true,
  error: null,
  needsAuth: false,
};

export function Terminal({ id, dark }: { id: TerminalId; dark: boolean }) {
  const config = useWorkspace((s) => s.terminals[id]);
  const active = useWorkspace((s) => s.active);
  const layout = useWorkspace((s) => s.layout);
  const patch = useWorkspace((s) => s.patch);
  const setSymbol = useWorkspace((s) => s.setSymbol);
  const setActive = useWorkspace((s) => s.setActive);

  const [state, setState] = React.useState<LoadState>(EMPTY);
  const [hover, setHover] = React.useState<HoverReadout | null>(null);
  const [bridge, setBridge] = React.useState<ChartBridge | null>(null);
  const [showAnalysis, setShowAnalysis] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const params = new URLSearchParams({ symbol: config.symbol, interval: config.interval });
    fetch(`/api/wave-lab/candles?${params}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({
            ...EMPTY,
            loading: false,
            error: json.error ?? "Could not load candles.",
            needsAuth: res.status === 401,
          });
          return;
        }
        setState({
          candles: json.candles ?? [],
          warning: json.warning ?? null,
          stale: Boolean(json.stale),
          providerLabel: json.providerLabel ?? "",
          live: Boolean(json.live),
          loading: false,
          error: null,
          needsAuth: false,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          ...EMPTY,
          loading: false,
          error: err instanceof Error ? err.message : "Could not load candles.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [config.symbol, config.interval]);

  const isActive = layout === 2 && active === id;

  return (
    <section
      onFocus={() => setActive(id)}
      onMouseDown={() => setActive(id)}
      className={cn(
        // flex-1 so it fills the grid cell its wrapper occupies.
        "flex min-h-0 min-w-0 flex-1 flex-col border border-[var(--wl-border)] bg-[var(--wl-bg)]",
        isActive && "border-[var(--wl-blue)]"
      )}
    >
      {/* --------------------------------------------------------- header -- */}
      <header className="flex flex-wrap items-center gap-1.5 border-b border-[var(--wl-border)] px-2 py-1.5">
        {layout === 2 && (
          <span className="rounded-[3px] bg-[var(--wl-subtle)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--wl-muted)]">
            {id}
          </span>
        )}

        <SymbolSearch value={config.symbol} onSelect={(key) => setSymbol(id, key)} />

        <IntervalPicker
          value={config.interval}
          onChange={(interval) => patch(id, { interval })}
        />

        <Select
          value={config.style}
          onChange={(v) => patch(id, { style: v as SeriesStyle })}
          options={STYLES}
          ariaLabel="Series style"
        />

        <Toggle
          on={config.logScale}
          onClick={() => patch(id, { logScale: !config.logScale })}
          title="Log price scale — matters for multi-year counts"
        >
          LOG
        </Toggle>

        <Toggle
          on={config.showVolume}
          onClick={() => patch(id, { showVolume: !config.showVolume })}
          title="Show volume"
        >
          VOL
        </Toggle>

        <Toggle
          on={showAnalysis}
          onClick={() => setShowAnalysis((v) => !v)}
          title="Show the wave-analysis panel"
        >
          RULES
        </Toggle>

        <Readout hover={hover} config={config} candles={state.candles} />
      </header>

      <DrawingToolbar terminal={id} />

      {/* -------------------------------------------------------- banners -- */}
      {!state.live && !state.loading && !state.error && (
        <Banner tone="amber">
          {state.warning ?? `Synthetic data from ${state.providerLabel} — not real prices.`}
        </Banner>
      )}
      {state.stale && state.warning && <Banner tone="amber">{state.warning}</Banner>}
      {state.error && (
        <Banner tone="red">
          {state.error}
          {state.needsAuth && " Use the connection badge above to sign in."}
        </Banner>
      )}

      {/* ------------------------------------------------ chart + panel -- */}
      <div className="flex min-h-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1">
        {state.loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--wl-bg)]/60">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--wl-blue)]" />
          </div>
        )}
        {!state.loading && !state.error && state.candles.length === 0 ? (
          <p className="grid h-full place-items-center px-6 text-center text-[13px] text-[var(--wl-muted)]">
            No candles for {config.symbol} at {config.interval} in this range.
          </p>
        ) : (
          <>
            <PriceChart
              candles={state.candles}
              style={config.style}
              logScale={config.logScale}
              showVolume={config.showVolume}
              dark={dark}
              onHover={setHover}
              onBridge={setBridge}
            />
            {/* Sits above the canvas; see DrawingOverlay for why it owns the
                pointer handling rather than the chart doing it. */}
            <DrawingOverlay
              terminal={id}
              bridge={bridge}
              dark={dark}
              candles={state.candles}
            />
          </>
        )}
      </div>

        {showAnalysis && (
          <AnalysisPanel
            terminal={id}
            candles={state.candles}
            onClose={() => setShowAnalysis(false)}
          />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ bits -- */

function Banner({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 border-b px-2 py-1 text-[11px]",
        tone === "amber"
          ? "border-[var(--wl-amber)]/30 bg-[var(--wl-amber)]/10 text-[var(--wl-amber)]"
          : "border-[var(--wl-sell)]/30 bg-[var(--wl-sell)]/10 text-[var(--wl-sell)]"
      )}
    >
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function IntervalPicker({
  value,
  onChange,
}: {
  value: Interval;
  onChange: (i: Interval) => void;
}) {
  return (
    <div className="flex items-center rounded-[3px] border border-[var(--wl-border)]">
      {INTERVALS.map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          aria-pressed={i === value}
          className={cn(
            "px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            i === value
              ? "bg-[var(--wl-blue)] text-white"
              : "text-[var(--wl-muted)] hover:bg-[var(--wl-hover)] hover:text-[var(--wl-text)]"
          )}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[3px] border border-[var(--wl-border)] bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--wl-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-blue)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        "rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
        on
          ? "border-[var(--wl-blue)] bg-[var(--wl-blue)]/10 text-[var(--wl-blue)]"
          : "border-[var(--wl-border)] text-[var(--wl-muted)] hover:bg-[var(--wl-hover)]"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Crosshair readout. Bar index is deliberately present and prominent: Elliott
 * time analysis counts bars, so the index must be visible rather than inferred
 * (§3, §6).
 */
function Readout({
  hover,
  config,
  candles,
}: {
  hover: HoverReadout | null;
  config: TerminalConfig;
  candles: MarketCandle[];
}) {
  const last = candles.length ? candles[candles.length - 1] : null;
  const shown = hover?.candle ?? last;
  if (!shown) return null;

  const index = hover?.barIndex ?? candles.length - 1;
  const pct =
    hover?.changePercent ??
    (candles.length > 1 && candles[candles.length - 2].close
      ? ((shown.close - candles[candles.length - 2].close) /
          candles[candles.length - 2].close) *
        100
      : 0);
  const up = pct >= 0;

  return (
    <div className="ml-auto flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-[var(--wl-font-num)] text-[11px] tabular-nums">
      <Field k="O" v={shown.open} />
      <Field k="H" v={shown.high} />
      <Field k="L" v={shown.low} />
      <Field k="C" v={shown.close} strong />
      <span className={cn("font-medium", up ? "text-[var(--wl-profit)]" : "text-[var(--wl-sell)]")}>
        {up ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
      <span className="text-[var(--wl-muted)]">
        V <span className="text-[var(--wl-text)]">{compact(shown.volume)}</span>
      </span>
      {/* Bar index — the count Elliott time analysis runs on. */}
      <span
        title="Bar index — used by Fibonacci/Lucas time analysis"
        className="rounded-[3px] bg-[var(--wl-subtle)] px-1 text-[var(--wl-muted)]"
      >
        #<span className="text-[var(--wl-text-strong)]">{index}</span>
        <span className="text-[var(--wl-muted)]">/{Math.max(candles.length - 1, 0)}</span>
      </span>
      <span className="sr-only">{config.symbol}</span>
    </div>
  );
}

function Field({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <span className="text-[var(--wl-muted)]">
      {k}{" "}
      <span className={strong ? "font-semibold text-[var(--wl-text-strong)]" : "text-[var(--wl-text)]"}>
        {v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </span>
  );
}

function compact(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
