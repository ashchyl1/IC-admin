"use client";

import * as React from "react";

import { useScalper } from "@/lib/scalper/store";
import { Button, Drawer, NumberField, Toggle } from "./ui";

/** Every guard, cost and fill assumption, editable and explained. */
export function SettingsDrawer() {
  const open = useScalper((s) => s.settingsOpen);
  const setOpen = useScalper((s) => s.setSettingsOpen);
  const risk = useScalper((s) => s.risk);
  const updateRisk = useScalper((s) => s.updateRisk);
  const execution = useScalper((s) => s.execution);
  const updateExecution = useScalper((s) => s.updateExecution);
  const costs = useScalper((s) => s.costs);
  const updateCosts = useScalper((s) => s.updateCosts);
  const resetSession = useScalper((s) => s.resetSession);
  const restartFeed = useScalper((s) => s.restartFeed);
  const feedLabel = useScalper((s) => s.adapter?.label ?? "—");
  const isLive = useScalper((s) => s.adapter?.isLive ?? false);

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="Settings"
      width="max-w-2xl"
      subtitle="Risk limits, fill assumptions and transaction costs. Changes apply to the next order."
    >
      <div className="space-y-5 p-4">
        <Section
          title="Risk limits"
          note="Breaching a limit blocks the order and records it as rejected — nothing silently shrinks your size."
        >
          <NumberField
            label="Max loss per trade"
            value={risk.maxLossPerTrade}
            onChange={(v) => updateRisk({ maxLossPerTrade: v })}
            step={500}
            suffix="₹"
          />
          <NumberField
            label="Max daily loss"
            value={risk.maxDailyLoss}
            onChange={(v) => updateRisk({ maxDailyLoss: v })}
            step={1000}
            suffix="₹"
          />
          <NumberField
            label="Max lots per order"
            value={risk.maxLotsPerOrder}
            onChange={(v) => updateRisk({ maxLotsPerOrder: v })}
            min={1}
          />
          <NumberField
            label="Max open lots"
            value={risk.maxOpenLots}
            onChange={(v) => updateRisk({ maxOpenLots: v })}
            min={1}
          />
          <div className="pt-1">
            <Toggle
              checked={risk.confirmBeforeSell}
              onChange={(v) => updateRisk({ confirmBeforeSell: v })}
              label="Confirm before selling an option"
              hint="Applies even when instant orders are on"
            />
          </div>
        </Section>

        <Section title="Brackets" note="Applied to new entries when 'Attach SL & target' is on.">
          <NumberField
            label="Default stop-loss"
            value={risk.defaultStopPct}
            onChange={(v) => updateRisk({ defaultStopPct: v })}
            step={5}
            suffix="%"
          />
          <NumberField
            label="Default target"
            value={risk.defaultTargetPct}
            onChange={(v) => updateRisk({ defaultTargetPct: v })}
            step={5}
            suffix="%"
          />
        </Section>

        <Section
          title="Warnings and throttles"
          note="Stale and wide-spread checks warn; the duplicate and burst guards block."
        >
          <NumberField
            label="Stale price after"
            value={risk.staleAfterMs}
            onChange={(v) => updateRisk({ staleAfterMs: v })}
            step={1000}
            suffix="ms"
          />
          <NumberField
            label="Wide-spread threshold"
            value={risk.wideSpreadPct}
            onChange={(v) => updateRisk({ wideSpreadPct: v })}
            step={0.25}
            suffix="%"
          />
          <NumberField
            label="Duplicate-order window"
            value={risk.duplicateWindowMs}
            onChange={(v) => updateRisk({ duplicateWindowMs: v })}
            step={100}
            suffix="ms"
          />
          <NumberField
            label="Burst limit"
            value={risk.burstLimit}
            onChange={(v) => updateRisk({ burstLimit: v })}
            min={1}
          />
          <NumberField
            label="Burst window"
            value={risk.cooldownWindowMs}
            onChange={(v) => updateRisk({ cooldownWindowMs: v })}
            step={500}
            suffix="ms"
          />
          <NumberField
            label="Cooldown lock"
            value={risk.cooldownLockMs}
            onChange={(v) => updateRisk({ cooldownLockMs: v })}
            step={1000}
            suffix="ms"
          />
        </Section>

        <Section
          title="Fill simulation"
          note="Fills are priced from the mid, so slippage reports everything you gave up — including the half-spread you cross."
        >
          <NumberField
            label="Extra spread paid"
            value={execution.slippageSpreadFraction}
            onChange={(v) => updateExecution({ slippageSpreadFraction: v })}
            step={0.05}
            suffix="×½"
          />
          <NumberField
            label="Fixed slippage"
            value={execution.slippageTicks}
            onChange={(v) => updateExecution({ slippageTicks: v })}
            step={0.05}
            suffix="₹"
          />
          <NumberField
            label="Tick size"
            value={execution.tickSize}
            onChange={(v) => updateExecution({ tickSize: v })}
            step={0.05}
            suffix="₹"
          />
        </Section>

        <Section title="Transaction costs" note="Indicative NSE options rates. Set them to your broker's sheet.">
          <NumberField
            label="Brokerage per order"
            value={costs.brokeragePerOrder}
            onChange={(v) => updateCosts({ brokeragePerOrder: v })}
            suffix="₹"
          />
          <NumberField
            label="STT (sell side)"
            value={costs.sttSellRate * 100}
            onChange={(v) => updateCosts({ sttSellRate: v / 100 })}
            step={0.01}
            suffix="%"
          />
          <NumberField
            label="Exchange transaction"
            value={costs.exchangeTxnRate * 100}
            onChange={(v) => updateCosts({ exchangeTxnRate: v / 100 })}
            step={0.001}
            suffix="%"
          />
          <NumberField
            label="Stamp duty (buy side)"
            value={costs.stampDutyBuyRate * 100}
            onChange={(v) => updateCosts({ stampDutyBuyRate: v / 100 })}
            step={0.001}
            suffix="%"
          />
          <NumberField
            label="GST"
            value={costs.gstRate * 100}
            onChange={(v) => updateCosts({ gstRate: v / 100 })}
            step={1}
            suffix="%"
          />
        </Section>

        <Section title="Session" note={`Feed: ${feedLabel}${isLive ? "" : " (simulated)"}`}>
          <div className="flex flex-wrap gap-2 pt-1">
            {!isLive ? (
              <Button tone="neutral" size="md" onClick={restartFeed}>
                Restart demo session
              </Button>
            ) : null}
            <Button
              tone="danger"
              size="md"
              onClick={() => {
                resetSession();
                setOpen(false);
              }}
            >
              Clear positions, orders &amp; journal
            </Button>
          </div>
          <p className="pt-2 text-[10px] leading-relaxed text-slate-500">
            Nothing here reaches a broker. This build has no order-placement path to any exchange — the
            only execution code is the local paper engine.
          </p>
        </Section>
      </div>
    </Drawer>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-[#111823] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300">{title}</h3>
      {note ? <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{note}</p> : null}
      <div className="mt-2.5 space-y-1.5">{children}</div>
    </section>
  );
}
