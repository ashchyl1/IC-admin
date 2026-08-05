import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PaperTradingWorkspace } from "@/components/paper/PaperTradingWorkspace";
import type { SessionState } from "@/lib/paper/types";

export const dynamic = "force-dynamic";

/**
 * The full session state is fetched on the server for the first paint, so a
 * browser refresh restores the chart, position, journal and equity exactly
 * where the replay left off. Supabase remains the source of truth.
 */
export default async function SessionPage({ params }: { params: { sessionId: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_session_state", {
    p_session_id: params.sessionId,
  });

  if (error) {
    // The RPC raises 42501 for a session that is missing or not yours; both are
    // "not found" from the caller's point of view.
    if (error.code === "42501" || /not found/i.test(error.message)) notFound();
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <p className="font-medium">Could not load this session.</p>
        <p className="mt-1">{error.message}</p>
        <Link href="/paper-trading" className="mt-3 inline-block underline underline-offset-4">
          Back to sessions
        </Link>
      </div>
    );
  }

  if (!data) notFound();

  return <PaperTradingWorkspace initial={data as unknown as SessionState} />;
}
