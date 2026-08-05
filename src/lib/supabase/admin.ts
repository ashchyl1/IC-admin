import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { createResilientFetch } from "./resilient-fetch";

/**
 * Service-role client. SERVER ONLY -- the `server-only` import above makes the
 * build fail if this module is ever pulled into a client bundle.
 *
 * It exists for exactly one job: writing shared reference data (instruments and
 * market_candles) during CSV import. Those tables are deliberately read-only to
 * every browser client, so the import route authenticates the user first and
 * then performs the write with elevated privileges.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (server-side only) to enable candle import."
    );
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Local antivirus TLS interception drops roughly one connection in three
    // to Supabase. Retries connect-phase failures only, so a write is never
    // replayed once it might already have landed. See ./resilient-fetch.
    global: { fetch: createResilientFetch() },
  });
}
