"use client";

import * as React from "react";

import { useScalper } from "@/lib/scalper/store";
import { clsx } from "./ui";

const TONES = {
  info: "border-slate-700 bg-slate-900/95 text-slate-200",
  success: "border-emerald-700/70 bg-emerald-950/95 text-emerald-100",
  warn: "border-amber-700/70 bg-amber-950/95 text-amber-100",
  error: "border-rose-700/70 bg-rose-950/95 text-rose-100",
};

/** Fill confirmations, rejections and risk trips. Bottom-right, auto-dismissing. */
export function NoticeStack() {
  const notices = useScalper((s) => s.notices);
  const dismiss = useScalper((s) => s.dismissNotice);

  if (notices.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-40 flex w-80 flex-col gap-1.5"
      role="status"
      aria-live="polite"
    >
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          onClick={() => dismiss(notice.id)}
          className={clsx(
            "pointer-events-auto rounded-lg border px-3 py-2 text-left shadow-xl backdrop-blur",
            TONES[notice.tone]
          )}
        >
          <div className="text-[11px] font-bold">{notice.title}</div>
          <div className="mt-0.5 font-mono text-[10px] opacity-80">{notice.message}</div>
        </button>
      ))}
    </div>
  );
}
