"use client";
import * as React from "react";
import { LineChart, Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { Recommendation } from "@/lib/nifty-weekly/schema";
import { DetailModal } from "./DetailModal";
import { RecommendationCard } from "./RecommendationCard";
import { RecommendationModal } from "./RecommendationModal";

interface Props {
  initial: Recommendation[];
  /** Set when the server read failed, so the page can say why it is empty. */
  loadError?: string | null;
}

/** Newest week first; id breaks a tie between two calls filed for one week. */
function byWeekDesc(a: Recommendation, b: Recommendation) {
  if (a.weekEnding !== b.weekEnding) return a.weekEnding < b.weekEnding ? 1 : -1;
  return b.id - a.id;
}

/**
 * The Nifty weekly board: a feed of floating cards, an add/edit dialog, and a
 * full-view dialog that the mouse wheel steps through week by week.
 *
 * The list is seeded from the server render and then maintained in state, so
 * adding, editing or deleting updates the feed immediately.
 */
export function NiftyWeeklyBoard({ initial, loadError }: Props) {
  const { push } = useToast();
  const [items, setItems] = React.useState(initial);

  // Detail is tracked by id, not index: an edit that changes the week
  // reorders the feed, and an index would silently start pointing at a
  // different card.
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const detailIndex = detailId === null ? -1 : items.findIndex((r) => r.id === detailId);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingRec, setEditingRec] = React.useState<Recommendation | null>(null);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  // Which card to drop back into after the form closes, when the edit was
  // launched from the full view.
  const [resumeDetailId, setResumeDetailId] = React.useState<number | null>(null);

  function openAdd() {
    setEditingRec(null);
    setFormOpen(true);
  }

  /**
   * Editing from the full view has to close it first. Leaving both open stacks
   * two aria-modal dialogs, which is invalid for assistive tech and makes Esc
   * and the focus traps fight each other. The full view reopens on close.
   */
  function openEdit(rec: Recommendation) {
    setResumeDetailId(detailId);
    setDetailId(null);
    setEditingRec(rec);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    if (resumeDetailId !== null) {
      setDetailId(resumeDetailId);
      setResumeDetailId(null);
    }
  }

  function handleSaved(rec: Recommendation, mode: "created" | "updated") {
    setItems((prev) =>
      (mode === "created" ? [rec, ...prev] : prev.map((r) => (r.id === rec.id ? rec : r))).sort(
        byWeekDesc
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
      setDetailId((current) => (current === rec.id ? null : current));
      setResumeDetailId((current) => (current === rec.id ? null : current));
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
        <Button onClick={openAdd} className="ml-auto rounded-[3px]">
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
          <Button onClick={openAdd} className="mt-4 rounded-[3px]">
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
              onExpand={() => setDetailId(rec.id)}
              onEdit={() => openEdit(rec)}
              onDelete={() => void handleDelete(rec)}
            />
          ))}
        </div>
      )}

      <RecommendationModal
        open={formOpen}
        initial={editingRec}
        onClose={closeForm}
        onSaved={handleSaved}
      />
      <DetailModal
        items={items}
        index={detailIndex}
        onIndexChange={(i) => setDetailId(items[i]?.id ?? null)}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
      />
    </div>
  );
}
