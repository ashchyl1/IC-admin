import { NextResponse } from "next/server";

import { configuredMode, providerChain } from "@/lib/market";
import { canRunKiteLogin, currentKiteSession, kiteRedirectUrl } from "@/lib/market/kite-session";
import { errorResponse } from "@/lib/market/responses";
import { isStoreConfigured } from "@/lib/market/supabase-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/market/status        — which provider is active and whether it works
 * GET /api/market/status?login=1 — start the Zerodha sign-in, return the URL
 *
 * The connection diagnostic. Pointing the app at a new MCP endpoint used to
 * mean reading a stack trace; this reports the tools the provider discovered,
 * which one it picked for each job, and whether the session is signed in — so a
 * renamed tool or a missing login is visible rather than mysterious.
 */
export async function GET(request: Request) {
  const wantsLogin = new URL(request.url).searchParams.get("login") === "1";

  try {
    const chain = providerChain();

    if (wantsLogin) {
      const provider = chain.find((entry) => typeof entry.login === "function");
      if (!provider?.login) {
        return NextResponse.json(
          {
            error:
              "No configured provider supports an interactive login. Kite MCP does; " +
              "Kite REST uses a daily access token, and the bridge handles its own auth.",
          },
          { status: 400 }
        );
      }
      const challenge = await provider.login();
      return NextResponse.json({ provider: provider.info, ...challenge });
    }

    // Diagnose the first provider that can report on itself — the one whose
    // health actually decides whether the charts show real prices.
    const target = chain.find((entry) => typeof entry.diagnostics === "function");
    const diagnostics = target?.diagnostics ? await target.diagnostics() : null;
    const kiteSession = await currentKiteSession().catch(() => null);

    return NextResponse.json({
      mode: configuredMode(),
      chain: chain.map((entry) => entry.info),
      active: chain[0]?.info ?? null,
      canLogin: chain.some((entry) => typeof entry.login === "function"),
      diagnostics,
      // The Kite Connect login is reported separately from the provider
      // diagnostics: it is a property of the account, not of whichever
      // provider happens to be first in the chain.
      kite: {
        configured: canRunKiteLogin(),
        redirectUrl: kiteRedirectUrl(request),
        // Never the token itself — this endpoint is readable by anyone who can
        // reach the app, and the token can place orders.
        signedIn: Boolean(kiteSession && !kiteSession.expired),
        userName: kiteSession?.userName ?? null,
        expiresAt: kiteSession?.expiresAt ?? null,
        expired: kiteSession?.expired ?? null,
        tokenSource: kiteSession?.source ?? null,
      },
      store: {
        configured: isStoreConfigured(),
        label: "Supabase",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
