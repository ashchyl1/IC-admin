"use client";

import * as React from "react";

import { price } from "@/lib/scalper/format";
import { useMtf } from "@/lib/scalper/hooks";
import type { Bias, MtfCell } from "@/lib/scalper/types";
import { clsx } from "./ui";

const LABELS: Record<string, string> = { "5m": "5 min", "15m": "15 min", "1h": "1 hour", "1d": "Daily" };

/**
 * Multi-timeframe traffic lights.
 *
 * Bullish = close above both VWAP and the 20 EMA; bearish = below both;
 * anything mixed is neutral. Blunt on purpose: it is a glance, not a signal.
 */
export function MtfStrip() {
  const cells = useMtf();

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-[#0b1119] px-3 py-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Trend</span>
      <div className="flex items-center gap-1.5">
        {cells.length === 0
          ? ["5m", "15m", "1h", "1d"].map((tf) => <Cell key={tf} timeframe={tf} bias="NEUTRAL" />)
          : cells.map((cell) => <Cell key={cell.timeframe} timeframe={cell.timeframe} bias={cell.bias} detail={cell} />)}
      </div>
      <span className="ml-2 text-[10px] text-slate-600">
        price vs VWAP + 20 EMA
      </span>
    </div>
  );
}

function Cell({ timeframe, bias, detail }: { timeframe: string; bias: Bias; detail?: MtfCell }) {
  const tone =
    bias === "BULLISH"
      ? "border-emerald-700/70 bg-emerald-900/40 text-emerald-300"
      : bias === "BEARISH"
        ? "border-rose-700/70 bg-rose-900/40 text-rose-300"
        : "border-slate-700 bg-slate-800/60 text-slate-400";

  const title = detail
    ? `${LABELS[timeframe] ?? timeframe}: close ${price(detail.close)} · VWAP ${price(detail.vwap)} · 20 EMA ${price(detail.ema20)}`
    : `${LABELS[timeframe] ?? timeframe}: no data yet`;

  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-bold",
        tone
      )}
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          bias === "BULLISH" ? "bg-emerald-400" : bias === "BEARISH" ? "bg-rose-400" : "bg-slate-500"
        )}
        aria-hidden="true"
      />
      {LABELS[timeframe] ?? timeframe}
      <span className="sr-only">
        {bias === "BULLISH" ? "bullish" : bias === "BEARISH" ? "bearish" : "neutral"}
      </span>
    </span>
  );
}
