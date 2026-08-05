"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, statusTone, sourceTone, typeTone, buttonClasses } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import type { RecommendationDTO, RecommendationType } from "@/lib/types";
import { RECOMMENDATION_TYPES } from "@/lib/types";
import { ChevronLeft, ChevronRight, ArrowLeft, X, Eye, Pencil, ExternalLink, ArrowDownWideNarrow, ArrowUpNarrowWide, Telescope } from "lucide-react";

const CARD_W = 560; // px — keep in sync with the card width class below
const GAP = 24;

/**
 * Full-screen horizontal thread of every recommendation that includes a stock.
 * Reusable: render it from the /stocks/[stockId]/bird-eye page today, or mount
 * it inside a modal later — it only needs a stockId and an onClose target.
 */
export function BirdEyeView({ stockId, closeHref = "/stocks" }: { stockId: string; closeHref?: string }) {
  const router = useRouter();
  const [all, setAll] = React.useState<RecommendationDTO[]>([]);
  const [stockName, setStockName] = React.useState<string>(stockId);
  const [loading, setLoading] = React.useState(true);
  const [index, setIndex] = React.useState(0);
  const [typeFilter, setTypeFilter] = React.useState<"" | RecommendationType>("");
  const [dir, setDir] = React.useState<"desc" | "asc">("desc"); // desc = newest first (default)

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/recommendations?stock=${encodeURIComponent(stockId)}&pageSize=500`).then((r) => r.json()),
      fetch("/api/stocks").then((r) => r.json()),
    ])
      .then(([recs, stocks]) => {
        if (cancelled) return;
        setAll(recs.rows ?? []);
        const s = (stocks as { stockId: string; displayName: string }[]).find((s) => s.stockId === stockId);
        if (s) setStockName(s.displayName);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [stockId]);

  // Filter + sort client-side so chips and the sort toggle are instant.
  const recs = React.useMemo(() => {
    const filtered = typeFilter ? all.filter((r) => r.recommendationType === typeFilter) : all;
    return [...filtered].sort((a, b) => {
      const da = a.date ?? "";
      const db = b.date ?? "";
      return dir === "desc" ? db.localeCompare(da) : da.localeCompare(db);
    });
  }, [all, typeFilter, dir]);

  const typeCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) c[r.recommendationType] = (c[r.recommendationType] ?? 0) + 1;
    return c;
  }, [all]);

  // Clamp the active card whenever the visible list changes.
  React.useEffect(() => { setIndex(0); }, [typeFilter, dir]);

  const prev = React.useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = React.useCallback(() => setIndex((i) => Math.min(recs.length - 1, i + 1)), [recs.length]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "Escape") router.push(closeHref);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router, closeHref]);

  // Mouse wheel navigates the thread (throttled so a single scroll = one card).
  const wheelLock = React.useRef(0);
  function onWheel(e: React.WheelEvent) {
    const now = Date.now();
    if (now - wheelLock.current < 350) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 10) return;
    wheelLock.current = now;
    delta > 0 ? next() : prev();
  }

  const canPrev = index > 0;
  const canNext = index < recs.length - 1;
  const showNav = recs.length > 1;

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        Loading Bird&rsquo;s Eye View…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background md:left-60" onWheel={onWheel}>
      {/* Header */}
      <div className="border-b bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link
            href={closeHref}
            aria-label="Back"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Telescope className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-bold leading-tight">{stockName}</h1>
              <p className="text-xs text-muted-foreground">
                {all.length} recommendation{all.length === 1 ? "" : "s"}
                {typeFilter && ` · showing ${recs.length} ${typeFilter}`}
              </p>
            </div>
          </div>

          {/* Type filter chips */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setTypeFilter("")}
              aria-pressed={typeFilter === ""}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${typeFilter === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
            >
              All ({all.length})
            </button>
            {RECOMMENDATION_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
                aria-pressed={typeFilter === t}
                disabled={!typeCounts[t]}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
              >
                {t} ({typeCounts[t] ?? 0})
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
              title={dir === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
            >
              {dir === "desc" ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
              {dir === "desc" ? "Newest" : "Oldest"}
            </Button>
            <Link href={closeHref} aria-label="Close Bird's Eye View" className={buttonClasses("outline", "sm")}>
              <X className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Thread */}
      {recs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Telescope className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {typeFilter ? `No ${typeFilter} recommendations for ${stockName}.` : `No recommendations yet for ${stockName}.`}
          </p>
          {typeFilter ? (
            <Button variant="outline" size="sm" onClick={() => setTypeFilter("")}>Show all types</Button>
          ) : (
            <Link href="/recommendations/new" className={buttonClasses("primary", "sm")}>Add a recommendation</Link>
          )}
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/5">
          {/* Big side click zones */}
          {showNav && canPrev && (
            <button
              onClick={prev}
              aria-label="Previous recommendation"
              className="group absolute inset-y-0 left-0 z-10 w-[12%] min-w-[56px] cursor-w-resize focus-visible:outline-none"
            >
              <span className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border bg-background/80 p-2 shadow-sm backdrop-blur transition-all group-hover:scale-110 group-hover:border-primary">
                <ChevronLeft className="h-6 w-6" />
              </span>
            </button>
          )}
          {showNav && canNext && (
            <button
              onClick={next}
              aria-label="Next recommendation"
              className="group absolute inset-y-0 right-0 z-10 w-[12%] min-w-[56px] cursor-e-resize focus-visible:outline-none"
            >
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border bg-background/80 p-2 shadow-sm backdrop-blur transition-all group-hover:scale-110 group-hover:border-primary">
                <ChevronRight className="h-6 w-6" />
              </span>
            </button>
          )}

          {/* Sliding card row: starts at the horizontal centre, shifted per index */}
          <div className="flex h-full items-center pl-[50%]">
            <div
              className="flex items-stretch transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{ gap: GAP, transform: `translateX(${-(index * (CARD_W + GAP)) - CARD_W / 2}px)` }}
            >
              {recs.map((r, i) => (
                <BirdEyeCard key={r.id} rec={r} active={i === index} currentStockId={stockId} onFocus={() => setIndex(i)} />
              ))}
            </div>
          </div>

          {/* Progress + position */}
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-1.5">
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${((index + 1) / recs.length) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {index + 1} of {recs.length}{showNav && " · ← → keys, scroll, or click the edges"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BirdEyeCard({
  rec: r,
  active,
  currentStockId,
  onFocus,
}: {
  rec: RecommendationDTO;
  active: boolean;
  currentStockId: string;
  onFocus: () => void;
}) {
  const summaryHtml = React.useMemo(
    () => (r.summary ? renderMarkdown(r.summary) : null),
    [r.summary]
  );
  const otherStocks = r.stocks.filter((s) => s.stockId !== currentStockId);

  return (
    <div
      onClick={active ? undefined : onFocus}
      className={`w-[560px] max-w-[80vw] shrink-0 self-center rounded-xl border bg-card text-card-foreground transition-all duration-500 ${
        active
          ? "z-[5] scale-100 border-primary/50 opacity-100 shadow-xl ring-1 ring-primary/30"
          : "scale-[0.88] cursor-pointer opacity-45 shadow-sm hover:opacity-70"
      }`}
      aria-current={active ? "true" : undefined}
    >
      <div className="space-y-4 p-6">
        {/* Type + date + status/source */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge tone={typeTone(r.recommendationType)}>{r.recommendationType}</Badge>
            <span className="text-sm tabular-nums text-muted-foreground">{formatDate(r.date)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            <Badge tone={sourceTone(r.source)}>{r.source}</Badge>
          </div>
        </div>

        {/* Subject */}
        <h2 className="text-xl font-bold leading-snug">{r.subject}</h2>

        {/* Other stocks in this recommendation */}
        {otherStocks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Also involves:</span>
            {otherStocks.map((s) => (
              <Link
                key={s.stockId}
                href={`/stocks/${encodeURIComponent(s.stockId)}/bird-eye`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
              >
                {s.displayName}
              </Link>
            ))}
          </div>
        )}

        {/* Summary (clamped) */}
        {summaryHtml ? (
          <div
            className="prose-summary line-clamp-3 text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: summaryHtml as string }}
          />
        ) : (
          <p className="text-sm italic text-muted-foreground/60">No summary.</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t pt-4">
          <Link href={`/recommendations/${r.id}/view`} onClick={(e) => e.stopPropagation()} className={buttonClasses("outline", "sm")}>
            <Eye className="h-3.5 w-3.5" />View
          </Link>
          <Link href={`/recommendations/${r.id}`} onClick={(e) => e.stopPropagation()} className={buttonClasses("outline", "sm")}>
            <Pencil className="h-3.5 w-3.5" />Edit
          </Link>
          {r.link && (
            <a href={r.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={buttonClasses("outline", "sm")}>
              <ExternalLink className="h-3.5 w-3.5" />Source
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
