"use client";

import * as React from "react";

import { money, pct, price, strikeLabel, toneFor } from "@/lib/scalper/format";
import { useOrderPreview } from "@/lib/scalper/hooks";
import { useScalper } from "@/lib/scalper/store";
import { expiryLabel } from "@/lib/scalper/time";
import type { OptionType } from "@/lib/scalper/types";
import { Badge, Button, Kbd, Panel, Stepper, clsx } from "./ui";

/**
 * One leg of the scalping keypad.
 *
 * Every button carries the strike it will trade. "Buy Call" is how you end up
 * long the wrong contract when the ATM has moved under you mid-click; "Buy
 * 24,000 CE" is not.
 */
export function OrderCard({ leg }: { leg: OptionType }) {
  const preview = useOrderPreview(leg);
  const lots = useScalper((s) => (leg === "CE" ? s.callLots : s.putLots));
  const setLots = useScalper((s) => s.setLots);
  const bumpLots = useScalper((s) => s.bumpLots);
  const requestOrder = useScalper((s) => s.requestOrder);
  const maxLots = useScalper((s) => s.risk.maxLotsPerOrder);
  const killSwitch = useScalper((s) => s.killSwitch);
  const attachBracket = useScalper((s) => s.attachBracket);
  const position = useScalper((s) =>
    preview ? s.portfolio.positions[preview.contract.symbol] : undefined
  );

  const isCall = leg === "CE";
  const accent = isCall ? "text-emerald-300" : "text-rose-300";
  const buyKey = isCall ? "↑" : "↓";
  const sellKey = isCall ? "←" : "→";

  if (!preview) {
    return (
      <Panel title={isCall ? "Call order" : "Put order"} className="min-w-0">
        <div className="p-4 text-center text-[11px] text-slate-500">Waiting for a quote…</div>
      </Panel>
    );
  }

  const { contract, quote, quantity } = preview;
  const label = `${strikeLabel(contract.strike)} ${contract.optionType}`;
  const wide = preview.spreadPct > 1.5;

  return (
    <Panel
      className="min-w-0"
      title={
        <span className="flex items-center gap-1.5">
          <span className={clsx("font-bold", accent)}>{isCall ? "CALL" : "PUT"}</span>
          <span className="truncate font-mono text-[11px] normal-case text-slate-300">
            {contract.symbol}
          </span>
        </span>
      }
      right={
        <>
          {position ? (
            <Badge tone={position.quantity > 0 ? "green" : "red"}>
              {position.quantity > 0 ? "LONG" : "SHORT"} {Math.abs(position.quantity)}
            </Badge>
          ) : null}
          <Badge tone={preview.moneyness === "ITM" ? "green" : preview.moneyness === "ATM" ? "cyan" : "slate"}>
            {preview.moneyness}
          </Badge>
        </>
      }
    >
      <div className="space-y-2 p-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-slate-100">{price(quote.ltp)}</span>
            <span className={clsx("font-mono text-[11px] font-semibold", toneFor(quote.change))}>
              {pct(quote.changePct)}
            </span>
          </div>
          <div className="text-right text-[10px] text-slate-500">
            {expiryLabel(contract.expiry)} · {contract.lotSize}/lot
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 rounded-md border border-slate-800 bg-slate-900/50 p-1.5 text-center">
          <Cell label="Bid" value={price(quote.bid)} tone="text-emerald-300" />
          <Cell label="Ask" value={price(quote.ask)} tone="text-rose-300" />
          <Cell
            label="Spread"
            value={`${preview.spreadPct.toFixed(2)}%`}
            tone={wide ? "text-amber-300" : "text-slate-300"}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">Lots</span>
          <Stepper
            value={lots}
            onChange={(v) => setLots(leg, v)}
            onBump={(delta) => bumpLots(leg, delta)}
            max={maxLots}
            label={`${label} lots`}
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          <Row label="Quantity" value={`${quantity}`} />
          <Row label="Order value" value={money(preview.estimatedValue)} />
          <Row label="Est. charges" value={money(preview.roundTripCharges)} hint="round trip" />
          <Row
            label="Risk to SL"
            value={preview.risk === null ? "—" : money(preview.risk)}
            tone="text-rose-300"
          />
        </dl>

        {attachBracket ? (
          <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1 text-[10px]">
            <span className="text-slate-500">Bracket</span>
            <span className="font-mono">
              <span className="text-rose-300">SL {preview.stopLoss.toFixed(2)}</span>
              <span className="mx-1 text-slate-600">·</span>
              <span className="text-emerald-300">TGT {preview.target.toFixed(2)}</span>
              <span className="mx-1 text-slate-600">·</span>
              <span className="text-slate-300">{preview.rr ? `${preview.rr}R` : "—"}</span>
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <Button
            tone="buy"
            size="lg"
            disabled={killSwitch}
            onClick={() => requestOrder(leg, "BUY")}
            aria-label={`Buy ${lots} lot${lots > 1 ? "s" : ""} of ${label}`}
            className="flex-col !gap-0 leading-tight"
          >
            <span>Buy {label}</span>
            <span className="text-[10px] font-normal opacity-80">
              @ {preview.buyPrice.toFixed(2)} <Kbd>{buyKey}</Kbd>
            </span>
          </Button>
          <Button
            tone="sell"
            size="lg"
            disabled={killSwitch}
            onClick={() => requestOrder(leg, "SELL")}
            aria-label={`Sell ${lots} lot${lots > 1 ? "s" : ""} of ${label}`}
            className="flex-col !gap-0 leading-tight"
          >
            <span>Sell {label}</span>
            <span className="text-[10px] font-normal opacity-80">
              @ {preview.sellPrice.toFixed(2)} <Kbd>{sellKey}</Kbd>
            </span>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("font-mono text-xs font-semibold", tone ?? "text-slate-200")}>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-slate-500" title={hint}>
        {label}
      </dt>
      <dd className={clsx("font-mono font-semibold", tone ?? "text-slate-300")}>{value}</dd>
    </div>
  );
}
