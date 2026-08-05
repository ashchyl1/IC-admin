"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { renderMarkdown } from "@/lib/markdown";
import { Modal } from "@/components/ui/Modal";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { Badge, Button, statusTone, sourceTone } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import type { RecommendationDTO } from "@/lib/types";
import { ExternalLink, Pencil, Eye, ListChecks, ArrowUpRight } from "lucide-react";

interface StockMeta {
  stockId: string;
  displayName: string;
  symbolGuess: string | null;
  aliases: string | null;
  count: number;
}

interface Props {
  open: boolean;
  slug: string | null;
  /** Optional preloaded display name so the header shows instantly while data loads. */
  name?: string | null;
  onClose: () => void;
}

/**
 * Stock Detail Modal — shows a stock's identity + every recommendation linked
 * to it. Data is pulled through the existing API (no data-model changes): the
 * stock master row (aliases/count) from /api/stocks and its recommendations
 * from /api/recommendations?stock=slug.
 */
export function StockDetailModal({ open, slug, name, onClose }: Props) {
  const router = useRouter();
  const [meta, setMeta] = React.useState<StockMeta | null>(null);
  const [recs, setRecs] = React.useState<RecommendationDTO[] | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !slug) return;
    setMeta(null);
    setRecs(null);
    setExpandedId(null);
    let cancelled = false;

    Promise.all([
      fetch("/api/stocks").then((r) => r.json()),
      fetch(`/api/recommendations?stock=${encodeURIComponent(slug)}&pageSize=500&sort=date&dir=desc`).then((r) => r.json()),
    ])
      .then(([stocks, list]) => {
        if (cancelled) return;
        setMeta((stocks as StockMeta[]).find((s) => s.stockId === slug) ?? null);
        setRecs(list.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecs([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  function openEditor(id: string) {
    onClose();
    router.push(`/recommendations/${id}`);
  }

  const displayName = meta?.displayName ?? name ?? "Stock";
  const count = meta?.count ?? recs?.length ?? 0;

  return (
    <Modal open={open} onClose={onClose} labelledBy="stock-detail-title" className="max-w-4xl">
      {/* Header */}
      <div className="border-b p-5 pr-14">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" /> Stock detail
        </div>
        <h2 id="stock-detail-title" className="mt-1 text-2xl font-bold tracking-tight">{displayName}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {slug && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{slug}</code>}
          {meta?.symbolGuess && <Badge tone="blue">{meta.symbolGuess}</Badge>}
          <Badge tone="slate">{count} recommendation{count === 1 ? "" : "s"}</Badge>
          {slug && (
            <a
              href={`/recommendations?stock=${encodeURIComponent(slug)}`}
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Open in list <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {meta?.aliases && (
          <div className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Aliases:</span> {meta.aliases}
          </div>
        )}
      </div>

      {/* Recommendations list */}
      <div className="max-h-[55vh] overflow-y-auto scroll-thin">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground [&>th]:px-5 [&>th]:py-2.5">
              <th>Date</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Source</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recs === null ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : recs.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">No recommendations for this stock.</td></tr>
            ) : (
              recs.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-b last:border-0 hover:bg-accent/40 [&>td]:px-5 [&>td]:py-2.5">
                    <td className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                    <td className="max-w-[280px] truncate" title={r.subject}>{r.subject}</td>
                    <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td><Badge tone={sourceTone(r.source)}>{r.source}</Badge></td>
                    <td>
                      <div className="flex items-center justify-end gap-3 text-muted-foreground">
                        <button
                          onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                          title="View details"
                          aria-expanded={expandedId === r.id}
                          className={`inline-flex items-center gap-1 hover:text-primary ${expandedId === r.id ? "text-primary" : ""}`}
                        >
                          <Eye className="h-4 w-4" /> View
                        </button>
                        {r.link && (
                          <a href={r.link} target="_blank" rel="noreferrer" title="Open link" className="hover:text-primary">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <button onClick={() => openEditor(r.id)} title="Edit" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr className="border-b bg-muted/30">
                      <td colSpan={5} className="px-5 py-4">
                        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
                            {r.summary ? (
                              <div
                                className="prose-summary text-sm"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(r.summary) }}
                              />
                            ) : (
                              <p className="text-sm italic text-muted-foreground">No summary yet.</p>
                            )}
                          </div>
                          {r.chartImage && (
                            <ZoomableImage src={r.chartImage} alt="Chart" className="max-h-40 rounded-md border bg-card" />
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end border-t p-3">
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
