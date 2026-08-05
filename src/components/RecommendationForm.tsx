"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Textarea, Select, Label, buttonClasses } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { RecommendationDTO } from "@/lib/types";
import { RECOMMENDATION_TYPES } from "@/lib/types";
import { formatDate, isValidUrl } from "@/lib/utils";
import { renderMarkdown, htmlToMarkdown } from "@/lib/markdown";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { ExternalLink, Upload, Eye, Pencil, Save, Trash2, ArrowLeft, Bold, Italic, Heading2, List, ListOrdered, Link2, Quote, Star, Table2, CheckSquare, Highlighter, Minus, ClipboardPaste, FileText, X } from "lucide-react";
import Link from "next/link";

interface StockOpt { stockId: string; displayName: string }

export function RecommendationForm({ initial }: { initial?: RecommendationDTO }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!initial;

  const [selectedStockIds, setSelectedStockIds] = React.useState<string[]>(initial?.stocks.map(s => s.stockId) ?? []);
  const [stockSearchInput, setStockSearchInput] = React.useState("");
  const [date, setDate] = React.useState(initial?.date ?? "");
  const [subject, setSubject] = React.useState(initial?.subject ?? "");
  const [link, setLink] = React.useState(initial?.link ?? "");
  const [summary, setSummary] = React.useState(initial?.summary ?? "");
  const [chartImage, setChartImage] = React.useState(initial?.chartImage ?? "");
  const [status, setStatus] = React.useState(initial?.status ?? "active");
  const [source, setSource] = React.useState(initial?.source ?? "manual");
  const [recommendationType, setRecommendationType] = React.useState(initial?.recommendationType ?? "Enter");

  const [availableStocks, setAvailableStocks] = React.useState<StockOpt[]>([]);
  const [preview, setPreview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [subjectError, setSubjectError] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const summaryRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    fetch("/api/stocks").then((r) => r.json()).then(setAvailableStocks).catch(() => {});
  }, []);

  // Unsaved-changes guard: compare the current fields against the last saved
  // snapshot and warn before the page unloads (refresh / close / external nav).
  const snapshot = JSON.stringify({ selectedStockIds, date, subject, link, summary, chartImage, status, source, recommendationType });
  const savedRef = React.useRef(
    JSON.stringify({
      selectedStockIds: initial?.stocks.map(s => s.stockId) ?? [],
      date: initial?.date ?? "",
      subject: initial?.subject ?? "",
      link: initial?.link ?? "",
      summary: initial?.summary ?? "",
      chartImage: initial?.chartImage ?? "",
      status: initial?.status ?? "active",
      source: initial?.source ?? "manual",
      recommendationType: initial?.recommendationType ?? "Enter",
    })
  );
  const dirty = snapshot !== savedRef.current;
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const linkValid = !link || isValidUrl(link);
  const summaryHtml = React.useMemo(() => renderMarkdown(summary || "_No summary yet._"), [summary]);

  // Ctrl+S / Cmd+S saves — natural for a form built around a long text editor.
  // No dependency array on purpose: re-registering keeps the closures fresh.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Insert an arbitrary string at the caret (replacing any selection).
  function insertAtCaret(text: string) {
    const el = summaryRef.current;
    const start = el ? el.selectionStart : summary.length;
    const end = el ? el.selectionEnd : summary.length;
    const next = summary.slice(0, start) + text + summary.slice(end);
    setSummary(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // Paste from Word / Docs / the web: convert the rich HTML flavor to markdown
  // so headings, tables, lists, bold/italic and colours survive the paste.
  function onSummaryPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData("text/html");
    if (!html) return; // plain text — let the browser handle it normally
    e.preventDefault();
    const md = htmlToMarkdown(html);
    insertAtCaret(md);
    toast.push("Pasted with formatting preserved", "success");
  }

  // Insert markdown around the current selection (or at the caret) in the summary
  // textarea: bold/italic wrap the selection, headings/lists/quotes prefix lines.
  function applyFormat(kind: "bold" | "italic" | "h2" | "ul" | "ol" | "link" | "quote" | "callout" | "table" | "check" | "highlight" | "hr") {
    const el = summaryRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = summary.slice(start, end);
    const atLineStart = start === 0 || summary[start - 1] === "\n";
    let insert = sel;
    let caretOffset = 0;

    switch (kind) {
      case "bold": insert = `**${sel || "bold text"}**`; caretOffset = sel ? 0 : -2; break;
      case "italic": insert = `_${sel || "italic text"}_`; caretOffset = sel ? 0 : -1; break;
      case "h2": insert = `${atLineStart ? "" : "\n"}## ${sel || "Heading"}`; break;
      case "ul": insert = (sel || "List item").split("\n").map((l) => `- ${l}`).join("\n"); break;
      case "ol": insert = (sel || "List item").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n"); break;
      case "quote": insert = `> ${sel || "Quote"}`; break;
      case "link": insert = `[${sel || "text"}](https://)`; caretOffset = -1; break;
      case "callout": insert = `${atLineStart ? "" : "\n"}> ⭐ **Conclusion:** ${sel || "key takeaway"}`; break;
      case "check": insert = (sel || "Done item").split("\n").map((l) => `- [x] ${l}`).join("\n"); break;
      case "highlight": insert = `<mark>${sel || "highlighted"}</mark>`; caretOffset = sel ? 0 : -7; break;
      case "hr": insert = `${atLineStart ? "" : "\n"}\n---\n`; break;
      case "table":
        insert = `${atLineStart ? "" : "\n"}\n| Parameter | Value | Notes |\n| --- | --- | --- |\n| Entry | SHORT | Trend-following |\n| Stop Loss | 2260 | Invalidation |\n| Target 1 | 2016 | First target |\n`;
        break;
    }

    const next = summary.slice(0, start) + insert + summary.slice(end);
    setSummary(next);
    // Restore focus + a sensible caret position after React re-renders.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length + caretOffset;
      el.setSelectionRange(pos, pos);
    });
  }

  // Drop in a full worked example so the user can see every supported variation.
  function insertTemplate() {
    if (summary.trim() && !confirm("Insert the sample template at the cursor?")) return;
    insertAtCaret(SUMMARY_TEMPLATE);
    toast.push("Template inserted", "success");
  }

  async function handleUpload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (res.ok) { const d = await res.json(); setChartImage(d.url); toast.push("Image uploaded", "success"); }
    else { const d = await res.json().catch(() => ({})); toast.push(d.error || "Upload failed", "error"); }
  }

  async function save() {
    if (!subject.trim()) {
      setSubjectError(true);
      toast.push("Subject is required", "error");
      return;
    }
    if (link && !linkValid) { toast.push("Link is not a valid URL", "error"); return; }
    setSaving(true);
    const payload = { stockIds: selectedStockIds, date: date || null, subject, link, summary, chartImage, status, source, recommendationType };
    const res = await fetch(isEdit ? `/api/recommendations/${initial!.id}` : "/api/recommendations", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      savedRef.current = snapshot;
      toast.push(isEdit ? "Saved" : "Created", "success");
      const d = await res.json();
      if (!isEdit) router.push(`/recommendations/${d.id}`);
      else router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.push((d.details?.[0] ?? d.error) || "Save failed", "error");
    }
  }

  async function remove() {
    if (!isEdit || !confirm("Delete this recommendation? This cannot be undone.")) return;
    const res = await fetch(`/api/recommendations/${initial!.id}`, { method: "DELETE" });
    if (res.ok) { toast.push("Deleted", "success"); router.push("/recommendations"); }
    else toast.push("Delete failed", "error");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/recommendations"
            aria-label="Back to recommendations"
            onClick={(e) => { if (dirty && !confirm("Discard unsaved changes?")) e.preventDefault(); }}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{isEdit ? "Edit recommendation" : "New recommendation"}</h1>
            {isEdit && <p className="text-xs text-muted-foreground">Updated {formatDate(initial!.updatedAt)} · id {initial!.id.slice(0, 8)}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
          {isEdit && (
            <Link
              href={`/recommendations/${initial!.id}/view`}
              onClick={(e) => { if (dirty && !confirm("Discard unsaved changes?")) e.preventDefault(); }}
              className={buttonClasses("outline")}
            >
              <Eye className="h-4 w-4" />View
            </Link>
          )}
          {isEdit && <Button variant="destructive" onClick={remove}><Trash2 className="h-4 w-4" />Delete</Button>}
          <Button onClick={save} disabled={saving} title="Save (Ctrl+S)"><Save className="h-4 w-4" />{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2 space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-stocks">Stocks</Label>
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    id="rec-stocks"
                    value={stockSearchInput}
                    onChange={(e) => setStockSearchInput(e.target.value)}
                    placeholder="Search and select stocks…"
                    autoComplete="off"
                  />
                  {stockSearchInput && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-md border bg-background shadow-md">
                      {availableStocks
                        .filter(s => !selectedStockIds.includes(s.stockId) && s.displayName.toLowerCase().includes(stockSearchInput.toLowerCase()))
                        .slice(0, 10)
                        .map(stock => (
                          <button
                            key={stock.stockId}
                            type="button"
                            onClick={() => {
                              setSelectedStockIds([...selectedStockIds, stock.stockId]);
                              setStockSearchInput("");
                            }}
                            className="w-full px-3 py-2 text-sm text-left hover:bg-muted focus:bg-muted focus:outline-none"
                          >
                            {stock.displayName}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
                {selectedStockIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedStockIds.map(stockId => {
                      const stock = availableStocks.find(s => s.stockId === stockId);
                      const name = stock?.displayName || stockId;
                      return (
                        <div key={stockId} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-sm">
                          <Link
                            href={`/stocks/${encodeURIComponent(stockId)}/bird-eye`}
                            title={`Bird's Eye View: ${name}`}
                            onClick={(e) => { if (dirty && !confirm("Discard unsaved changes?")) e.preventDefault(); }}
                            className="text-primary hover:underline"
                          >
                            {name}
                          </Link>
                          <button
                            type="button"
                            onClick={() => setSelectedStockIds(selectedStockIds.filter(id => id !== stockId))}
                            aria-label={`Remove ${name}`}
                            className="ml-0.5 rounded hover:bg-primary/20"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-date">Date</Label>
              <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-subject">Subject <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input
              id="rec-subject"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); if (e.target.value.trim()) setSubjectError(false); }}
              placeholder="Headline"
              required
              aria-invalid={subjectError || undefined}
              className={subjectError ? "border-destructive" : ""}
            />
            {subjectError && <p className="text-xs text-destructive">Subject is required.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-link">Link</Label>
            <div className="flex gap-2">
              <Input id="rec-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className={!linkValid ? "border-destructive" : ""} />
              {link && linkValid && (
                <a href={link} target="_blank" rel="noreferrer" aria-label="Open link in a new tab" className={buttonClasses("outline")}>
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            {!linkValid && <p className="text-xs text-destructive">Enter a valid http(s) URL.</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Summary <span className="text-muted-foreground font-normal">(markdown)</span></Label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>
                {preview ? <><Pencil className="h-3.5 w-3.5" />Edit</> : <><Eye className="h-3.5 w-3.5" />Preview</>}
              </Button>
            </div>
            {preview ? (
              <div className="prose-summary min-h-[220px] rounded-md border bg-muted/30 p-4 text-sm" dangerouslySetInnerHTML={{ __html: summaryHtml as string }} />
            ) : (
              <>
              <div className="overflow-hidden rounded-md border">
                <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
                  <TB title="Heading" onClick={() => applyFormat("h2")}><Heading2 className="h-4 w-4" /></TB>
                  <TB title="Bold (**text**)" onClick={() => applyFormat("bold")}><Bold className="h-4 w-4" /></TB>
                  <TB title="Italic (_text_)" onClick={() => applyFormat("italic")}><Italic className="h-4 w-4" /></TB>
                  <TB title="Highlight" onClick={() => applyFormat("highlight")}><Highlighter className="h-4 w-4" /></TB>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <TB title="Bullet list" onClick={() => applyFormat("ul")}><List className="h-4 w-4" /></TB>
                  <TB title="Numbered list" onClick={() => applyFormat("ol")}><ListOrdered className="h-4 w-4" /></TB>
                  <TB title="Checklist" onClick={() => applyFormat("check")}><CheckSquare className="h-4 w-4" /></TB>
                  <TB title="Quote" onClick={() => applyFormat("quote")}><Quote className="h-4 w-4" /></TB>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <TB title="Table" onClick={() => applyFormat("table")}><Table2 className="h-4 w-4" /></TB>
                  <TB title="Link" onClick={() => applyFormat("link")}><Link2 className="h-4 w-4" /></TB>
                  <TB title="Divider" onClick={() => applyFormat("hr")}><Minus className="h-4 w-4" /></TB>
                  <TB title="Callout / conclusion" onClick={() => applyFormat("callout")}><Star className="h-4 w-4" /></TB>
                  <span className="ml-auto" />
                  <TB title="Insert sample template" onClick={insertTemplate}><FileText className="h-4 w-4" /></TB>
                </div>
                <Textarea
                  ref={summaryRef}
                  rows={14}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  onPaste={onSummaryPaste}
                  className="rounded-none border-0 font-mono text-[13px] leading-relaxed focus-visible:ring-0"
                  placeholder="Editorial thesis… use the toolbar or type markdown: ## Heading, **bold**, _italic_, - bullets, | tables |, [links](url). Paste from Word/Docs and formatting is kept."
                />
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <ClipboardPaste className="h-3.5 w-3.5" /> Paste from Word or Google Docs — headings, tables, lists, bold/italic and colours are converted automatically.
              </p>
              </>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="rec-type">Recommendation Type</Label>
              <Select id="rec-type" className="w-full" value={recommendationType} onChange={(e) => setRecommendationType(e.target.value as any)}>
                {RECOMMENDATION_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-status">Status</Label>
              <Select id="rec-status" className="w-full" value={status} onChange={(e) => setStatus(e.target.value as any)}>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="draft">Draft</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-source">Source</Label>
              <Select id="rec-source" className="w-full" value={source} onChange={(e) => setSource(e.target.value as any)}>
                <option value="manual">Manual</option>
                <option value="website">Website</option>
                <option value="excel">Excel</option>
                <option value="scrape">Scrape</option>
                <option value="api">API</option>
              </Select>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <Label htmlFor="rec-chart">Chart image</Label>
            <Input id="rec-chart" value={chartImage} onChange={(e) => setChartImage(e.target.value)} placeholder="URL or upload below" />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleUpload(f); }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground transition-colors ${dragOver ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
            >
              <Upload className="h-5 w-5" />
              {uploading ? "Uploading…" : "Drag & drop or click to upload"}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
            </div>
            {chartImage && (
              <ZoomableImage src={chartImage} alt="Chart preview" className="max-h-48 w-full rounded-md border bg-muted/30" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// A worked example that exercises every supported formatting variation.
const SUMMARY_TEMPLATE = `## <span style="color:#1F4E78">📊 Trade Setup at a Glance</span>

_Direction:_ **SHORT** · _Stop Loss:_ **2260** · _Targets:_ **2016 / 1800**

### 🎯 Trade Parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| Entry Direction | SHORT | Trend-following on weakness |
| Stop Loss | 2260 | Risk management level |
| Target 1 | 2016 | First profit target |
| Target 2 | 1800 | Extended downside |

### 💡 Technical Reasoning

- Consistent **lower highs and lower lows**
- <mark>Wave C unfolding</mark> in five internal waves
- Wave 3 extending — _maximum downward momentum_

> ⚠️ **Context:** Large-cap IT in a confirmed downtrend. Every ABC bounce to the 40-week MA is a selling opportunity.

### ⚡ Why Short Now?

1. **Trend-following bias** — entry on weakness, not reversal hope
2. **Wave C confirmation** — textbook five-wave structure
3. **Clear risk management** — stop at 2260 defines invalidation

### ✅ Key Takeaways

- [x] Trend-following trade on broad IT weakness
- [x] Risk capped at 2260; ~500-point downside to 1800
- [ ] Scale out: 50% at 2016, remainder at 1800

---

> ⭐ **Conclusion:** Trend-following short preferred below 2260. Maintain discipline with stop-loss and target management.
`;

/** Compact markdown-toolbar button. */
function TB({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
