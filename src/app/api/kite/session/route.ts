import { NextResponse } from "next/server";

import {
  canRunKiteLogin,
  clearKiteSession,
  currentKiteSession,
  kiteRedirectUrl,
} from "@/lib/market/kite-session";
import { isStoreConfigured } from "@/lib/market/supabase-store";
import { errorResponse } from "@/lib/market/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/kite/session — is there a usable Kite login, and where is it kept? */
export async function GET(request: Request) {
  try {
    const session = await currentKiteSession();
    return NextResponse.json({
      configured: canRunKiteLogin(),
      redirectUrl: kiteRedirectUrl(request),
      persisted: isStoreConfigured(),
      // The access token itself is never returned: this endpoint is readable by
      // anyone who can reach the app, and the token can place orders.
      session: session
        ? {
            userId: session.userId,
            userName: session.userName,
            expiresAt: session.expiresAt,
            expired: session.expired,
            source: session.source,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/kite/session — forget the stored token. */
export async function DELETE() {
  try {
    await clearKiteSession();
    return NextResponse.json({ cleared: true });
  } catch (error) {
    return errorResponse(error);
  }
}
