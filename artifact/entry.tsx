/**
 * Standalone build of the Wave Lab.
 *
 * The same components the app serves at `/wave-lab`, bundled into one HTML file
 * with the market client swapped for the in-browser generator. Everything that
 * makes the module worth using — the Elliott tools, the degree notation, the
 * rule engine, the Fibonacci and Lucas validation, the indicators, the Claude
 * export — is client-side and runs here unchanged.
 *
 * What it cannot do is reach Zerodha: a published page is sandboxed against all
 * outbound requests, and a broker session needs server-side credentials in any
 * case. The prices are generated, and the page says so in three places rather
 * than one, because a wave count on invented data looks exactly like a wave
 * count on real data.
 *
 * Built by `scripts/build-artifact.mjs`.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMarketClient } from "@/lib/market/client";
import { offlineMarketClient } from "@/lib/market/offline-client";
import { WaveLabWorkspace } from "@/components/wave/WaveLabWorkspace";

setMarketClient(offlineMarketClient);

function DemoBanner() {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;

  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-amber-800/60 bg-amber-950/50 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
      <span className="mt-px shrink-0 text-sm" aria-hidden="true">
        ⚠️
      </span>
      <p className="min-w-0 flex-1">
        <strong className="font-bold">Demo — the prices on both charts are generated, not the market.</strong>{" "}
        This is a standalone build of the Wave Lab, so it cannot reach Zerodha. Every drawing tool, the
        degree notation, the rule engine, the Fibonacci and Lucas checks, the indicators and the Claude
        export work exactly as they do in the app. Run the app with your broker credentials for live data.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss"
        className="shrink-0 rounded px-1 font-bold opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

function Standalone() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DemoBanner />
      <div className="min-h-0 flex-1">
        <WaveLabWorkspace />
      </div>
    </div>
  );
}

const host = document.getElementById("wave-lab-root");
if (host) createRoot(host).render(<Standalone />);
