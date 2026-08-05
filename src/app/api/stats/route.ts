import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

// Dashboard KPIs + recent activity.
export async function GET() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, uniqueStocks, thisMonth, withSummary, withChart, recent] = await Promise.all([
    prisma.recommendation.count(),
    prisma.stock.count(),
    prisma.recommendation.count({ where: { date: { gte: monthStart } } }),
    prisma.recommendation.count({ where: { NOT: [{ summary: null }, { summary: "" }] } }),
    prisma.recommendation.count({ where: { NOT: [{ chartImage: null }, { chartImage: "" }] } }),
    prisma.recommendation.findMany({
      include: { stocks: { include: { stock: true } } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
  ]);

  return NextResponse.json({
    total,
    uniqueStocks,
    thisMonth,
    withSummary,
    withChart,
    pctSummary: total ? Math.round((withSummary / total) * 100) : 0,
    pctChart: total ? Math.round((withChart / total) * 100) : 0,
    recent: recent.map(toDTO),
  });
}
