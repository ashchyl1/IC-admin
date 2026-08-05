import { ScalperWorkspace } from "@/components/scalper/ScalperWorkspace";

/**
 * /scalper — the Scalper Window.
 *
 * Client-rendered end to end: the mock feed builds a session from the current
 * clock, so rendering it on the server would only produce markup the client
 * immediately replaces.
 */
export const dynamic = "force-dynamic";

export default function ScalperPage() {
  return <ScalperWorkspace />;
}
