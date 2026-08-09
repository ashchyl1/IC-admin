"use client";

/**
 * Paper trading, taken from the wave count.
 *
 * **Simulated only.** No broker is connected and nothing here can place an
 * order — the same stance as the rest of this app.
 *
 * The ticket is prefilled from the selected count rather than from thin air:
 * the stop comes from the count's own invalidation level, the target from a
 * Fibonacci projection of the pattern, and the quantity from the risk you are
 * willing to put behind it. That is the whole argument for trading inside the
 * analysis tool instead of beside it — the numbers that justify the trade are
 * already on screen.
 */

import * as React from "react";
import { Ban, TrendingDown, TrendingUp, Trash2 } from "lucide-react";

import type { MarketCandle } from "@/lib/market/types";
import { decorateLabel, DEGREES } from "@/lib/wave/degrees";
import { computeMetrics } from "@/lib/wave/metrics";
import {
  DEFAULT_COSTS,
  pnlOf,
  rMultiple,
  rewardRisk,
  riskOf,
  sizeForRisk,
  summarise,
  validateTicket,
  type PaperPosition,
  type Side,
} from "@/lib/wave/paper";
import { TOOLS } from "@/lib/wave/patterns";
import { validate } from "@/lib/wave/rules";
import { useWaveStore } from "@/lib/wave/store";
import { barIndexer, type TerminalState } from "@/lib/wave/types";
import { Badge, Button, clsx } from "@/components/scalper/ui";

interface Props {
  terminal: TerminalState;
  candles: MarketCandle[];
}

