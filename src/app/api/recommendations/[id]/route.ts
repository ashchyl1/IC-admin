import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updateRecommendation } from "@/lib/recommendations";
import { validateRecommendation } from "@/lib/validate";
import { toDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rec = await prisma.recommendation.findUnique({
    where: { id: params.id },
    include: { stocks: { include: { stock: true } } },
  });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toDTO(rec));
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = validateRecommendation(body);
  if (!result.ok) {
    return NextResponse.json({ error: "Validation failed", details: result.errors }, { status: 422 });
  }
  const existing = await prisma.recommendation.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await updateRecommendation(params.id, {
    ...result.value!,
    source: result.value!.source ?? (existing.source as any),
    status: result.value!.status ?? (existing.status as any),
    recommendationType: result.value!.recommendationType ?? (existing.recommendationType as any),
  });
  return NextResponse.json(toDTO(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.recommendation.delete({ where: { id: params.id } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
