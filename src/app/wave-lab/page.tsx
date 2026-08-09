import { WaveLabWorkspace } from "@/components/wave/WaveLabWorkspace";

/**
 * /wave-lab — the Elliott Wave workbench.
 *
 * Client-rendered end to end: the workspace restores the analyst's saved counts
 * from localStorage and then loads candles from the broker, so any markup the
 * server produced would be replaced on the first paint.
 */
export const dynamic = "force-dynamic";

export default function WaveLabPage() {
  return <WaveLabWorkspace />;
}
