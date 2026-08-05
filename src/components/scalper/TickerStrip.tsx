"use client";

import * as React from "react";

import { pct, price, toneFor } from "@/lib/scalper/format";
import { useScalper } from "@/lib/scalper/store";
import { clsx } from "./ui";

/** Compact market-wide strip: NIFTY, BANKNIFTY, SENSEX, INDIA VIX. */
export function TickerStrip() {
  const indices = useScalper((s) => s.snapshot?.indices);
  const underlying = useScalper((s) => s.underlying);
  const setUnderlying = useScalper((s) => s.setUnderlying);

  if (!indices) {
    return <div className="h-8 shrink-0 border-b border-slate-800 bg-[#0b1119]" aria-hidden="true" />;
  }

  return (
    <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-slate-800 bg-[#0b1119] scroll-thin">
      {indices.map((index) => {
        const selectable = index.label === "NIFTY 50" || index.label === "BANKNIFTY";
        const key = index.label === "NIFTY 50" ? "NIFTY" : "BANKNIFTY";
        const active = selectable && key === underlying;
        const digits = index.label === "INDIA VIX" ? 2 : 2;

        const body = (
          <>
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {index.label}
            </span>
            <span className="font-mono text-xs font-semibold text-slate-100">
              {price(index.ltp, digits)}
            </span>
            <span className={clsx("font-mono text-[11px]", toneFor(index.change))}>
              {index.change >= 0 ? "+" : "−"}
              {Math.abs(index.change).toFixed(2)}
            </span>
            <span className={clsx("font-mono text-[11px]", toneFor(index.change))}>
              ({pct(index.changePct)})
            </span>
          </>
        );

        return selectable ? (
          <button
            key={index.symbol}
            type="button"
            onClick={() => setUnderlying(key)}
            aria-pressed={active}
            className={clsx(
              "flex items-center gap-2 whitespace-nowrap px-3 py-1.5 transition-colors",
              active ? "bg-cyan-950/50 ring-1 ring-inset ring-cyan-700/60" : "hover:bg-slate-900"
            )}
          >
            {body}
          </button>
        ) : (
          <div
            key={index.symbol}
            className="flex items-center gap-2 whitespace-nowrap px-3 py-1.5"
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}
