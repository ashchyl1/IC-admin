"use client";
import * as React from "react";
import Link from "next/link";
import { Card, Button, Input, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { StockDetailModal } from "@/components/StockDetailModal";
import { Search, Pencil, Check, X, GitMerge, Telescope } from "lucide-react";

interface Stock { stockId: string; displayName: string; symbolGuess: string | null; aliases: string | null; count: number }

export default function StocksPage() {
  const toast = useToast();
  const [stocks, setStocks] = React.useState<Stock[]>([]);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editSymbol, setEditSymbol] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [modalStock, setModalStock] = React.useState<{ slug: string; name: string } | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch("/api/stocks").then((r) => r.json()).then((d) => setStocks(d)).finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const filtered = stocks.filter((s) =>
    !q || s.displayName.toLowerCase().includes(q.toLowerCase()) || (s.aliases ?? "").toLowerCase().includes(q.toLowerCase())
  );

  function startEdit(s: Stock) { setEditing(s.stockId); setEditName(s.displayName); setEditSymbol(s.symbolGuess ?? ""); }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/stocks/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: editName, symbolGuess: editSymbol }),
    });
    if (res.ok) { toast.push("Stock updated", "success"); setEditing(null); load(); }
    else toast.push("Update failed", "error");
  }

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function merge() {
    const ids = Array.from(selected);
    if (ids.length < 2) { toast.push("Select at least 2 stocks to merge", "error"); return; }
    // Default target = the selected stock with the most recommendations.
    const target = ids
      .map((id) => stocks.find((s) => s.stockId === id)!)
      .sort((a, b) => b.count - a.count)[0];
    const others = ids.filter((id) => id !== target.stockId).map((id) => stocks.find((s) => s.stockId === id)!.displayName);
    if (!confirm(`Merge ${others.join(", ")} into "${target.displayName}"? Their recommendations will be repointed and names kept as aliases.`)) return;
    const res = await fetch("/api/stocks/merge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: target.stockId, sources: ids }),
    });
    if (res.ok) { const d = await res.json(); toast.push(`Merged ${d.merged} into ${target.displayName}`, "success"); setSelected(new Set()); load(); }
    else toast.push("Merge failed", "error");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stocks</h1>
          <p className="text-sm text-muted-foreground">{stocks.length} stocks in the master list</p>
        </div>
        {selected.size >= 2 && (
          <Button onClick={merge}><GitMerge className="h-4 w-4" />Merge {selected.size} selected</Button>
        )}
      </div>

      <Card className="p-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" aria-label="Search stocks" placeholder="Search stocks or aliases…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground [&>th]:px-4 [&>th]:py-2.5">
                <th className="w-10"><span className="sr-only">Select for merge</span></th>
                <th>Display name</th>
                <th>Symbol</th>
                <th>Aliases</th>
                <th className="text-right">Recs</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No stocks match.</td></tr>
              ) : filtered.map((s) => (
                <tr key={s.stockId} className="border-b last:border-0 hover:bg-accent/40 [&>td]:px-4 [&>td]:py-2.5">
                  <td><input type="checkbox" aria-label={`Select ${s.displayName} for merge`} checked={selected.has(s.stockId)} onChange={() => toggle(s.stockId)} /></td>
                  <td className="font-medium">
                    {editing === s.stockId
                      ? <Input
                          aria-label="Display name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(s.stockId); if (e.key === "Escape") setEditing(null); }}
                          className="h-8"
                        />
                      : <button onClick={() => setModalStock({ slug: s.stockId, name: s.displayName })} className="cursor-pointer text-left hover:text-primary hover:underline">{s.displayName}</button>}
                  </td>
                  <td className="text-muted-foreground">
                    {editing === s.stockId
                      ? <Input
                          aria-label="Symbol"
                          value={editSymbol}
                          onChange={(e) => setEditSymbol(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(s.stockId); if (e.key === "Escape") setEditing(null); }}
                          className="h-8 w-28"
                        />
                      : (s.symbolGuess ?? "—")}
                  </td>
                  <td className="max-w-[240px] truncate text-xs text-muted-foreground" title={s.aliases ?? ""}>{s.aliases ?? "—"}</td>
                  <td className="text-right tabular-nums">
                    <Link
                      href={`/recommendations?stock=${encodeURIComponent(s.stockId)}`}
                      title={`View ${s.count} recommendation${s.count === 1 ? "" : "s"}`}
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Badge tone="slate" className="hover:bg-accent">{s.count}</Badge>
                    </Link>
                  </td>
                  <td className="text-right">
                    {editing === s.stockId ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" title="Save" aria-label={`Save changes to ${s.displayName}`} onClick={() => saveEdit(s.stockId)}><Check className="h-4 w-4 text-emerald-600" /></Button>
                        <Button size="icon" variant="ghost" title="Cancel" aria-label="Cancel editing" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {s.count > 0 && (
                          <Link
                            href={`/stocks/${encodeURIComponent(s.stockId)}/bird-eye`}
                            title={`View recommendations for ${s.displayName}`}
                            aria-label={`Bird's Eye View for ${s.displayName}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Telescope className="h-4 w-4" />
                          </Link>
                        )}
                        <Button size="icon" variant="ghost" title="Edit" aria-label={`Edit ${s.displayName}`} onClick={() => startEdit(s)}><Pencil className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">Tip: select 2+ stocks to merge duplicates (e.g. <code>Oberoi Realty</code> ↔ <code>OBEROIRLTY</code>). The one with the most recommendations becomes the canonical name.</p>

      <StockDetailModal
        open={!!modalStock}
        slug={modalStock?.slug ?? null}
        name={modalStock?.name}
        onClose={() => setModalStock(null)}
      />
    </div>
  );
}
