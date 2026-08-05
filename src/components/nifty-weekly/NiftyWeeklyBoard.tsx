"use client";
import * as React from "react";
import { LineChart, Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { Recommendation } from "@/lib/nifty-weekly/schema";
import { AddRecommendationModal } from "./AddRecommendationModal";
import { DetailModal } from "./DetailModal";
import { RecommendationCard } from "./RecommendationCard";

interface Props {
  initial: Recommendation[];
  /** Set when the server read failed, so the page can say why it is empty. */
  loadError?: string | null;
}

/**
 * The Nifty weekly board: a feed of floating cards, an Add dialog, and a
 * full-view dialog.
 *
 * The list is seeded from the server render and then maintained in state, so
 * adding or deleting updates the feed immediately instead of waiting on a
 * refetch.
 */
export function NiftyWeeklyBoard({ initial, loadError }: Props) {
  const { push } = useToast();
  const [items, setItems] = React.useState(initial);
  const [adding, setAdding] = React.useState(false);
  const [detail, setDetail] = React.useState<Recommendation | null>(null);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  function handleCreated(rec: Recommendation) {
    // Same ordering the query uses: newest week first, newest id within a week.
    setItems((prev) =>
      [rec, ...prev].sort((a, b) =>
        a.weekEnding === b.weekEnding ? b.id - a.id : a.weekEnding < b.weekEnding ? 1 : -1
      )
    );
  }

  async function handleDelete(rec: Recommendation) {
    if (!window.confirm(`Delete the ${rec.symbol} call for the week ending ${rec.weekEnding}?`)) {
      return;
    }
    setDeletingId(rec.id);
    try {
      const res = await fetch(`/api/nifty-weekly/${rec.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Could not delete");
      }
      setItems((prev) => prev.filter((r) => r.id !== rec.id));
      setDetail((d) => (d?.id === rec.id ? null : d));
      push("Recommendation deleted", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not delete", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="kite-theme -m-4 min-h-screen bg-background p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      {/* ------------------------------------------------- header ------ */}
      <header className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-[3px] bg-primary/10 text-primary">
          <LineChart className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-tight text-foreground">
            Nifty Weekly Recommendations
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {items.length} {items.length === 1 ? "call" : "calls"} · newest first
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="ml-auto rounded-[3px]">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </header>

      {loadError && (
        <div className="mb-5 rounded-[3px] border border-sell/30 bg-sell/[0.06] px-4 py-3 text-[13px] text-sell">
          Could not load recommendations: {loadError}
        </div>
      )}

      {/* ------------------------------------------------- feed -------- */}
      {items.length === 0 && !loadError ? (
        <div className="flex flex-col items-center justify-center rounded-[3px] border border-dashed bg-card px-6 py-20 text-center">
          <LineChart className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">No recommendations yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Add the first weekly call — attach the chart screenshot and fill in the levels.
          </p>
          <Button onClick={() => setAdding(true)} className="mt-4 rounded-[3px]">
            <Plus className="h-4 w-4" />
            Add recommendation
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              deleting={deletingId === rec.id}
              onExpand={() => setDetail(rec)}
              onDelete={() => void handleDelete(rec)}
            />
          ))}
        </div>
      )}

      <AddRecommendationModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={handleCreated}
      />
      <DetailModal rec={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
