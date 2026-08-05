"use client";

import * as React from "react";

import { useScalper } from "@/lib/scalper/store";
import { useWallClock } from "@/lib/scalper/hooks";
import { marketPhase } from "@/lib/scalper/time";
import { Button } from "./ui";

/**
 * The honesty bar.
 *
 * It says what the data actually is, in the one place the eye lands before the
 * order pad. It never hides just because the mock feed is animating — a moving
 * chart outside market hours is exactly when a trader most needs telling.
 */
export function StatusRibbon() {
  const now = useWallClock(5000);
  const isLive = useScalper((s) => s.adapter?.isLive ?? false);
  const lastTickAt = useScalper((s) => s.lastTickAt);
  const staleAfterMs = useScalper((s) => s.risk.staleAfterMs);
  const replayComplete = useScalper((s) => s.snapshot?.replayComplete ?? false);
  const killSwitch = useScalper((s) => s.killSwitch);
  const restartFeed = useScalper((s) => s.restartFeed);
  const resetKillSwitch = useScalper((s) => s.resetKillSwitch);

  const phase = marketPhase(now);
  const stale = lastTickAt > 0 && Date.now() - lastTickAt > staleAfterMs;

  if (killSwitch) {
    return (
      <Ribbon tone="danger">
        <span>
          <strong>KILL SWITCH ENGAGED</strong> · all positions closed · new orders blocked
        </span>
        <Button tone="ghost" onClick={resetKillSwitch}>
          Reset
        </Button>
      </Ribbon>
    );
  }

  if (replayComplete) {
    return (
      <Ribbon tone="warn">
        <span>
          <strong>SIMULATED SESSION COMPLETE</strong> · the replay reached 15:30 · quotes are frozen
        </span>
        <Button tone="ghost" onClick={restartFeed}>
          Replay again
        </Button>
      </Ribbon>
    );
  }

  if (phase !== "OPEN") {
    return (
      <Ribbon tone="warn">
        <span>
          <strong>MARKET CLOSED · PRICES MAY BE STALE</strong> ·{" "}
          {isLive
            ? "no live session — the last received quotes are shown"
            : "showing a simulated replay of the most recent session"}
        </span>
      </Ribbon>
    );
  }

  if (stale) {
    return (
      <Ribbon tone="warn">
        <span>
          <strong>PRICES MAY BE STALE</strong> · no tick for{" "}
          {((Date.now() - lastTickAt) / 1000).toFixed(0)}s
        </span>
      </Ribbon>
    );
  }

  if (!isLive) {
    return (
      <Ribbon tone="info">
        <span>
          <strong>SIMULATED DATA</strong> · paper trading against a mock feed — no broker is connected
        </span>
      </Ribbon>
    );
  }

  return null;
}

function Ribbon({ tone, children }: { tone: "danger" | "warn" | "info"; children: React.ReactNode }) {
  const tones = {
    danger: "border-rose-700 bg-rose-950/80 text-rose-200",
    warn: "border-amber-700/70 bg-amber-950/70 text-amber-200",
    info: "border-violet-800/60 bg-violet-950/50 text-violet-200",
  };
  return (
    <div
      role="status"
      className={`flex shrink-0 items-center justify-center gap-3 border-b px-3 py-1 text-[11px] tracking-wide ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
