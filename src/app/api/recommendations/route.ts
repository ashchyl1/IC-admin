import { NextRequest, NextResponse } from "next/server";
import { listRecommendations, createRecommendation } from "@/lib/recommendations";
import { validateRecommendation } from "@/lib/validate";
import { toDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { rows, total, page, pageSize } = await listRecommendations({
    search: sp.get("search") ?? undefined,
    stock: sp.get("stock") ?? undefined,
    status: sp.get("status") ?? undefined,
    source: sp.get("source") ?? undefined,
    recommendationType: sp.get("recommendationType") ?? undefined,
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
    missingSummary: sp.get("missingSummary") === "1",
    missingChart: sp.get("missingChart") === "1",
    sort: sp.get("sort") ?? undefined,
    dir: (sp.get("dir") as "asc" | "desc") ?? undefined,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
  });

  return NextResponse.json({ rows: rows.map(toDTO), total, page, pageSize });
}

export async function POST(req: NextRequest) {
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
  const created = await createRecommendation({ ...result.value!, source: result.value!.source ?? "manual" });
  return NextResponse.json(toDTO(created), { status: 201 });
}