export function PaperTradePanel({ terminal, candles }: Props) {
  const store = useWaveStore();
  const last = candles[candles.length - 1]?.close ?? null;

  const selected = terminal.drawings.find((drawing) => drawing.id === terminal.selectedId) ?? null;

  /** Stop and target suggested by the selected count, if there is one. */
  const suggestion = React.useMemo(() => {
    if (!selected || !TOOLS[selected.tool].elliott) return null;
    const metrics = computeMetrics(selected, candles, barIndexer(candles));
    if (!metrics) return null;
    const verdict = validate(selected, metrics);

    // Project the next leg from the pattern's own proportions: a 1.618
    // extension of the first leg measured from the last pivot is the standard
    // third-wave target, and the least arbitrary number available here.
    const firstLeg = metrics.legs[0]?.length ?? 0;
    const lastPivot = metrics.endPrice;
    const projected = metrics.direction > 0 ? lastPivot + firstLeg * 1.618 : lastPivot - firstLeg * 1.618;

    return {
      label: `${DEGREES[selected.degree].label} ${TOOLS[selected.tool].labels
        .map((base) => decorateLabel(base, selected.degree))
        .join("-")}`,
      side: (metrics.direction > 0 ? "BUY" : "SELL") as Side,
      stop: verdict.invalidation ? round2(verdict.invalidation.price) : null,
      stopReason: verdict.invalidation?.reason ?? null,
      target: Number.isFinite(projected) ? round2(projected) : null,
      tier: verdict.tier,
    };
  }, [selected, candles]);

  const [side, setSide] = React.useState<Side>("BUY");
  const [quantity, setQuantity] = React.useState(1);
  const [entry, setEntry] = React.useState<number | null>(null);
  const [stop, setStop] = React.useState<number | null>(null);
  const [target, setTarget] = React.useState<number | null>(null);
  const [risk, setRisk] = React.useState(5_000);
  const [linkCount, setLinkCount] = React.useState(true);

  // Follow the selected count: picking a different one re-arms the ticket.
  React.useEffect(() => {
    if (!suggestion) return;
    setSide(suggestion.side);
    setStop(suggestion.stop);
    setTarget(suggestion.target);
  }, [suggestion]);

  const entryPrice = entry ?? last;
  const suggestedQty = entryPrice !== null ? sizeForRisk(entryPrice, stop, risk) : null;
  const rr = entryPrice !== null ? rewardRisk(entryPrice, stop, target) : null;

  const lastFor = React.useCallback(() => last, [last]);
  const summary = summarise(store.positions, lastFor, DEFAULT_COSTS);
  const open = store.positions.filter((position) => position.status === "OPEN");
  const closed = store.positions.filter((position) => position.status === "CLOSED").reverse();

  const problems = validateTicket(side, entryPrice, stop, target, quantity);
  const canTrade = problems.length === 0;

  const submit = () => {
    if (entryPrice === null) return;
    store.openTrade({
      terminalId: terminal.id,
      symbol: terminal.symbol,
      title: terminal.title,
      side,
      quantity,
      entryPrice,
      entryTime: candles[candles.length - 1]?.time ?? Math.floor(Date.now() / 1000),
      stopLoss: stop,
      target,
      drawingId: linkCount ? selected?.id : undefined,
      drawingLabel: linkCount ? suggestion?.label : undefined,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 border-b border-slate-800 bg-amber-950/30 px-3 py-1.5 text-[10px] leading-relaxed text-amber-200/90">
        <strong className="font-bold">Paper trading.</strong> Simulated fills only — no broker is
        connected and no order can reach an exchange.
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ------------------------------------------------------- ticket --- */}
        <section className="border-b border-slate-800 p-3">
          {suggestion ? (
            <div className="mb-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-[10px] leading-relaxed text-slate-400">
              Prefilled from{" "}
              <span className="font-semibold" style={{ color: DEGREES[selected!.degree].color }}>
                {suggestion.label}
              </span>{" "}
              <Badge tone={suggestion.tier === "Pass" ? "red" : suggestion.tier === "High" ? "green" : "amber"}>
                {suggestion.tier}
              </Badge>
              {suggestion.stopReason ? <span className="block mt-0.5">Stop: {suggestion.stopReason}</span> : null}
              {suggestion.tier === "Pass" ? (
                <span className="mt-0.5 block font-semibold text-rose-300">
                  This count breaks a hard rule. The SOP says re-label rather than trade it.
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
              Select a wave count on the chart to prefill the stop from its invalidation level and the
              target from its Fibonacci projection.
            </p>
          )}

          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {(["BUY", "SELL"] as Side[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={side === option}
                onClick={() => setSide(option)}
                className={clsx(
                  "flex items-center justify-center gap-1.5 rounded-md border py-1.5 text-[11px] font-bold transition-colors",
                  side === option
                    ? option === "BUY"
                      ? "border-emerald-500/60 bg-emerald-600/25 text-emerald-200"
                      : "border-rose-500/60 bg-rose-600/25 text-rose-200"
                    : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                )}
              >
                {option === "BUY" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {option}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Field label="Entry" hint={last !== null ? `last ${fmt(last)}` : undefined}>
              <NumberBox value={entryPrice} onChange={setEntry} placeholder="market" />
            </Field>
            <Field label="Stop">
              <NumberBox value={stop} onChange={setStop} placeholder="none" />
            </Field>
            <Field label="Target">
              <NumberBox value={target} onChange={setTarget} placeholder="none" />
            </Field>
            <Field label="Risk ₹" hint={suggestedQty ? `→ ${suggestedQty} qty` : "set a stop to size"}>
              <NumberBox value={risk} onChange={(value) => setRisk(value ?? 0)} />
            </Field>
            <Field label="Quantity">
              <span className="flex items-center gap-1">
                <NumberBox value={quantity} onChange={(value) => setQuantity(Math.max(1, value ?? 1))} />
                {suggestedQty && suggestedQty !== quantity ? (
                  <button
                    type="button"
                    onClick={() => setQuantity(suggestedQty)}
                    className="rounded border border-slate-700 px-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
                    title="Use the size that risks exactly the amount above"
                  >
                    use {suggestedQty}
                  </button>
                ) : null}
              </span>
            </Field>
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
            <span>
              Risk{" "}
              <span className="font-mono text-slate-300">
                {entryPrice !== null && stop !== null
                  ? fmt(Math.abs(entryPrice - stop) * quantity)
                  : "—"}
              </span>
            </span>
            <span>
              R:R <span className="font-mono text-slate-300">{rr === null ? "—" : `1:${rr.toFixed(2)}`}</span>
            </span>
          </div>

          {selected ? (
            <label className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={linkCount}
                onChange={(event) => setLinkCount(event.target.checked)}
                className="h-3 w-3 accent-cyan-500"
              />
              Link this trade to the selected count
            </label>
          ) : null}

          {problems.length > 0 ? (
            <ul className="mt-2 space-y-0.5 rounded border border-rose-800/60 bg-rose-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-rose-200">
              {problems.map((problem) => (
                <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
              ))}
            </ul>
          ) : null}

          <Button
            tone={side === "BUY" ? "buy" : "sell"}
            size="md"
            disabled={!canTrade}
            onClick={submit}
            className="mt-2 w-full"
          >
            Paper {side} {quantity} {terminal.title}
          </Button>
        </section>

        {/* ---------------------------------------------------- portfolio --- */}
        <section className="border-b border-slate-800 p-3">
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <Stat label="Net P&L" value={fmt(summary.net)} tone={toneOf(summary.net)} />
            <Stat label="Realised" value={fmt(summary.realised)} tone={toneOf(summary.realised)} />
            <Stat label="Open" value={String(summary.open)} />
            <Stat
              label="Win rate"
              value={summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`}
            />
            <Stat label="Total R" value={summary.totalR === null ? "—" : summary.totalR.toFixed(2)} tone={toneOf(summary.totalR ?? 0)} />
            <Stat label="Trades" value={String(summary.closed)} />
          </div>
        </section>

        {/* ---------------------------------------------------- positions --- */}
        <Section title={`Open positions (${open.length})`}>
          {open.length === 0 ? (
            <p className="text-[10px] text-slate-600">Nothing open.</p>
          ) : (
            open.map((position) => (
              <PositionRow
                key={position.id}
                position={position}
                last={last}
                onClose={() => last !== null && store.closeTrade(position.id, last, "MANUAL")}
              />
            ))
          )}
        </Section>

        <Section
          title={`Closed (${closed.length})`}
          right={
            closed.length > 0 ? (
              <button
                type="button"
                onClick={store.clearClosedTrades}
                title="Clear the closed-trade journal"
                className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null
          }
        >
          {closed.length === 0 ? (
            <p className="text-[10px] text-slate-600">No closed trades yet.</p>
          ) : (
            closed.map((position) => <PositionRow key={position.id} position={position} last={null} />)
          )}
        </Section>
      </div>
    </div>
  );
}

function PositionRow({
  position,
  last,
  onClose,
}: {
  position: PaperPosition;
  last: number | null;
  onClose?: () => void;
}) {
  const pnl = pnlOf(position, last);
  const r = rMultiple(position, last);
  const risk = riskOf(position);

  return (
    <div className="border-t border-slate-800/60 py-1.5 first:border-0">
      <div className="flex items-center gap-1.5">
        <Badge tone={position.side === "BUY" ? "green" : "red"}>{position.side}</Badge>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-200">
          {position.quantity} × {position.title}
        </span>
        <span className={clsx("font-mono text-[11px] font-bold", toneOf(pnl))}>{fmt(pnl)}</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            title="Close at the last price"
            aria-label="Close position"
            className="rounded p-0.5 text-slate-500 hover:bg-rose-900/40 hover:text-rose-300"
          >
            <Ban className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
        <span>in {fmt(position.entryPrice)}</span>
        {position.stopLoss !== null ? <span>sl {fmt(position.stopLoss)}</span> : null}
        {position.target !== null ? <span>tgt {fmt(position.target)}</span> : null}
        {position.exit ? (
          <span className="text-slate-400">
            out {fmt(position.exit.price)} ({position.exit.reason.toLowerCase()})
          </span>
        ) : null}
        {r !== null ? <span className={toneOf(r)}>{r.toFixed(2)}R</span> : null}
        {risk !== null && position.status === "OPEN" ? <span>risk {fmt(risk)}</span> : null}
        {position.charges > 0 ? <span>fees {fmt(position.charges)}</span> : null}
      </div>

      {position.drawingLabel ? (
        <div className="mt-0.5 truncate text-[10px] text-slate-500">on {position.drawingLabel}</div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-800 p-3 last:border-0">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-slate-400">
        {label}
        {hint ? <span className="ml-1 text-[10px] text-slate-600">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function NumberBox({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") return onChange(null);
        const next = Number(raw);
        if (Number.isFinite(next)) onChange(next);
      }}
      className="h-6 w-24 rounded border border-slate-800 bg-slate-900 px-1.5 text-right font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
    />
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("truncate font-mono text-[11px] font-bold", tone ?? "text-slate-200")}>
        {value}
      </div>
    </div>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toneOf(value: number): string {
  return value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-slate-300";
}

function fmt(value: number): string {
  const abs = Math.abs(value);
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: abs >= 1000 ? 0 : 2,
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
  });
}
