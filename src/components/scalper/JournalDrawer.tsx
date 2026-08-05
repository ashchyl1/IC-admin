"use client";

import * as React from "react";

import { journalStats } from "@/lib/scalper/engine/portfolio";
import { money, pnl, price, strikeLabel, toneFor } from "@/lib/scalper/format";
import { useScalper } from "@/lib/scalper/store";
import { duration, expiryLabel, hhmmss } from "@/lib/scalper/time";
import type { JournalTrade, Order } from "@/lib/scalper/types";
import { Badge, Button, Drawer, clsx } from "./ui";

/** Completed trades and the raw order log, kept out of the way until asked for. */
export function JournalDrawer() {
  const open = useScalper((s) => s.journalOpen);
  const setOpen = useScalper((s) => s.setJournalOpen);
  const journal = useScalper((s) => s.portfolio.journal);
  const orders = useScalper((s) => s.orders);
  const [tab, setTab] = React.useState<"trades" | "orders">("trades");

  const stats = React.useMemo(() => journalStats(journal), [journal]);
  const rows = React.useMemo(() => journal.slice().reverse(), [journal]);

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="Trade journal"
      width="max-w-5xl"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{stats.trades} closed</span>
          <span className="text-slate-600">·</span>
          <span>
            {stats.wins}W / {stats.losses}L
          </span>
          <span className="text-slate-600">·</span>
          <span>win rate {stats.trades ? `${stats.winRate.toFixed(0)}%` : "—"}</span>
          <span className="text-slate-600">·</span>
          <span className={toneFor(stats.net)}>net {pnl(stats.net)}</span>
          <span className="text-slate-600">·</span>
          <span>charges {money(stats.charges)}</span>
          <span className="text-slate-600">·</span>
          <span>avg hold {stats.trades ? duration(stats.avgHoldMs) : "—"}</span>
        </span>
      }
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-800 bg-[#0d131c] px-4 py-2">
        <Button tone={tab === "trades" ? "accent" : "ghost"} onClick={() => setTab("trades")}>
          Trades ({journal.length})
        </Button>
        <Button tone={tab === "orders" ? "accent" : "ghost"} onClick={() => setTab("orders")}>
          Order log ({orders.length})
        </Button>
        <span className="ml-auto text-[10px] text-slate-500">
          Net P&amp;L is after brokerage, STT, exchange, SEBI, stamp duty and GST.
        </span>
      </div>

      {tab === "trades" ? <TradeTable rows={rows} /> : <OrderTable rows={orders} />}
    </Drawer>
  );
}

function TradeTable({ rows }: { rows: JournalTrade[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-xs text-slate-500">
        No completed trades yet. Every exit writes a row here with its entry, exit, charges and reason.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-[11px]">
      <thead className="sticky top-[41px] bg-[#0d131c] text-[10px] uppercase tracking-wide text-slate-500">
        <tr>
          <Th>Entry</Th>
          <Th>Exit</Th>
          <Th>Held</Th>
          <Th>Instrument</Th>
          <Th>Dir</Th>
          <Th align="right">Qty</Th>
          <Th align="right">Entry ₹</Th>
          <Th align="right">Exit ₹</Th>
          <Th align="right">SL</Th>
          <Th align="right">Target</Th>
          <Th align="right">Charges</Th>
          <Th align="right">Net P&amp;L</Th>
          <Th>Reason</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
            <Td mono>{hhmmss(t.entryTs)}</Td>
            <Td mono>{hhmmss(t.exitTs)}</Td>
            <Td mono>{duration(t.durationMs)}</Td>
            <Td>
              <span className="font-mono text-slate-200">
                {strikeLabel(t.contract.strike)} {t.contract.optionType}
              </span>
              <span className="ml-1 text-[10px] text-slate-500">{expiryLabel(t.contract.expiry)}</span>
            </Td>
            <Td>
              <span
                className={clsx(
                  "rounded px-1 py-px text-[9px] font-bold",
                  t.direction === "LONG"
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "bg-rose-900/60 text-rose-300"
                )}
              >
                {t.direction}
              </span>
            </Td>
            <Td align="right" mono>
              {t.quantity}
            </Td>
            <Td align="right" mono>
              {t.entryPrice.toFixed(2)}
            </Td>
            <Td align="right" mono>
              {t.exitPrice.toFixed(2)}
            </Td>
            <Td align="right" mono>
              {t.stopLoss === null ? "—" : price(t.stopLoss)}
            </Td>
            <Td align="right" mono>
              {t.target === null ? "—" : price(t.target)}
            </Td>
            <Td align="right" mono className="text-slate-400">
              {money(t.charges)}
            </Td>
            <Td align="right" mono className={clsx("font-bold", toneFor(t.netPnl))}>
              {pnl(t.netPnl)}
            </Td>
            <Td>
              <ReasonBadge reason={t.exitReason} />
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrderTable({ rows }: { rows: Order[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-xs text-slate-500">No orders yet.</p>;
  }

  return (
    <table className="w-full border-collapse text-[11px]">
      <thead className="sticky top-[41px] bg-[#0d131c] text-[10px] uppercase tracking-wide text-slate-500">
        <tr>
          <Th>Time</Th>
          <Th>Instrument</Th>
          <Th>Side</Th>
          <Th align="right">Lots</Th>
          <Th align="right">Qty</Th>
          <Th align="right">Ref ₹</Th>
          <Th align="right">Fill ₹</Th>
          <Th align="right">Slippage</Th>
          <Th align="right">Charges</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
            <Td mono>{hhmmss(o.ts)}</Td>
            <Td mono>
              {strikeLabel(o.contract.strike)} {o.contract.optionType}
            </Td>
            <Td>
              <span className={o.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{o.side}</span>
            </Td>
            <Td align="right" mono>
              {o.lots}
            </Td>
            <Td align="right" mono>
              {o.quantity}
            </Td>
            <Td align="right" mono>
              {o.fill ? o.fill.referencePrice.toFixed(2) : "—"}
            </Td>
            <Td align="right" mono>
              {o.fill ? o.fill.fillPrice.toFixed(2) : "—"}
            </Td>
            <Td align="right" mono className="text-amber-300">
              {o.fill ? o.fill.slippage.toFixed(2) : "—"}
            </Td>
            <Td align="right" mono className="text-slate-400">
              {o.fill ? money(o.fill.charges.total) : "—"}
            </Td>
            <Td>
              {o.status === "FILLED" ? (
                <Badge tone="green">Filled</Badge>
              ) : (
                <span title={o.rejectReason}>
                  <Badge tone="red">Rejected</Badge>
                </span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReasonBadge({ reason }: { reason: JournalTrade["exitReason"] }) {
  const map: Record<string, { tone: "slate" | "green" | "red" | "amber"; label: string }> = {
    MANUAL: { tone: "slate", label: "Manual" },
    STOP_LOSS: { tone: "red", label: "Stop-loss" },
    TARGET: { tone: "green", label: "Target" },
    KILL_SWITCH: { tone: "red", label: "Kill switch" },
    EXIT_ALL: { tone: "amber", label: "Exit all" },
    MAX_DAILY_LOSS: { tone: "red", label: "Daily cap" },
  };
  const entry = map[reason] ?? map.MANUAL;
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={clsx("px-2 py-1.5 font-semibold", align === "right" ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono,
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={clsx(
        "px-2 py-1 text-slate-300",
        align === "right" ? "text-right" : "text-left",
        mono && "font-mono",
        className
      )}
    >
      {children}
    </td>
  );
}
