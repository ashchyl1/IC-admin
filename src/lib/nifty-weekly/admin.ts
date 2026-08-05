import "server-only";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const MISSING_SERVICE_KEY =
  "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (Supabase dashboard → Project Settings → API Keys → service_role) and restart the dev server.";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The service-role client, or a ready-to-return 503 explaining how to enable
 * writes. Every mutating route needs this because the table and the storage
 * bucket both refuse anonymous writes, and an unconfigured key should read as
 * "here is the one-line fix" rather than an opaque 500.
 */
export function adminOr503(): { client: AdminClient } | { response: NextResponse } {
  try {
    return { client: createAdminClient() };
  } catch {
    return {
      response: NextResponse.json({ error: MISSING_SERVICE_KEY }, { status: 503 }),
    };
  }
}
