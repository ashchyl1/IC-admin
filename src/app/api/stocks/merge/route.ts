import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Merge one or more source stocks into a target. All recommendations are
// repointed to the target, source aliases are folded in, sources deleted.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const target: string = body?.target;
  const sources: string[] = Array.isArray(body?.sources) ? body.sources : [];
  if (!target || !sources.length) {
    return NextResponse.json({ error: "target and sources[] required" }, { status: 400 });
  }
  const targetStock = await prisma.stock.findUnique({ where: { stockId: target } });
  if (!targetStock) return NextResponse.json({ error: "target not found" }, { status: 404 });

  const toMerge = sources.filter((s) => s !== target);
  const sourceStocks = await prisma.stock.findMany({ where: { stockId: { in: toMerge } } });

  await prisma.$transaction(async (tx) => {
    // Repoint recommendation links to the target stock. Upsert one by one so a
    // recommendation already linked to the target doesn't hit the composite PK.
    const links = await tx.recommendationStock.findMany({ where: { stockId: { in: toMerge } } });
    for (const l of links) {
      await tx.recommendationStock.upsert({
        where: { recommendationId_stockId: { recommendationId: l.recommendationId, stockId: target } },
        create: { recommendationId: l.recommendationId, stockId: target },
        update: {},
      });
    }
    await tx.recommendationStock.deleteMany({ where: { stockId: { in: toMerge } } });
    // Fold source display names into target aliases.
    const aliasSet = new Set(
      (targetStock.aliases ?? "").split(",").map((a) => a.trim()).filter(Boolean)
    );
    for (const s of sourceStocks) {
      aliasSet.add(s.displayName);
      if (s.aliases) s.aliases.split(",").forEach((a) => a.trim() && aliasSet.add(a.trim()));
    }
    await tx.stock.update({
      where: { stockId: target },
      data: { aliases: Array.from(aliasSet).join(", ") || null },
    });
    await tx.stock.deleteMany({ where: { stockId: { in: toMerge } } });
  });

  return NextResponse.json({ ok: true, merged: toMerge.length, target });
}
