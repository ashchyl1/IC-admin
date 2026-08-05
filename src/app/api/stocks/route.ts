import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Stock master with recommendation counts. Supports ?q= for autocomplete.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase().trim();

  const stocks = await prisma.stock.findMany({
    where: q ? { displayName: { contains: q } } : undefined,
    orderBy: { displayName: "asc" },
    include: { _count: { select: { recommendations: true } } },
  });

  return NextResponse.json(
    stocks.map((s) => ({
      stockId: s.stockId,
      displayName: s.displayName,
      symbolGuess: s.symbolGuess,
      aliases: s.aliases,
      count: s._count.recommendations,
    }))
  );
}
