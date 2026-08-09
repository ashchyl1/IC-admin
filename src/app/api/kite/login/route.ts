import { NextResponse } from "next/server";

import { canRunKiteLogin, kiteLoginUrl, kiteRedirectUrl } from "@/lib/market/kite-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/kite/login — start the Kite Connect authorisation.
 *
 * Redirects to Zerodha's consent screen. Kite sends the user back to the
 * redirect URL registered on the developer console, which must match
 * `KITE_REDIRECT_URL` — Zerodha ignores any redirect passed here, so a
 * mismatch shows up as a login that lands somewhere unexpected rather than as
 * an error, and is worth stating in the failure message.
 */
export async function GET(request: Request) {
  if (!canRunKiteLogin()) {
    return NextResponse.json(
      {
        error:
          "Kite Connect is not configured. Set KITE_API_KEY and KITE_API_SECRET, and register " +
          `${kiteRedirectUrl(request)} as the redirect URL on your Kite developer console.`,
      },
      { status: 400 }
    );
  }
  return NextResponse.redirect(kiteLoginUrl());
}
