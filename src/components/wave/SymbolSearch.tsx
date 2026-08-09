"use client";

/**
 * Instrument picker.
 *
 * Queries `/api/market/search`, which resolves through whichever Zerodha path
 * is configured — so the list here is the broker's real instrument master, not
 * a hard-coded set. Debounced, because the Kite instrument dump is large and
 * every keystroke would otherwise re-rank a hundred thousand rows.
 */

import * as React from "react";
import { Search } from "lucide-react";

import type { Instrument } from "@/lib/market/types";
import { clsx } from "@/components/scalper/ui";

interface Props {
  value: string;
  title: string;
  onPick: (instrument: Instrument) => void;
}

export function SymbolSearch({ value, title, onPick }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Instrument[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || query.trim().length < 1) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/market/search?q=${encodeURIComponent(query)}&limit=25`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { instruments?: Instrument[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setResults(payload.instruments ?? []);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          setError(caught instanceof Error ? caught.message : "Search failed");
        }
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={value}
        className="flex h-7 max-w-[210px] items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 px-2 text-xs font-bold text-slate-100 hover:border-slate-700"
      >
        <Search className="h-3 w-3 shrink-0 text-slate-500" />
        <span className="truncate">{title}</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-8 z-40 w-80 rounded-md border border-slate-700 bg-[#0f1725] p-1.5 shadow-2xl">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search NIFTY, INFY, BANKNIFTY futures…"
            aria-label="Search instruments"
            className="h-8 w-full rounded border border-slate-800 bg-slate-900 px-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
          />

          <div className="mt-1 max-h-72 overflow-y-auto" role="listbox">
            {loading ? <Row muted>Searching…</Row> : null}
            {error ? <Row tone="error">{error}</Row> : null}
            {!loading && !error && query.trim() !== "" && results.length === 0 ? (
              <Row muted>No instruments matched.</Row>
            ) : null}

            {results.map((instrument) => (
              <button
                key={`${instrument.exchange}:${instrument.tradingSymbol}:${instrument.instrumentToken}`}
                type="button"
                role="option"
                aria-selected={instrument.key === value}
                onClick={() => {
                  onPick(instrument);
                  setOpen(false);
                  setQuery("");
                }}
                className={clsx(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                  instrument.key === value ? "bg-slate-800" : "hover:bg-slate-800/70"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold text-slate-100">
                    {instrument.tradingSymbol}
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {instrument.name ?? instrument.segment ?? instrument.exchange}
                  </span>
                </span>
                <span className="shrink-0 rounded border border-slate-700 px-1 py-px text-[9px] font-bold text-slate-400">
                  {instrument.exchange}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  children,
  muted,
  tone,
}: {
  children: React.ReactNode;
  muted?: boolean;
  tone?: "error";
}) {
  return (
    <div
      className={clsx(
        "px-2 py-2 text-[11px]",
        tone === "error" ? "text-rose-300" : muted ? "text-slate-500" : "text-slate-300"
      )}
    >
      {children}
    </div>
  );
}
