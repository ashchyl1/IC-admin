"use client";
import * as React from "react";
import { Card, Button, Badge, buttonClasses } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, PlusCircle, RefreshCw } from "lucide-react";

interface DryRun {
  counts: { total: number; new: number; update: number; invalid: number };
  preview: { kind: string; reason?: string; stockName: string | null; date: string | null; subject: string; link: string | null }[];
  source: string;
}

const kindTone: Record<string, "green" | "blue" | "red"> = { new: "green", update: "blue", invalid: "red" };

export default function ImportExportPage() {
  const toast = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [dry, setDry] = React.useState<DryRun | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function runDry(f: File) {
    setBusy(true); setDry(null);
    const fd = new FormData(); fd.append("file", f);
    const res = await fetch("/api/import?dryRun=1", { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) setDry(await res.json());
    else { const d = await res.json().catch(() => ({})); toast.push(d.error || "Failed to read file", "error"); }
  }

  function onPick(f: File | null) {
    setFile(f); setDry(null);
    if (f) runDry(f);
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.push(`Imported: ${d.applied} applied (${d.counts.new} new, ${d.counts.update} updated)`, "success");
      setFile(null); setDry(null);
      if (fileRef.current) fileRef.current.value = "";
    } else toast.push("Import failed", "error");
  }

  const jsonSample = `curl -X POST http://localhost:3040/api/import \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[
    {"stock_name":"Infosys","date":"2026-07-15",
     "subject":"Infosys breakout","link":"https://articles.indiacharts.com/…",
     "summary":"Thesis…","source":"website","status":"active"}
  ]}'`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import / Export</h1>
        <p className="text-sm text-muted-foreground">Move data in and out of the recommendations database</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Import */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Import Excel</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Upload an <code className="text-xs">.xlsx</code> with a <b>Consolidated</b> or <b>Recommendations</b> sheet.
            You'll see a dry-run preview before anything is written.
          </p>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors ${dragOver ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
          >
            <Upload className="h-6 w-6" />
            {file ? <span className="font-medium text-foreground">{file.name}</span> : "Drag & drop or click to choose a .xlsx file"}
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          </div>

          {busy && !dry && <p className="text-sm text-muted-foreground">Analyzing…</p>}

          {dry && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                <Stat label="Total" value={dry.counts.total} icon={<FileSpreadsheet className="h-4 w-4" />} />
                <Stat label="New" value={dry.counts.new} tone="text-emerald-600" icon={<PlusCircle className="h-4 w-4" />} />
                <Stat label="Update" value={dry.counts.update} tone="text-blue-600" icon={<RefreshCw className="h-4 w-4" />} />
                <Stat label="Invalid" value={dry.counts.invalid} tone="text-destructive" icon={<AlertTriangle className="h-4 w-4" />} />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border scroll-thin">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr className="[&>th]:px-2 [&>th]:py-1.5 text-left text-muted-foreground">
                    <th>Kind</th><th>Stock</th><th>Subject</th><th>Date</th>
                  </tr></thead>
                  <tbody>
                    {dry.preview.map((p, i) => (
                      <tr key={i} className="border-t [&>td]:px-2 [&>td]:py-1.5">
                        <td><Badge tone={kindTone[p.kind]}>{p.kind}{p.reason ? `: ${p.reason}` : ""}</Badge></td>
                        <td className="whitespace-nowrap">{p.stockName ?? "—"}</td>
                        <td className="max-w-[160px] truncate" title={p.subject}>{p.subject}</td>
                        <td className="whitespace-nowrap tabular-nums">{p.date ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dry.counts.total > dry.preview.length && (
                <p className="text-xs text-muted-foreground">Showing first {dry.preview.length} of {dry.counts.total} rows.</p>
              )}
              {dry.counts.invalid > 0 && (
                <p className="text-xs text-muted-foreground">{dry.counts.invalid} invalid row{dry.counts.invalid === 1 ? "" : "s"} will be skipped.</p>
              )}
              <Button onClick={commit} disabled={busy || dry.counts.new + dry.counts.update === 0}>
                <CheckCircle2 className="h-4 w-4" />
                {busy ? "Importing…" : `Import ${dry.counts.new + dry.counts.update} row${dry.counts.new + dry.counts.update === 1 ? "" : "s"}`}
              </Button>
            </div>
          )}
        </Card>

        {/* Export */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Export Excel</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Downloads a multi-sheet workbook: <b>Recommendations</b>, <b>Consolidated</b>, <b>Stocks</b>, <b>Sources</b>, <b>Import_Log</b>, <b>Lookups</b>.
            </p>
            <a href="/api/export" className={buttonClasses("outline")}><Download className="h-4 w-4" />Download workbook</a>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-semibold">JSON feed endpoint</h2>
            <p className="text-sm text-muted-foreground">
              A website CMS or scraper can POST rows to create/update recommendations.
              Add <code className="text-xs">?dryRun=1</code> to preview without writing.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs scroll-thin"><code>{jsonSample}</code></pre>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <div className={`flex items-center justify-center gap-1 text-lg font-bold ${tone ?? ""}`}>
        <span aria-hidden="true" className="opacity-70">{icon}</span>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
