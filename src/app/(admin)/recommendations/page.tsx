"use client";
import * as React from "react";
import Link from "next/link";
import { Card, Button, Input, Select, Badge, statusTone, sourceTone, typeTone, buttonClasses } from "@/components/ui/primitives";
import { StockTag } from "@/components/StockTag";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import type { RecommendationDTO, ListResponse } from "@/lib/types";
import { Plus, Search, ExternalLink, Trash2, Download, X, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Eye, Pencil, Check, Minus } from "lucide-react";

/** Shared styling for the 32×32 icon actions at the end of each table row. */
const ROW_ACTION =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface StockOpt { stockId: string; displayName: string; count: number }

const PAGE_SIZE = 25;

export default function RecommendationsPage() {
  const toast = useToast();
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [stocks, setStocks] = React.useState<StockOpt[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // filters
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [stock, setStock] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [source, setSource] = React.useState("");
  const [recommendationType, setRecommendationType] = React.useState("");
  const [missingSummary, setMissingSummary] = React.useState(false);
  const [missingChart, setMissingChart] = React.useState(false);
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [sort, setSort] = React.useState("date");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(1);

  // Initialize filters from URL query (e.g. links from the Stocks page: ?stock=slug).
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("stock")) setStock(p.get("stock")!);
    if (p.get("status")) setStatus(p.get("status")!);
    if (p.get("source")) setSource(p.get("source")!);
    if (p.get("recommendationType")) setRecommendationType(p.get("recommendationType")!);
    if (p.get("search")) setSearch(p.get("search")!);
    if (p.get("missingSummary") === "1") setMissingSummary(true);
    if (p.get("missingChart") === "1") setMissingChart(true);
    if (p.get("dateFrom")) setDateFrom(p.get("dateFrom")!);
    if (p.get("dateTo")) setDateTo(p.get("dateTo")!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the filters back into the URL so refresh / back / share keeps state.
  React.useEffect(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (stock) p.set("stock", stock);
    if (status) p.set("status", status);
    if (source) p.set("source", source);
    if (recommendationType) p.set("recommendationType", recommendationType);
    if (missingSummary) p.set("missingSummary", "1");
    if (missingChart) p.set("missingChart", "1");
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [debounced, stock, status, source, recommendationType, missingSummary, missingChart, dateFrom, dateTo]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    fetch("/api/stocks").then((r) => r.json()).then(setStocks).catch(() => {});
  }, []);

  const query = React.useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (stock) p.set("stock", stock);
    if (status) p.set("status", status);
    if (source) p.set("source", source);
    if (recommendationType) p.set("recommendationType", recommendationType);
    if (missingSummary) p.set("missingSummary", "1");
    if (missingChart) p.set("missingChart", "1");
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p;
  }, [debounced, stock, status, source, recommendationType, missingSummary, missingChart, dateFrom, dateTo, sort, dir, page]);

  // Guard against out-of-order responses: only the most recent request may
  // update state, so a slow unfiltered fetch can't clobber a newer filtered one.
  const reqId = React.useRef(0);
  const load = React.useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    fetch(`/api/recommendations?${query.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (id === reqId.current) setData(d); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [query]);

  React.useEffect(() => { load(); }, [load]);
  // Reset to page 1 when filters (not page itself) change.
  React.useEffect(() => { setPage(1); }, [debounced, stock, status, source, recommendationType, missingSummary, missingChart, dateFrom, dateTo, sort, dir]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Filter dropdown: hide stocks with no recommendations (unless currently
  // selected) and sort case-insensitively so "Infosys" and "INFY" sit together.
  const stockOpts = React.useMemo(
    () =>
      stocks
        .filter((s) => s.count > 0 || s.stockId === stock)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })),
    [stocks, stock]
  );

  // Select-all shows the mixed state when only some rows are ticked.
  const allRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selected.size > 0 && selected.size < rows.length;
  }, [selected, rows.length]);

  function toggleSort(field: string) {
    if (sort === field) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(field); setDir("asc"); }
  }
  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function bulk(action: string, extra?: Record<string, unknown>) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} recommendation(s)? This cannot be undone.`)) return;
    const res = await fetch("/api/recommendations/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, ...extra }),
    });
    if (res.ok) {
      const d = await res.json();
      toast.push(`${action === "delete" ? "Deleted" : "Updated"} ${d.affected} row(s)`, "success");
      setSelected(new Set());
      load();
    } else {
      toast.push("Bulk action failed", "error");
    }
  }

  async function deleteOne(id: string, subject: string) {
    if (!confirm(`Delete "${subject}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/recommendations/${id}`, { method: "DELETE" });
    if (res.ok) { toast.push("Deleted", "success"); load(); }
    else toast.push("Delete failed", "error");
  }

  function exportSelected() {
    const ids = Array.from(selected);
    const url = ids.length ? `/api/export?ids=${ids.join(",")}` : `/api/export?${query.toString()}`;
    window.location.href = url;
  }

  function clearFilters() {
    setSearch(""); setStock(""); setStatus(""); setSource(""); setRecommendationType("");
    setMissingSummary(false); setMissingChart(false); setDateFrom(""); setDateTo("");
  }
  const hasFilters = debounced || stock || status || source || recommendationType || missingSummary || missingChart || dateFrom || dateTo;

  const SortTh = ({ field, label, className }: { field: string; label: string; className?: string }) => {
    const active = sort === field;
    const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
        <button
          onClick={() => toggleSort(field)}
          className="inline-flex items-center gap-1 rounded font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
          <Icon className={`h-3 w-3 ${active ? "text-primary" : "text-muted-foreground/50"}`} />
        </button>
      </th>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recommendations</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} record{total === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportSelected}><Download className="h-4 w-4" />{selected.size ? `Export ${selected.size}` : "Export view"}</Button>
          <Link href="/recommendations/new" className={buttonClasses()}><Plus className="h-4 w-4" />Add</Link>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" aria-label="Search recommendations" placeholder="Search stock, subject, summary…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by stock" value={stock} onChange={(e) => setStock(e.target.value)}>
            <option value="">All stocks</option>
            {stockOpts.map((s) => <option key={s.stockId} value={s.stockId}>{s.displayName} ({s.count})</option>)}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="draft">Draft</option>
          </Select>
          <Select aria-label="Filter by source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Any source</option>
            <option value="manual">Manual</option>
            <option value="website">Website</option>
            <option value="excel">Excel</option>
            <option value="scrape">Scrape</option>
            <option value="api">API</option>
          </Select>
          <Select aria-label="Filter by recommendation type" value={recommendationType} onChange={(e) => setRecommendationType(e.target.value)}>
            <option value="">Any type</option>
            <option value="Enter">Enter</option>
            <option value="Update">Update</option>
            <option value="Exit">Exit</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-muted-foreground">From <Input type="date" className="h-8 w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-muted-foreground">To <Input type="date" className="h-8 w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={missingSummary} onChange={(e) => setMissingSummary(e.target.checked)} /> Missing summary</label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={missingChart} onChange={(e) => setMissingChart(e.target.checked)} /> Missing chart</label>
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Clear</Button>}
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Select
            aria-label="Set status for selected rows"
            className="h-8 text-xs"
            value=""
            onChange={(e) => { if (e.target.value) bulk("setStatus", { status: e.target.value }); }}
          >
            <option value="">Set status…</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="draft">Draft</option>
          </Select>
          <Button size="sm" variant="outline" onClick={exportSelected}><Download className="h-3.5 w-3.5" />Export</Button>
          <Button size="sm" variant="destructive" onClick={() => bulk("delete")}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Card>
        <div className={`overflow-x-auto scroll-thin ${loading && rows.length > 0 ? "pointer-events-none opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground [&>th]:px-4 [&>th]:py-2.5">
                <th className="w-10">
                  <input
                    ref={allRef}
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>Stocks</th>
                <SortTh field="subject" label="Subject" />
                <SortTh field="date" label="Date" />
                <th>Content</th>
                <SortTh field="recommendationType" label="Type" />
                <SortTh field="status" label="Status" />
                <SortTh field="source" label="Source" />
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    {hasFilters ? (
                      <div className="space-y-3">
                        <p>No recommendations match these filters.</p>
                        <Button size="sm" variant="outline" onClick={clearFilters}><X className="h-3.5 w-3.5" />Clear filters</Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p>No recommendations yet.</p>
                        <Link href="/recommendations/new" className={buttonClasses("primary", "sm")}>
                          <Plus className="h-3.5 w-3.5" />Add your first recommendation
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40 [&>td]:px-4 [&>td]:py-2.5">
                  <td><input type="checkbox" aria-label={`Select ${r.subject}`} checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                  <td className="text-sm whitespace-nowrap">
                    {r.stocks.length > 0 ? (
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {r.stocks.map((s) => (
                          <StockTag key={s.stockId} stockId={s.stockId} displayName={s.displayName} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-[300px] truncate text-muted-foreground" title={r.subject}>{r.subject}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                  <td className="whitespace-nowrap text-xs">
                    <span className="inline-flex items-center gap-2">
                      <span
                        title={r.summary ? "Summary present" : "Summary missing"}
                        className={`inline-flex items-center gap-0.5 ${r.summary ? "text-emerald-600" : "text-muted-foreground/50"}`}
                      >
                        {r.summary ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}Sum
                        <span className="sr-only">{r.summary ? "present" : "missing"}</span>
                      </span>
                      <span
                        title={r.chartImage ? "Chart present" : "Chart missing"}
                        className={`inline-flex items-center gap-0.5 ${r.chartImage ? "text-emerald-600" : "text-muted-foreground/50"}`}
                      >
                        {r.chartImage ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}Chart
                        <span className="sr-only">{r.chartImage ? "present" : "missing"}</span>
                      </span>
                    </span>
                  </td>
                  <td><Badge tone={typeTone(r.recommendationType)}>{r.recommendationType}</Badge></td>
                  <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  <td><Badge tone={sourceTone(r.source)}>{r.source}</Badge></td>
                  <td>
                    <div className="flex items-center justify-end gap-0.5">
                      <Link href={`/recommendations/${r.id}/view`} title="View" aria-label={`View ${r.subject}`} className={`${ROW_ACTION} hover:text-primary`}><Eye className="h-4 w-4" /></Link>
                      <Link href={`/recommendations/${r.id}`} title="Edit" aria-label={`Edit ${r.subject}`} className={`${ROW_ACTION} hover:text-primary`}><Pencil className="h-4 w-4" /></Link>
                      {r.link && <a href={r.link} target="_blank" rel="noreferrer" title="Open source link" aria-label={`Open source link for ${r.subject} in a new tab`} className={`${ROW_ACTION} hover:text-primary`}><ExternalLink className="h-4 w-4" /></a>}
                      <button onClick={() => deleteOne(r.id, r.subject)} title="Delete" aria-label={`Delete ${r.subject}`} className={`${ROW_ACTION} hover:text-destructive`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {total > 0
              ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length} of ${total.toLocaleString()}`
              : "No records"}
            {totalPages > 1 && ` · Page ${page} of ${totalPages}`}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" />Prev</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
