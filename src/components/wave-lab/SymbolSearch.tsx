"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Instrument } from "@/lib/wave-lab/types";

interface Props {
  value: string;
  onSelect: (key: string) => void;
}

/** Exchange-qualified symbol picker backed by the provider's list (§3). */
export function SymbolSearch({ value, onSelect }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Instrument[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // Debounced: a request per keystroke would burn the instrument endpoint.
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/wave-lab/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || "Search failed.");
        setResults(json.instruments ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed.");
          setResults([]);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(key: string) {
    onSelect(key);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-[3px] border border-[var(--wl-border)] px-2 py-1 text-[13px] font-semibold text-[var(--wl-text-strong)] transition-colors hover:bg-[var(--wl-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-blue)]"
      >
        <Search className="h-3.5 w-3.5 text-[var(--wl-muted)]" />
        {value}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-[3px] border border-[var(--wl-border)] bg-[var(--wl-bg)] shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search NSE instruments…"
            aria-label="Search instruments"
            className="w-full border-b border-[var(--wl-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--wl-text)] outline-none placeholder:text-[var(--wl-muted)]"
          />
          <div className="max-h-72 overflow-y-auto">
            {busy && <p className="px-3 py-2 text-xs text-[var(--wl-muted)]">Searching…</p>}
            {error && <p className="px-3 py-2 text-xs text-[var(--wl-sell)]">{error}</p>}
            {!busy && !error && query.trim() && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--wl-muted)]">
                Nothing matched “{query.trim()}”.
              </p>
            )}
            {results.map((inst) => (
              <button
                key={inst.key}
                type="button"
                onClick={() => choose(inst.key)}
                className={cn(
                  "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--wl-hover)]",
                  inst.key === value && "bg-[var(--wl-hover)]"
                )}
              >
                <span className="font-medium text-[var(--wl-text-strong)]">
                  {inst.tradingSymbol}
                </span>
                <span className="truncate text-xs text-[var(--wl-muted)]">{inst.name}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--wl-muted)]">
                  {inst.exchange}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
