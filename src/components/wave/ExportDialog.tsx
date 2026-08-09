"use client";

/**
 * The Claude hand-off dialog.
 *
 * Four ways out — clipboard as Markdown, clipboard as JSON, a downloaded file,
 * or a file written into `data/wave-analyses/` in the repository — and one way
 * back in. The repository option is the one that matters most day to day: a
 * saved analysis is a path Claude Code can open on the next question with no
 * pasting and no truncation.
 */

import * as React from "react";
import { Check, Copy, Download, FileJson, FolderDown, Upload, X } from "lucide-react";

import {
  DEFAULT_EXPORT_OPTIONS,
  buildBundle,
  suggestedPrompt,
  toMarkdown,
  type CandlePolicy,
  type TerminalSnapshot,
} from "@/lib/wave/export";
import type { PaperPosition } from "@/lib/wave/paper";
import { Badge, Button, Segmented, clsx } from "@/components/scalper/ui";

interface Props {
  open: boolean;
  snapshots: TerminalSnapshot[];
  positions: PaperPosition[];
  onClose: () => void;
  onImport: (terminalId: string, json: string, mode: "replace" | "append") => void;
  onNotify: (tone: "info" | "error" | "success", message: string) => void;
}

const POLICIES: { value: CandlePolicy; label: string; title: string }[] = [
  { value: "pattern", label: "Around labels", title: "Bars spanning the labelled pivots, with padding either side" },
  { value: "recent", label: "Recent", title: "The most recent bars only" },
  { value: "all", label: "All bars", title: "Every bar loaded — large, but complete" },
  { value: "none", label: "No bars", title: "Wave measurements and rule results only" },
];

export function ExportDialog({ open, snapshots, positions, onClose, onImport, onNotify }: Props) {
  const [policy, setPolicy] = React.useState<CandlePolicy>(DEFAULT_EXPORT_OPTIONS.candles);
  const [question, setQuestion] = React.useState("");
  const [tab, setTab] = React.useState<"export" | "import">("export");
  const [copied, setCopied] = React.useState<string | null>(null);
  const [importText, setImportText] = React.useState("");
  const [importTarget, setImportTarget] = React.useState(snapshots[0]?.state.id ?? "A");
  const [saving, setSaving] = React.useState(false);

  const bundle = React.useMemo(
    () =>
      buildBundle(
        snapshots,
        {
          ...DEFAULT_EXPORT_OPTIONS,
          candles: policy,
          question: question.trim() === "" ? undefined : question.trim(),
        },
        positions
      ),
    [snapshots, policy, question, positions]
  );

  const json = React.useMemo(() => JSON.stringify(bundle, null, 2), [bundle]);
  const markdown = React.useMemo(() => toMarkdown(bundle), [bundle]);
  const drawingCount = bundle.terminals.reduce((sum, terminal) => sum + terminal.drawings.length, 0);

  React.useEffect(() => {
    if (open) setQuestion((current) => current || suggestedPrompt(bundle));
    // Only when the dialog opens — retyping over the analyst's own question
    // every time a terminal ticks would be maddening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      onNotify("error", "Clipboard blocked by the browser — use Download instead.");
    }
  };

  const download = (text: string, extension: string, type: string) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wave-analysis-${new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveToRepo = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/wave/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      const payload = (await response.json()) as { path?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      onNotify("success", `Saved to ${payload.path} — open that path in Claude Code.`);
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Wave analysis export"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#0f1725] shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-4 py-2.5">
          <FileJson className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-100">Wave analysis · Claude hand-off</h2>
          <Badge tone="cyan">{drawingCount} counts</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              ariaLabel="Export or import"
              value={tab}
              onChange={setTab}
              options={[
                { value: "export" as const, label: "Export" },
                { value: "import" as const, label: "Import" },
              ]}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {tab === "export" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-2.5 border-b border-slate-800 p-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Question for Claude
                </span>
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={2}
                  className="w-full resize-y rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Price data
                </span>
                <Segmented ariaLabel="Candle export policy" value={policy} onChange={setPolicy} options={POLICIES} />
                <span className="font-mono text-[10px] text-slate-500">{(json.length / 1024).toFixed(0)} KB</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950/40 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-400">
                {markdown.slice(0, 6000)}
                {markdown.length > 6000 ? "\n\n… preview truncated; the copy and download contain everything." : ""}
              </pre>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-800 px-4 py-2.5">
              <Button tone="accent" onClick={() => copy(markdown, "md")}>
                {copied === "md" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                Copy brief
              </Button>
              <Button onClick={() => copy(json, "json")}>
                {copied === "json" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                Copy JSON
              </Button>
              <Button onClick={() => download(json, "json", "application/json")}>
                <Download className="h-3 w-3" />
                .json
              </Button>
              <Button onClick={() => download(markdown, "md", "text/markdown")}>
                <Download className="h-3 w-3" />
                .md
              </Button>
              <Button tone="buy" disabled={saving} onClick={saveToRepo} className="ml-auto">
                <FolderDown className="h-3 w-3" />
                {saving ? "Saving…" : "Save to data/wave-analyses"}
              </Button>
            </footer>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-2 border-b border-slate-800 p-4">
              <p className="text-[11px] leading-relaxed text-slate-400">
                Paste a wave analysis — one exported from here, or a count Claude proposed. A bare{" "}
                <code className="rounded bg-slate-800 px-1 font-mono text-[10px]">
                  {"{ drawings: [{ tool, degree, variant, points: [{ iso, price }] }] }"}
                </code>{" "}
                object is enough.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Load into</span>
                <Segmented
                  ariaLabel="Target terminal"
                  value={importTarget}
                  onChange={setImportTarget}
                  options={snapshots.map((snapshot) => ({
                    value: snapshot.state.id,
                    label: `${snapshot.state.id} · ${snapshot.state.title}`,
                  }))}
                />
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-700">
                  <Upload className="h-3 w-3" />
                  Choose file
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) setImportText(await file.text());
                    }}
                  />
                </label>
              </div>
            </div>

            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{"schema":"indiacharts.wave-analysis/v1", …}'
              className="min-h-0 flex-1 resize-none bg-slate-950/40 p-3 font-mono text-[10px] text-slate-300 placeholder:text-slate-600 focus:outline-none"
            />

            <footer className="flex shrink-0 items-center gap-1.5 border-t border-slate-800 px-4 py-2.5">
              <Button
                tone="accent"
                disabled={importText.trim() === ""}
                onClick={() => {
                  onImport(importTarget, importText, "append");
                  onClose();
                }}
              >
                Add to chart {importTarget}
              </Button>
              <Button
                disabled={importText.trim() === ""}
                onClick={() => {
                  onImport(importTarget, importText, "replace");
                  onClose();
                }}
              >
                Replace chart {importTarget}
              </Button>
              <span className={clsx("ml-auto text-[10px]", importText.trim() === "" ? "text-slate-600" : "text-slate-500")}>
                Existing drawings are kept unless you choose Replace.
              </span>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
