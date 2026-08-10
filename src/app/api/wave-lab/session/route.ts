import { NextRequest, NextResponse } from "next/server";
import { KITE_MCP_CONFIGURED, KiteMcpProvider } from "@/lib/wave-lab/providers/kite-mcp";
import { configuredKind, resolveProvider } from "@/lib/wave-lab/providers";

export const dynamic = "force-dynamic";

/**
 * Connection state for the badge and panel (§2.2).
 *
 * Reports *that* you are signed in and as whom — never the token itself
 * (§12.6). An access token can place orders; it has no business crossing to
 * the browser under any circumstances.
 *
 * Returns something useful in all four states, including "not configured",
 * because a panel that renders an empty box when nothing is set up is the
 * single most common complaint about this kind of screen.
 */
export async function GET() {
  const provider = resolveProvider();

  if (provider.info.id !== "kite-mcp") {
    return NextResponse.json({
      provider: provider.info,
      configuredKind: configuredKind(),
      mcpConfigured: KITE_MCP_CONFIGURED,
      connection: {
        status: "not-configured",
        detail:
          `Market data is coming from ${provider.info.label}. ` +
          "Set KITE_MCP_URL=https://mcp.kite.trade/mcp in .env.local and restart to use live Kite data.",
      },
      setupSteps: [
        "Add KITE_MCP_URL=https://mcp.kite.trade/mcp to .env.local",
        "Restart the dev server so the new value is picked up",
        "Return here and press Sign in to Kite",
      ],
    });
  }

  const kite = provider as KiteMcpProvider;
  const connection = await kite.connectionState();
  return NextResponse.json({
    provider: provider.info,
    configuredKind: configuredKind(),
    mcpConfigured: KITE_MCP_CONFIGURED,
    connection,
    setupSteps: [],
  });
}

/**
 * POST /api/wave-lab/session — begin sign-in, returning the URL to open.
 *
 * The MCP server binds the authorisation to the Mcp-Session-Id the client is
 * already carrying, so the browser only ever sees a URL.
 */
export async function POST(_req: NextRequest) {
  const provider = resolveProvider();
  if (provider.info.id !== "kite-mcp") {
    return NextResponse.json(
      {
        error:
          "Kite MCP is not the active provider, so there is nothing to sign in to. " +
          "Set KITE_MCP_URL in .env.local and restart first.",
      },
      { status: 400 }
    );
  }

  try {
    const loginUrl = await (provider as KiteMcpProvider).loginUrl();
    if (!loginUrl) {
      return NextResponse.json(
        { error: "The Kite MCP server did not return a login URL." },
        { status: 502 }
      );
    }
    return NextResponse.json({ loginUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start the Kite sign-in flow." },
      { status: 502 }
    );
  }
}
