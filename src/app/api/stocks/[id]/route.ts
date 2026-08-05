import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Edit a stock's display name / symbol / aliases.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const data: Record<string, string | null> = {};
  if (typeof body.displayName === "string") data.displayName = body.displayName.trim();
  if ("symbolGuess" in body) data.symbolGuess = body.symbolGuess ? String(body.symbolGuess).trim() : null;
  if ("aliases" in body) data.aliases = body.aliases ? String(body.aliases).trim() : null;

  try {
    const updated = await prisma.stock.update({ where: { stockId: params.id }, data });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
