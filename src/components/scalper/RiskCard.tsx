"use client";

import * as React from "react";

import { money, pnl, price, strikeLabel, toneFor } from "@/lib/scalper/format";
import { unrealizedPnl } from "@/lib/scalper/engine/portfolio";
import { riskReward } from "@/lib/scalper/engine/risk";
import { usePnl } from "@/lib/scalper/hooks";
import { useScalper } from "@/lib/scalper/store";
import type { Position } from "@/lib/scalper/types";
import { Badge, Button, Kbd, Panel, clsx } from "./ui";

/** The centre pad: what you are risking, what you have made, and the way out. */
export function RiskCard() {
  const positions = useScalper((s) => s.portfolio.positions);
  const selectedKey = useScalper((s) => s.selectedPositionKey);
  const setSelected = useScalper((s) => s.setSelectedPosition);
  const exitPosition = useScalper((s) => s.exitPosition);
  const exitAll = useScalper((s) => s.exitAll);
  const maxDailyLoss = useScalper((s) => s.risk.maxDailyLoss);
  const maxLossPerTrade = useScalper((s) => s.risk.maxLossPerTrade);
  const killSwitch = useScalper((s) => s.killSwitch);
  const attachBracket = useScalper((s) => s.attachBracket);
  const setAttachBracket = useScalper((s) => s.setAttachBracket);

  const { realized, unrealized, day, charges } = usePnl();

  const list = React.useMemo(
    () => Object.values(positions).sort((a, b) => a.openedAt - b.openedAt),
    [positions]
  );
  const selected = selectedKey ? positions[selectedKey] : undefined;
  const active = selected ?? list[0];

  // How far into the daily loss budget the day has travelled.
  const drawdownPct = day >= 0 ? 0 : Math.min(100, (Math.abs(day) / maxDailyLoss) * 100);

  const rr = active
    ? riskReward(
        active.stopLoss === null
          ? null
          : Math.abs(active.averagePrice - active.stopLoss) * Math.abs(active.quantity),
        active.target === null
          ? null
          : Math.abs(active.target - active.averagePrice) * Math.abs(active.quantity)
      )
    : null;

  return (
    <Panel
      title="Risk & P&L"
      right={
        <>
          {killSwitch ? <Badge tone="red">Locked</Badge> : null}
          <Badge tone={list.length > 0 ? "cyan" : "slate"}>
            {list.length} open
          </Badge>
        </>
      }
      className="min-w-0"
      bodyClassName="flex flex-col min-h-0"
    >
      <div className="grid grid-cols-3 gap-1.5 border-b border-slate-800/70 p-2.5">
        <Big label="Open P&L" value={pnl(unrealized)} tone={toneFor(unrealized)} />
        <Big label="Realised today" value={pnl(realized)} tone={toneFor(realized)} />
        <Big label="Day total" value={pnl(day)} tone={toneFor(day)} />
      </div>

      <div className="border-b border-slate-800/70 px-2.5 py-2">
        <div className="flex items-baseline justify-between text-[10px]">
          <span className="text-slate-500">Daily loss budget</span>
          <span className="font-mono text-slate-400">
            {money(Math.max(0, -day))} <span className="text-slate-600">/ {money(maxDailyLoss)}</span>
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={clsx(
              "h-full rounded-full transition-all",
              drawdownPct > 80 ? "bg-rose-500" : drawdownPct > 50 ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${drawdownPct}%` }}
            role="progressbar"
            aria-valuenow={Math.round(drawdownPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Daily loss budget used"
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>Max per trade {money(maxLossPerTrade)}</span>
          <span>Charges today {money(charges)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 border-b border-slate-800/70 px-2.5 py-2 text-center">
        <Small label="Stop-loss" value={active?.stopLoss != null ? price(active.stopLoss) : "—"} tone="text-rose-300" />
        <Small label="Target" value={active?.target != null ? price(active.target) : "—"} tone="text-emerald-300" />
        <Small label="Risk : reward" value={rr ? `1 : ${rr}` : "—"} tone="text-slate-200" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {list.length === 0 ? (
          <p className="px-2.5 py-4 text-center text-[11px] text-slate-500">
            Flat. Use the pads either side, or the arrow keys.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {list.map((position) => (
              <PositionRow
                key={position.key}
                position={position}
                selected={position.key === (selectedKey ?? list[0]?.key)}
                onSelect={() => setSelected(position.key)}
                onExit={() => exitPosition(position.key, "MANUAL")}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-slate-800/70 p-2">
        <label className="flex items-center justify-between text-[10px] text-slate-400">
          <span>Attach SL &amp; target to new entries</span>
          <input
            type="checkbox"
            checked={attachBracket}
            onChange={(e) => setAttachBracket(e.target.checked)}
            aria-label="Attach stop-loss and target to new entries"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            tone="neutral"
            size="md"
            disabled={!active}
            onClick={() => active && exitPosition(active.key, "MANUAL")}
          >
            Exit selected
          </Button>
          <Button tone="danger" size="md" disabled={list.length === 0} onClick={() => exitAll("EXIT_ALL")}>
            Exit all <Kbd>⇧X</Kbd>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function PositionRow({
  position,
  selected,
  onSelect,
  onExit,
}: {
  position: Position;
  selected: boolean;
  onSelect: () => void;
  onExit: () => void;
}) {
  const open = unrealizedPnl(position, position.lastPrice);
  const long = position.quantity > 0;

  return (
    <li>
      <div
        className={clsx(
          "flex items-center gap-2 px-2.5 py-1.5 text-[11px]",
          selected && "bg-cyan-950/40 outline outline-1 -outline-offset-1 outline-cyan-800/60"
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={clsx(
              "rounded px-1 py-px text-[9px] font-bold",
              long ? "bg-emerald-900/60 text-emerald-300" : "bg-rose-900/60 text-rose-300"
            )}
          >
            {long ? "LONG" : "SHORT"}
          </span>
          <span className="truncate font-mono font-semibold text-slate-200">
            {strikeLabel(position.contract.strike)} {position.contract.optionType}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {Math.abs(position.quantity)} @ {position.averagePrice.toFixed(2)}
          </span>
          <span className="ml-auto font-mono text-[10px] text-slate-400">
            {position.lastPrice.toFixed(2)}
          </span>
          <span className={clsx("w-20 text-right font-mono font-bold", toneFor(open))}>{pnl(open)}</span>
        </button>
        <Button tone="ghost" onClick={onExit} aria-label={`Exit ${position.contract.symbol}`}>
          Exit
        </Button>
      </div>
    </li>
  );
}

function Big({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("font-mono text-sm font-bold", tone)}>{value}</div>
    </div>
  );
}

function Small({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("font-mono text-xs font-semibold", tone)}>{value}</div>
    </div>
  );
}
