"use client";

import * as React from "react";

import { compact, price, strikeLabel, toneFor } from "@/lib/scalper/format";
import { useScalper } from "@/lib/scalper/store";
import { expiryLabel } from "@/lib/scalper/time";
import type { ChainRow } from "@/lib/scalper/types";
import { Badge, Panel, clsx } from "./ui";

const NO_CHAIN: ChainRow[] = [];

/**
 * Seven strikes: three below ATM, ATM, three above.
 *
 * Clicking anywhere on a row repoints both option charts and both order cards
 * at that strike — one click, not four.
 */
export function OptionChainPanel() {
  // A fresh [] here would allocate on every selector call, which zustand reads
  // as "changed" forever. Share one empty instance instead.
  const chain = useScalper((s) => s.snapshot?.chain ?? NO_CHAIN);
  const selected = useScalper((s) => s.strike);
  const expiry = useScalper((s) => s.expiry);
  const setStrike = useScalper((s) => s.setStrike);
  const autoAtm = useScalper((s) => s.autoAtm);

  const maxOi = React.useMemo(
    () => Math.max(1, ...chain.flatMap((r) => [r.call.openInterest, r.put.openInterest])),
    [chain]
  );

  return (
    <Panel
      title="Option chain"
      right={
        <>
          {autoAtm ? <Badge tone="cyan">Auto ATM</Badge> : null}
          <Badge>{expiry ? expiryLabel(expiry) : "—"}</Badge>
        </>
      }
      className="min-w-0"
      bodyClassName="overflow-auto scroll-thin"
    >
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 z-10 bg-[#111823]">
          <tr className="text-[9px] uppercase tracking-wide text-slate-500">
            <th className="px-1.5 py-1 text-left font-semibold">LTP</th>
            <th className="px-1 py-1 text-left font-semibold">Bid/Ask</th>
            <th className="px-1 py-1 text-right font-semibold">OI</th>
            <th className="px-1 py-1 text-center font-semibold text-slate-400">Strike</th>
            <th className="px-1 py-1 text-left font-semibold">OI</th>
            <th className="px-1 py-1 text-right font-semibold">Bid/Ask</th>
            <th className="px-1.5 py-1 text-right font-semibold">LTP</th>
          </tr>
          <tr>
            <th colSpan={3} className="border-b border-slate-800 px-1.5 pb-1 text-left text-[10px] font-bold text-emerald-400">
              CALLS
            </th>
            <th className="border-b border-slate-800" />
            <th colSpan={3} className="border-b border-slate-800 px-1.5 pb-1 text-right text-[10px] font-bold text-rose-400">
              PUTS
            </th>
          </tr>
        </thead>
        <tbody>
          {chain.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2 py-6 text-center text-slate-500">
                Waiting for the feed…
              </td>
            </tr>
          ) : (
            chain.map((row) => (
              <Row
                key={row.strike}
                row={row}
                maxOi={maxOi}
                selected={row.strike === selected}
                onSelect={() => setStrike(row.strike)}
              />
            ))
          )}
        </tbody>
      </table>
      <p className="border-t border-slate-800 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
        Click a strike to point both charts and the order pad at it. The OI bars are relative to the
        largest open interest on screen.
      </p>
    </Panel>
  );
}

function Row({
  row,
  maxOi,
  selected,
  onSelect,
}: {
  row: ChainRow;
  maxOi: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`Select strike ${row.strike}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        "cursor-pointer border-b border-slate-800/50 transition-colors",
        selected
          ? "bg-cyan-950/60 outline outline-1 -outline-offset-1 outline-cyan-600"
          : row.isAtm
            ? "bg-slate-800/50 hover:bg-slate-800"
            : "hover:bg-slate-800/60"
      )}
    >
      <td className={clsx("px-1.5 py-1 font-mono font-semibold", toneFor(row.call.change))}>
        {price(row.call.ltp)}
      </td>
      <td className="px-1 py-1 font-mono text-[10px] text-slate-400">
        {row.call.bid.toFixed(2)}/{row.call.ask.toFixed(2)}
      </td>
      <td className="relative px-1 py-1 text-right font-mono text-[10px] text-slate-400">
        <span
          className="absolute inset-y-0.5 right-0 rounded-sm bg-emerald-500/10"
          style={{ width: `${(row.call.openInterest / maxOi) * 100}%` }}
          aria-hidden="true"
        />
        <span className="relative">{compact(row.call.openInterest)}</span>
      </td>
      <td
        className={clsx(
          "px-1 py-1 text-center font-mono text-[11px] font-bold",
          row.isAtm ? "bg-amber-500/15 text-amber-300" : "text-slate-200"
        )}
      >
        {strikeLabel(row.strike)}
        {row.isAtm ? <span className="ml-1 text-[9px] text-amber-400">ATM</span> : null}
      </td>
      <td className="relative px-1 py-1 font-mono text-[10px] text-slate-400">
        <span
          className="absolute inset-y-0.5 left-0 rounded-sm bg-rose-500/10"
          style={{ width: `${(row.put.openInterest / maxOi) * 100}%` }}
          aria-hidden="true"
        />
        <span className="relative">{compact(row.put.openInterest)}</span>
      </td>
      <td className="px-1 py-1 text-right font-mono text-[10px] text-slate-400">
        {row.put.bid.toFixed(2)}/{row.put.ask.toFixed(2)}
      </td>
      <td className={clsx("px-1.5 py-1 text-right font-mono font-semibold", toneFor(row.put.change))}>
        {price(row.put.ltp)}
      </td>
    </tr>
  );
}
