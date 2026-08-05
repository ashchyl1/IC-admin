"use client";

import * as React from "react";

import { money, price, strikeLabel } from "@/lib/scalper/format";
import { useScalper } from "@/lib/scalper/store";
import { expiryLabel } from "@/lib/scalper/time";
import { Button, Kbd, clsx } from "./ui";

/**
 * Order confirmation.
 *
 * Shown for every order unless instant mode is on, and always for sells while
 * "confirm before selling" is set. The contract is restated in full, because
 * the whole point is to catch the case where the pad is not pointed where the
 * trader thinks it is.
 */
export function ConfirmDialog() {
  const pending = useScalper((s) => s.pendingConfirm);
  const confirm = useScalper((s) => s.confirmPending);
  const cancel = useScalper((s) => s.cancelPending);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  React.useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, confirm]);

  if (!pending) return null;

  const { intent, quantity, estimatedValue, warnings: notes, target } = pending;
  const buy = intent.side === "BUY";
  const label = `${strikeLabel(intent.contract.strike)} ${intent.contract.optionType}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-[#141a24] shadow-2xl">
        <header
          className={clsx(
            "flex items-center justify-between px-4 py-3",
            buy ? "bg-emerald-950/60" : "bg-rose-950/60"
          )}
        >
          <h2 id="confirm-title" className="text-sm font-bold text-slate-100">
            {buy ? "Buy" : "Sell"} {intent.lots} lot{intent.lots > 1 ? "s" : ""} · {label}
          </h2>
          <span className="rounded border border-amber-600/60 bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
            Paper
          </span>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
          <Row label="Contract" value={intent.contract.symbol} mono />
          <Row label="Expiry" value={expiryLabel(intent.contract.expiry)} />
          <Row label="Quantity" value={`${quantity} (${intent.lots} × ${intent.contract.lotSize})`} />
          <Row label="Est. fill" value={price(intent.entryPrice)} mono />
          <Row label="Order value" value={money(estimatedValue)} mono />
          <Row
            label="Bracket"
            value={
              intent.stopLoss === null
                ? "none"
                : `SL ${intent.stopLoss.toFixed(2)} · TGT ${target?.toFixed(2) ?? "—"}`
            }
            mono
          />
        </dl>

        {!buy ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
            Selling an option is a short position. Loss is not capped at the premium received, and
            margin would be blocked with a real broker.
          </p>
        ) : null}

        {notes.length > 0 ? (
          <ul className="mx-4 mb-3 space-y-1">
            {notes.map((note) => (
              <li
                key={note.code}
                className="rounded-md border border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-200"
              >
                {note.message}
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/40 px-4 py-3">
          <span className="text-[10px] text-slate-500">
            <Kbd>Enter</Kbd> confirm · <Kbd>Esc</Kbd> cancel
          </span>
          <div className="flex gap-2">
            <Button tone="ghost" size="md" onClick={cancel}>
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              tone={buy ? "buy" : "sell"}
              size="md"
              onClick={confirm}
              className="min-w-[8rem]"
            >
              {buy ? "Buy" : "Sell"} {label}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={clsx("text-right text-slate-200", mono && "font-mono")}>{value}</dd>
    </>
  );
}
