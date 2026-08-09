import { NextResponse } from "next/server";

import { configuredMode, providerChain } from "@/lib/market";
import { errorResponse } from "@/lib/market/responses";

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

    return NextResponse.json({
      mode: configuredMode(),
      chain: chain.map((entry) => entry.info),
      active: chain[0]?.info ?? null,
      canLogin: chain.some((entry) => typeof entry.login === "function"),
      diagnostics,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
