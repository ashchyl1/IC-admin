import { NextResponse } from "next/server";

import { exchangeRequestToken, saveKiteSession } from "@/lib/market/kite-session";
import { ProviderError } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/kite/callback — where Zerodha returns after a successful login.
 *
 * Swaps the one-time `request_token` for an access token and stores it, then
 * bounces back to the workspace. The outcome rides in the query string rather
 * than a flash message because this is a full page navigation from Zerodha's
 * domain — there is no client state to hand it to.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestToken = url.searchParams.get("request_token");
  const status = url.searchParams.get("status");
  const back = new URL("/wave-lab", url.origin);

  if (status && status !== "success") {
    back.searchParams.set("kite", "cancelled");
    return NextResponse.redirect(back);
  }
  if (!requestToken) {
    back.searchParams.set("kite", "error");
    back.searchParams.set(
      "message",
      "Zerodha returned no request_token. Check that the redirect URL on your Kite app matches KITE_REDIRECT_URL."
    );
    return NextResponse.redirect(back);
  }

  try {
    const session = await exchangeRequestToken(requestToken);
    const saved = await saveKiteSession({ apiKey: process.env.KITE_API_KEY!.trim(), ...session });

    back.searchParams.set("kite", "connected");
    if (session.userName) back.searchParams.set("user", session.userName);
    // Say when the token dies: Zerodha kills it at the next pre-open, and a
    // chart that stops updating tomorrow morning is otherwise a mystery.
    back.searchParams.set("expires", saved.expiresAt);
    if (!saved.persisted) back.searchParams.set("volatile", "1");
    return NextResponse.redirect(back);
  } catch (error) {
    back.searchParams.set("kite", "error");
    back.searchParams.set(
      "message",
      error instanceof ProviderError || error instanceof Error
        ? error.message
        : "The Kite login could not be completed."
    );
    return NextResponse.redirect(back);
  }
}
