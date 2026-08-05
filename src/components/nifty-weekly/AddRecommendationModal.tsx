"use client";
import * as React from "react";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  BIASES,
  SETUP_STATUSES,
  TRENDS,
  fridayOf,
  type Bias,
  type Recommendation,
  type SetupStatus,
  type Trend,
} from "@/lib/nifty-weekly/schema";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (rec: Recommendation) => void;
}

/** Level rows are kept as strings so a half-typed "24," doesn't get mangled. */
type LevelField = "supportLevels" | "resistanceLevels" | "targetLevels" | "invalidationLevels";

const LEVEL_FIELDS: { key: LevelField; label: string; placeholder: string }[] = [
  { key: "supportLevels", label: "Support", placeholder: "24150" },
  { key: "resistanceLevels", label: "Resistance", placeholder: "24720" },
  { key: "targetLevels", label: "Targets", placeholder: "25150" },
  { key: "invalidationLevels", label: "Invalidation", placeholder: "23750" },
];

function emptyLevels(): Record<LevelField, string[]> {
  return {
    supportLevels: [""],
    resistanceLevels: [""],
    targetLevels: [""],
    invalidationLevels: [""],
  };
}

export function AddRecommendationModal({ open, onClose, onCreated }: Props) {
  const { push } = useToast();

  const [weekEnding, setWeekEnding] = React.useState(() => fridayOf(new Date()));
  const [trend, setTrend] = React.useState<Trend>("Neutral");
  const [bias, setBias] = React.useState<Bias>("HOLD");
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus>("Watching");
  const [spotPrice, setSpotPrice] = React.useState("");
  const [changePoints, setChangePoints] = React.useState("");
  const [changePercent, setChangePercent] = React.useState("");
  const [levels, setLevels] = React.useState(emptyLevels);
  const [analysis, setAnalysis] = React.useState("");

  const [image, setImage] = React.useState<{ path: string; url: string } | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const fileRef = React.useRef<HTMLInputElement>(null);

  const reset = React.useCallback(() => {
    setWeekEnding(fridayOf(new Date()));
    setTrend("Neutral");
    setBias("HOLD");
    setSetupStatus("Watching");
    setSpotPrice("");
    setChangePoints("");
    setChangePercent("");
    setLevels(emptyLevels());
    setAnalysis("");
    setImage(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  // The object URL backing the preview has to be released or the blob leaks
  // for the lifetime of the tab.
  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const upload = React.useCallback(
    async (file: File) => {
      setUploading(true);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/nifty-weekly/upload", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
        setImage({ path: json.path, url: json.url });
      } catch (err) {
        setPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        push(err instanceof Error ? err.message : "Upload failed", "error");
      } finally {
        setUploading(false);
      }
    },
    [push]
  );

  // Charts usually arrive as a screenshot on the clipboard, so accept a paste
  // anywhere in the dialog rather than forcing a save-then-browse round trip.
  React.useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void upload(file);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, upload]);

  function setLevel(field: LevelField, index: number, value: string) {
    setLevels((prev) => {
      const next = [...prev[field]];
      next[index] = value;
      return { ...prev, [field]: next };
    });
  }

  function addLevel(field: LevelField) {
    setLevels((prev) => ({ ...prev, [field]: [...prev[field], ""] }));
  }

  function removeLevel(field: LevelField, index: number) {
    setLevels((prev) => {
      const next = prev[field].filter((_, i) => i !== index);
      return { ...prev, [field]: next.length ? next : [""] };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || uploading) return;
    setSaving(true);
    try {
      const res = await fetch("/api/nifty-weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekEnding,
          trend,
          bias,
          setupStatus,
          spotPrice,
          changePoints,
          changePercent,
          analysis,
          supportLevels: levels.supportLevels,
          resistanceLevels: levels.resistanceLevels,
          targetLevels: levels.targetLevels,
          invalidationLevels: levels.invalidationLevels,
          chartImagePath: image?.path ?? null,
          chartImageUrl: image?.url ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save");
      onCreated(json.recommendation as Recommendation);
      push("Recommendation added", "success");
      reset();
      onClose();
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-rec-title" className="kite-theme max-w-2xl">
      <form onSubmit={submit}>
        <div className="border-b px-5 py-4">
          <h2 id="add-rec-title" className="text-base font-semibold text-foreground">
            Add weekly recommendation
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            NIFTY · 1W. Paste a chart screenshot anywhere in this dialog to attach it.
          </p>
        </div>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* ------------------------------------------- chart image --- */}
          <div>
            <Label htmlFor="chart-file">Chart image</Label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void upload(file);
              }}
              className={cn(
                "mt-1.5 flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed p-3 transition-colors",
                dragOver ? "border-primary bg-primary/[0.05]" : "border-input bg-muted"
              )}
            >
              {preview ? (
                <div className="relative w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt="Chart preview"
                    className="mx-auto max-h-56 rounded-[3px] object-contain"
                  />
                  {uploading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-[3px] bg-card/70">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setImage(null);
                      setPreview((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return null;
                      });
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    aria-label="Remove chart image"
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-[3px] bg-black/60 text-white transition-colors hover:bg-black/75"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  <p className="text-center text-[13px] text-muted-foreground">
                    Drop, paste, or{" "}
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      browse
                    </button>
                    <br />
                    <span className="text-xs">PNG, JPEG, WebP or GIF · up to 8 MB</span>
                  </p>
                </>
              )}
              <input
                ref={fileRef}
                id="chart-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </div>
          </div>

          {/* ------------------------------------------- the call ------ */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="week-ending">Week ending</Label>
              <Input
                id="week-ending"
                type="date"
                required
                value={weekEnding}
                onChange={(e) => setWeekEnding(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="trend">Trend</Label>
              <Select
                id="trend"
                value={trend}
                onChange={(e) => setTrend(e.target.value as Trend)}
                className="mt-1.5 h-9 w-full"
              >
                {TRENDS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bias">Bias</Label>
              <Select
                id="bias"
                value={bias}
                onChange={(e) => setBias(e.target.value as Bias)}
                className="mt-1.5 h-9 w-full"
              >
                {BIASES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="setup">Setup</Label>
              <Select
                id="setup"
                value={setupStatus}
                onChange={(e) => setSetupStatus(e.target.value as SetupStatus)}
                className="mt-1.5 h-9 w-full"
              >
                {SETUP_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="spot">Spot close</Label>
              <Input
                id="spot"
                inputMode="decimal"
                placeholder="24380.50"
                value={spotPrice}
                onChange={(e) => setSpotPrice(e.target.value)}
                className="mt-1.5 kite-num"
              />
            </div>
            <div>
              <Label htmlFor="chg-pts">Change (pts)</Label>
              <Input
                id="chg-pts"
                inputMode="decimal"
                placeholder="+142.30"
                value={changePoints}
                onChange={(e) => setChangePoints(e.target.value)}
                className="mt-1.5 kite-num"
              />
            </div>
            <div>
              <Label htmlFor="chg-pct">Change (%)</Label>
              <Input
                id="chg-pct"
                inputMode="decimal"
                placeholder="+0.59"
                value={changePercent}
                onChange={(e) => setChangePercent(e.target.value)}
                className="mt-1.5 kite-num"
              />
            </div>
          </div>

          {/* ------------------------------------------- levels -------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {LEVEL_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <Label>{label}</Label>
                <div className="mt-1.5 space-y-1.5">
                  {levels[key].map((value, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        inputMode="decimal"
                        placeholder={placeholder}
                        aria-label={`${label} level ${i + 1}`}
                        value={value}
                        onChange={(e) => setLevel(key, i, e.target.value)}
                        className="kite-num"
                      />
                      <button
                        type="button"
                        onClick={() => removeLevel(key, i)}
                        aria-label={`Remove ${label.toLowerCase()} level ${i + 1}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addLevel(key)}
                    className="inline-flex items-center gap-1 rounded-[3px] px-1 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus className="h-3 w-3" />
                    Add {label.toLowerCase()}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <Label htmlFor="analysis">Analysis</Label>
            <Textarea
              id="analysis"
              rows={5}
              placeholder="Weekly view, wave count, what would change the call…"
              value={analysis}
              onChange={(e) => setAnalysis(e.target.value)}
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3.5">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || uploading}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save recommendation"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
