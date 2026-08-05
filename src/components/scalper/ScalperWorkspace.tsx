"use client";

import * as React from "react";

import { useMounted, useScalperEngine, useScalperShortcuts } from "@/lib/scalper/hooks";
import { useScalper } from "@/lib/scalper/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { ControlBar } from "./ControlBar";
import { Header } from "./Header";
import { JournalDrawer } from "./JournalDrawer";
import { MtfStrip } from "./MtfStrip";
import { NoticeStack } from "./NoticeStack";
import { OptionChainPanel } from "./OptionChainPanel";
import { OptionChartCard } from "./OptionChartCard";
import { OrderCard } from "./OrderCard";
import { RiskCard } from "./RiskCard";
import { SettingsDrawer } from "./SettingsDrawer";
import { ShortcutBar, ShortcutsDialog } from "./ShortcutBar";
import { SpotChartCard } from "./SpotChartCard";
import { StatusRibbon } from "./StatusRibbon";
import { TickerStrip } from "./TickerStrip";

/**
 * The whole workspace on one screen.
 *
 * Column widths are deliberate: the index chart is the widest because it is the
 * one you read to decide, and the two option charts only need enough width to
 * show the last ~100 bars of the leg you are in. The chain is narrow because
 * seven strikes is all a scalper looks at.
 */
export function ScalperWorkspace() {
  useScalperEngine();
  useScalperShortcuts();

  const mounted = useMounted();
  const booted = useScalper((s) => s.snapshot !== null);

  // The header clock, the market phase and the entire mock session come from
  // `Date.now()`, so nothing above can be server-rendered and still match.
  // One fixed shell on the server, the real workspace after mount.
  if (!mounted) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-[#080c12] text-slate-200 antialiased">
        <BootScreen />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#080c12] text-slate-200 antialiased">
      <Header />
      <TickerStrip />
      <ControlBar />
      <StatusRibbon />
      <MtfStrip />

      {booted ? (
        <>
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1fr)_minmax(230px,270px)] gap-1.5 p-1.5">
            <OptionChartCard leg="CE" />
            <SpotChartCard />
            <OptionChartCard leg="PE" />
            <OptionChainPanel />
          </main>

          <section
            className="grid h-[252px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] gap-1.5 px-1.5 pb-1.5"
            aria-label="Order pad"
          >
            <OrderCard leg="CE" />
            <RiskCard />
            <OrderCard leg="PE" />
          </section>
        </>
      ) : (
        <BootScreen />
      )}

      <ShortcutBar />

      <ConfirmDialog />
      <JournalDrawer />
      <SettingsDrawer />
      <ShortcutsDialog />
      <NoticeStack />
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
        <p className="mt-3 text-xs text-slate-500">Building the mock session…</p>
      </div>
    </div>
  );
}
