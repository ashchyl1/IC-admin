import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDTO } from "@/lib/serialize";
import { buildExportWorkbook, type ExportData } from "@/lib/excel";
import { buildWhere, type ListParams } from "@/lib/recommendations";

export const dynamic = "force-dynamic";

// GET /api/export -> multi-sheet .xlsx download.
// Optional ?ids=a,b,c to export only selected rows (used by bulk "export selected").
// Also honors the same filter params as the list endpoint.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const idsParam = sp.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;

  const listParams: ListParams = {
    search: sp.get("search") ?? undefined,
    stock: sp.get("stock") ?? undefined,
    status: sp.get("status") ?? undefined,
    source: sp.get("source") ?? undefined,
    recommendationType: sp.get("recommendationType") ?? undefined,
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
    missingSummary: sp.get("missingSummary") === "1",
    missingChart: sp.get("missingChart") === "1",
  };

  const where = ids ? { id: { in: ids } } : buildWhere(listParams);

  const recs = await prisma.recommendation.findMany({
    where,
    include: { stocks: { include: { stock: true } } },
    orderBy: { date: "asc" },
  });
  const stocks = await prisma.stock.findMany({
    orderBy: { displayName: "asc" },
    include: { _count: { select: { recommendations: true } } },
  });
  const sourceGroups = await prisma.recommendation.groupBy({ by: ["source"], _count: { _all: true } });
  const logs = await prisma.importLog.findMany({ orderBy: { timestamp: "desc" }, take: 200 });

  const data: ExportData = {
    recommendations: recs.map(toDTO),
    stocks: stocks.map((s) => ({
      stockId: s.stockId,
      displayName: s.displayName,
      symbolGuess: s.symbolGuess,
      count: s._count.recommendations,
    })),
    sources: sourceGroups.map((g) => ({ name: g.source, count: g._count._all })),
    importLog: logs.map((l) => ({
      timestamp: l.timestamp.toISOString(),
      sources: l.sources,
      rowsNew: l.rowsNew,
      rowsMerged: l.rowsMerged,
      rowsTotal: l.rowsTotal,
      notes: l.notes,
    })),
  };

  const buffer = await buildExportWorkbook(data);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="IndiaCharts_Recommendations_${stamp}.xlsx"`,
    },
  });
}
