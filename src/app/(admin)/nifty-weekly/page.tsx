import { createClient } from "@/lib/supabase/server";
import { toRecommendation, type Recommendation } from "@/lib/nifty-weekly/schema";
import { retryRead } from "@/lib/nifty-weekly/retry";
import { NiftyWeeklyBoard } from "@/components/nifty-weekly/NiftyWeeklyBoard";

// The feed must reflect a just-added card on navigation, so never cache it.
export const dynamic = "force-dynamic";

/**
 * Server-rendered feed of Nifty weekly calls.
 *
 * Reads use the publishable key: the table's only RLS policy is a read-only
 * grant (migration 0009). Writes go through /api/nifty-weekly, which needs the
 * service-role key, so nothing here can mutate the table.
 */
export default async function NiftyWeeklyPage() {
  const supabase = createClient();

  const { data, error } = await retryRead(() =>
    supabase
      .from("nifty_weekly_recommendations")
      .select("*")
      .order("week_ending", { ascending: false })
      .order("id", { ascending: false })
  );

  const initial: Recommendation[] = (data ?? []).map(toRecommendation);

  return <NiftyWeeklyBoard initial={initial} loadError={error?.message ?? null} />;
}
