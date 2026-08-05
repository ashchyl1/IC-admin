"use client";

import * as React from "react";

import { useScalper } from "@/lib/scalper/store";
import { Button, Kbd, clsx } from "./ui";

const SHORTCUTS = [
  { keys: ["↑"], action: "Buy Call", tone: "text-emerald-300" },
  { keys: ["←"], action: "Sell Call", tone: "text-rose-300" },
  { keys: ["↓"], action: "Buy Put", tone: "text-emerald-300" },
  { keys: ["→"], action: "Sell Put", tone: "text-rose-300" },
  { keys: ["Esc"], action: "Close dialog", tone: "text-slate-300" },
  { keys: ["Shift", "X"], action: "Exit all", tone: "text-amber-300" },
];

/** Always-visible cheat sheet along the bottom edge. */
export function ShortcutBar() {
  const instantOrder = useScalper((s) => s.instantOrder);
  const setShortcutsOpen = useScalper((s) => s.setShortcutsOpen);

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-slate-800 bg-[#0b1119] px-3 py-1 text-[10px] text-slate-500">
      <span className="font-bold uppercase tracking-widest">Keys</span>
      {SHORTCUTS.map((s) => (
        <span key={s.action} className="flex items-center gap-1 whitespace-nowrap">
          {s.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          <span className={s.tone}>{s.action}</span>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-2">
        <span className={clsx(instantOrder ? "text-amber-400" : "text-slate-600")}>
          {instantOrder ? "Instant orders ON — buys fill without confirmation" : "Orders ask for confirmation"}
        </span>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="rounded border border-slate-800 px-1.5 py-px text-slate-400 hover:text-slate-200"
        >
          More
        </button>
      </span>
    </div>
  );
}

/** The full list, including the things that are click-only. */
export function ShortcutsDialog() {
  const open = useScalper((s) => s.shortcutsOpen);
  const setOpen = useScalper((s) => s.setShortcutsOpen);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-[#141a24] p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 id="shortcuts-title" className="text-sm font-bold text-slate-100">
            Keyboard shortcuts
          </h2>
          <Button tone="ghost" onClick={() => setOpen(false)}>
            Close <Kbd>Esc</Kbd>
          </Button>
        </div>

        <dl className="mt-4 divide-y divide-slate-800 text-xs">
          {SHORTCUTS.map((s) => (
            <div key={s.action} className="flex items-center justify-between py-2">
              <dt className={s.tone}>{s.action}</dt>
              <dd className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2">
            <dt className="text-slate-300">Confirm the open order dialog</dt>
            <dd>
              <Kbd>Enter</Kbd>
            </dd>
          </div>
        </dl>

        <p className="mt-4 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          Shortcuts are ignored while the cursor is in a text field, so typing a lot count never fires
          an order. With instant orders off, an arrow key opens the confirmation dialog rather than
          filling.
        </p>
      </div>
    </div>
  );
}
