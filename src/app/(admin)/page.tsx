import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, Badge, statusTone, sourceTone, typeTone } from "@/components/ui/primitives";
import { StockTag } from "@/components/StockTag";
import { formatDate } from "@/lib/utils";
import { Plus, Upload, Download, TrendingUp, Building2, CalendarDays, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

async function getStats() {
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
  return {
    total,
    uniqueStocks,
    thisMonth,
    monthStartIso: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`,
    pctSummary: total ? Math.round((withSummary / total) * 100) : 0,
    pctChart: total ? Math.round((withChart / total) * 100) : 0,
    recent,
  };
}

function Kpi({ icon: Icon, label, value, sub, href }: { icon: any; label: string; value: string; sub?: string; href: string }) {
  return (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="p-5 transition-colors hover:border-primary/40">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-3xl font-bold tracking-tight">{value}</div>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const s = await getStats();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of the recommendations database</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/recommendations/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Add
          </Link>
          <Link href="/import-export" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent">
            <Upload className="h-4 w-4" /> Import
          </Link>
          <a href="/api/export" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" /> Export
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={TrendingUp} label="Total recommendations" value={s.total.toLocaleString()} href="/recommendations" />
        <Kpi icon={Building2} label="Unique stocks" value={s.uniqueStocks.toLocaleString()} href="/stocks" />
        <Kpi icon={CalendarDays} label="This month" value={s.thisMonth.toLocaleString()} sub="dated in current month" href={`/recommendations?dateFrom=${s.monthStartIso}`} />
        <Kpi icon={FileText} label="Summary filled" value={`${s.pctSummary}%`} sub={`${s.pctChart}% have a chart`} href="/recommendations?missingSummary=1" />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">Recent activity</h2>
          <Link href="/recommendations" className="text-sm text-primary hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Stocks</th>
                <th className="px-5 py-2.5 font-medium">Subject</th>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Type</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Source</th>
                <th className="px-5 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {s.recent.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="px-5 py-2.5">
                    {r.stocks.length ? (
                      <div className="flex flex-wrap gap-1">
                        {r.stocks.map((rs) => (
                          <StockTag key={rs.stockId} stockId={rs.stockId} displayName={rs.stock.displayName} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 max-w-[320px] truncate text-muted-foreground">{r.subject}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                  <td className="px-5 py-2.5"><Badge tone={typeTone(r.recommendationType)}>{r.recommendationType}</Badge></td>
                  <td className="px-5 py-2.5"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  <td className="px-5 py-2.5"><Badge tone={sourceTone(r.source)}>{r.source}</Badge></td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <Link href={`/recommendations/${r.id}/view`} className="text-primary hover:underline">View</Link>
                    <span aria-hidden="true" className="mx-1.5 text-muted-foreground/40">·</span>
                    <Link href={`/recommendations/${r.id}`} className="text-primary hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {s.recent.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">No recommendations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
