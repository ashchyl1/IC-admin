"use client";

import * as React from "react";

import { UNDERLYINGS } from "@/lib/scalper/config";
import { pnl, price, toneFor } from "@/lib/scalper/format";
import { useScalper } from "@/lib/scalper/store";
import { usePnl, useWallClock } from "@/lib/scalper/hooks";
import { clock, marketPhase } from "@/lib/scalper/time";
import { Badge, Button, Dot, Kbd, Stat, clsx } from "./ui";

export function Header() {
  const now = useWallClock();
  const snapshot = useScalper((s) => s.snapshot);
  const lastTickAt = useScalper((s) => s.lastTickAt);
  const staleAfterMs = useScalper((s) => s.risk.staleAfterMs);
  const underlying = useScalper((s) => s.underlying);
  const adapterLabel = useScalper((s) => s.adapter?.label ?? "—");
  const isLiveFeed = useScalper((s) => s.adapter?.isLive ?? false);
  const killSwitch = useScalper((s) => s.killSwitch);
  const setSettingsOpen = useScalper((s) => s.setSettingsOpen);
  const setJournalOpen = useScalper((s) => s.setJournalOpen);
  const setShortcutsOpen = useScalper((s) => s.setShortcutsOpen);
  const engageKillSwitch = useScalper((s) => s.engageKillSwitch);
  const resetKillSwitch = useScalper((s) => s.resetKillSwitch);

  const { realized, unrealized, day } = usePnl();

  const phase = marketPhase(now);
  const age = lastTickAt === 0 ? Infinity : now - lastTickAt;
  const stale = age > staleAfterMs;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-[#0d131c] px-3 py-2">
      <div className="flex items-center gap-2">
        <Logo />
        <div className="leading-none">
          <div className="text-[13px] font-bold tracking-tight text-slate-100">Scalper Window</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-500">
            NIFTY · BANKNIFTY options
          </div>
        </div>
      </div>

      <div className="ml-1 flex items-center gap-2 border-l border-slate-800 pl-3">
        <PhaseBadge phase={phase} />
        <span className="font-mono text-xs text-slate-300" aria-label="Indian market time">
          {clock(now)}
          <span className="ml-1 text-[10px] text-slate-500">IST</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
        <Dot tone={lastTickAt === 0 ? "slate" : stale ? "amber" : "green"} />
        <span className="text-[11px] text-slate-400">
          {lastTickAt === 0 ? "connecting" : stale ? `stale ${(age / 1000).toFixed(0)}s` : adapterLabel}
        </span>
        {!isLiveFeed ? <Badge tone="violet">SIM</Badge> : null}
      </div>

      <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
        <span className="text-[11px] font-bold text-slate-200">{UNDERLYINGS[underlying].label}</span>
        {snapshot ? (
          <span className={clsx("font-mono text-xs font-semibold", toneFor(snapshot.spot.change))}>
            {price(snapshot.spot.ltp)}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-4">
        <Stat label="Realised" value={pnl(realized)} tone={toneFor(realized)} />
        <Stat label="Unrealised" value={pnl(unrealized)} tone={toneFor(unrealized)} />
        <div className="rounded-md border border-slate-700 bg-slate-900/70 px-2.5 py-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Day P&amp;L</div>
          <div className={clsx("font-mono text-sm font-bold", toneFor(day))}>{pnl(day)}</div>
        </div>

        <Badge tone="amber" title="No broker is connected. No real order can be placed.">
          Paper trading
        </Badge>

        {killSwitch ? (
          <Button tone="danger" onClick={resetKillSwitch}>
            Reset kill switch
          </Button>
        ) : (
          <Button tone="danger" onClick={engageKillSwitch} title="Exit everything and block new orders">
            Kill switch
          </Button>
        )}

        <Button tone="ghost" onClick={() => setJournalOpen(true)}>
          Journal
        </Button>
        <Button tone="ghost" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts">
          <Kbd>?</Kbd>
        </Button>
        <Button tone="ghost" onClick={() => setSettingsOpen(true)}>
          Settings
        </Button>
      </div>
    </header>
  );
}

function PhaseBadge({ phase }: { phase: ReturnType<typeof marketPhase> }) {
  if (phase === "OPEN") return <Badge tone="green">Market open</Badge>;
  if (phase === "PRE_OPEN") return <Badge tone="amber">Pre-open</Badge>;
  return <Badge tone="red">Market closed</Badge>;
}

function Logo() {
  return (
    <div
      aria-hidden="true"
      className="flex h-7 w-7 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/10"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 11.5 L5.5 7 L8.5 9.5 L14 3.5" className="stroke-cyan-400" strokeLinecap="round" />
        <path d="M11 3.5 H14 V6.5" className="stroke-cyan-400" strokeLinecap="round" />
      </svg>
    </div>
  );
}
