import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

// Bulk actions used by the list view: delete or set-status on selected ids.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  const action: string = body?.action;
  if (!ids.length) return NextResponse.json({ error: "No ids provided" }, { status: 400 });

  if (action === "delete") {
    const { count } = await prisma.recommendation.deleteMany({ where: { id: { in: ids } } });
    return NextResponse.json({ ok: true, affected: count });
  }
  if (action === "setStatus") {
    const status = body?.status;
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    const { count } = await prisma.recommendation.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
    return NextResponse.json({ ok: true, affected: count });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
