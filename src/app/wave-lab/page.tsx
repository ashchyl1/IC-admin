import { WaveLabWorkspace } from "@/components/wave-lab/WaveLabWorkspace";

export const metadata = { title: "Wave Lab — Elliott terminal" };

/**
 * Full-screen route, outside the (admin) sidebar shell.
 *
 * A charting workstation needs the whole viewport; a 240px sidebar beside two
 * terminals leaves neither enough room to count a wave on. Same reasoning as
 * /paper-trading and /scalper.
 */
export default function WaveLabPage() {
  return <WaveLabWorkspace />;
}
