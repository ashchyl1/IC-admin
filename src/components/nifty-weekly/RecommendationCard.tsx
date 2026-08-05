"use client";
import * as React from "react";
import { ImageOff, Maximize2, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/nifty-weekly/schema";
import { StructuredPanel } from "./StructuredPanel";

interface Props {
  rec: Recommendation;
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
}

/**
 * One floating flashcard: chart on the left, structured call on the right.
 *
 * The card itself is not a button -- the chart and the expand control are. A
 * whole-card button would have to contain the delete button, which is invalid
 * nesting and makes keyboard order confusing.
 */
export function RecommendationCard({ rec, onExpand, onEdit, onDelete, deleting }: Props) {
  return (
    <article
      className={cn(
        "group relative grid grid-cols-1 overflow-hidden rounded-[3px] border bg-card",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-shadow duration-150",
        "hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
        deleting && "pointer-events-none opacity-50"
      )}
    >
      {/* ---------------------------------------------- chart (left) --- */}
      {rec.chartImageUrl ? (
        <button
          type="button"
          onClick={onExpand}
          title="Open full view"
          className="relative block cursor-zoom-in border-b bg-muted md:border-b-0 md:border-r"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={rec.chartImageUrl}
            alt={`${rec.symbol} ${rec.timeframe} chart for the week ending ${rec.weekEnding}`}
            loading="lazy"
            className="h-full max-h-[340px] w-full object-contain"
          />
          <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-[3px] bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 border-b bg-muted text-muted-foreground md:border-b-0 md:border-r">
          <ImageOff className="h-6 w-6" />
          <span className="text-xs">No chart image</span>
        </div>
      )}

      {/* ---------------------------------------------- call (right) --- */}
      <div className="relative flex min-w-0 flex-col p-4 sm:p-5">
        <StructuredPanel rec={rec} variant="card" />

        <div className="mt-4 flex items-center gap-1 border-t pt-3">
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Full view
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            aria-label={`Delete the call for the week ending ${rec.weekEnding}`}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 transition-all hover:bg-sell/10 hover:text-sell focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </article>
  );
}
