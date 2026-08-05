import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toDTO } from "@/lib/serialize";
import { renderMarkdown } from "@/lib/markdown";
import { formatDate } from "@/lib/utils";
import { Card, Badge, statusTone, sourceTone, typeTone, buttonClasses } from "@/components/ui/primitives";
import { StockTag } from "@/components/StockTag";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { ArrowLeft, Pencil, ExternalLink, CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = { title: "Recommendation — IndiaCharts Admin" };

export default async function ViewRecommendationPage({ params }: { params: { id: string } }) {
  const rec = await prisma.recommendation.findUnique({
    where: { id: params.id },
    include: { stocks: { include: { stock: true } } },
  });
  if (!rec) notFound();
  const r = toDTO(rec);
  const summaryHtml = renderMarkdown(r.summary || "_No summary provided._");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/recommendations"
            aria-label="Back to recommendations"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommendation</div>
            <h1 className="text-xl font-bold tracking-tight">{r.subject}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          {r.link && (
            <a href={r.link} target="_blank" rel="noreferrer" className={buttonClasses("outline")}>
              <ExternalLink className="h-4 w-4" />Open link
            </a>
          )}
          <Link href={`/recommendations/${r.id}`} className={buttonClasses()}><Pencil className="h-4 w-4" />Edit</Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2 space-y-5 p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {r.stocks.map((s) => (
              <StockTag key={s.stockId} stockId={s.stockId} displayName={s.displayName} size="md" />
            ))}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> {formatDate(r.date)}
            </span>
            <Badge tone={typeTone(r.recommendationType)}>{r.recommendationType}</Badge>
            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            <Badge tone={sourceTone(r.source)}>{r.source}</Badge>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
            <div className="prose-summary text-sm" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="space-y-3 p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chart</div>
            {r.chartImage ? (
              <ZoomableImage
                src={r.chartImage}
                alt={`${r.stocks[0]?.displayName ?? "Chart"} chart`}
                className="max-h-72 w-full rounded-md border bg-muted/30"
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">No chart image.</p>
            )}
          </Card>
          <Card className="space-y-2 p-5 text-xs text-muted-foreground">
            <div>Updated {formatDate(r.updatedAt)}</div>
            <div>ID {r.id}</div>
            {r.link && (
              <a href={r.link} target="_blank" rel="noreferrer" className="block break-all text-primary hover:underline">
                {r.link}
              </a>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
