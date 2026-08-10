import { NextRequest, NextResponse } from "next/server";
import { resolveProvider } from "@/lib/wave-lab/providers";
import { AuthRequiredError } from "@/lib/wave-lab/types";

export const dynamic = "force-dynamic";

/** GET /api/wave-lab/search?q=infy — instrument lookup for the symbol box (§3). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ instruments: [], provider: null });
  }

  try {
    const provider = resolveProvider();
    const instruments = await provider.search(q);
    return NextResponse.json({
      instruments: instruments.slice(0, 25),
      provider: provider.info,
    });
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: err.message, needsAuth: true }, { status: 401 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Instrument search failed." },
      { status: 502 }
    );
  }
}
