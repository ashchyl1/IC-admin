"use client";
import * as React from "react";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  BIASES,
  HORIZONS,
  SETUP_STATUSES,
  TRENDS,
  fridayOf,
  type Bias,
  type Horizon,
  type Recommendation,
  type SetupStatus,
  type Trend,
} from "@/lib/nifty-weekly/schema";

interface Props {
  open: boolean;
  /** Pass a record to edit it; omit to create a new one. */
  initial?: Recommendation | null;
  onClose: () => void;
  onSaved: (rec: Recommendation, mode: "created" | "updated") => void;
}

type LevelField = "supportLevels" | "resistanceLevels";
type RangeField = "target" | "reversal";

const LEVEL_FIELDS: { key: LevelField; label: string; placeholder: string }[] = [
  { key: "supportLevels", label: "Support", placeholder: "24150" },
  { key: "resistanceLevels", label: "Resistance", placeholder: "24720" },
];

/** Target and Reversal are directional from -> to bands, not min/max. */
const RANGE_FIELDS: { key: RangeField; label: string; hint: string; from: string; to: string }[] = [
  { key: "target", label: "Target", hint: "where the move is headed", from: "25150", to: "25400" },
  { key: "reversal", label: "Reversal", hint: "where the call is off", from: "23900", to: "23750" },
];

/**
 * Every field is held as a string, so a half-typed "24," survives round-tripping
 * through state instead of being coerced to NaN and wiped. The route re-parses
 * everything anyway.
 */
interface FormState {
  weekEnding: string;
  horizon: Horizon;
  trend: Trend;
  bias: Bias;
  setupStatus: SetupStatus;
  spotPrice: string;
  changePoints: string;
  changePercent: string;
  supportLevels: string[];
  resistanceLevels: string[];
  target: { from: string; to: string };
  reversal: { from: string; to: string };
  explanatoryNote: string;
  recommendationText: string;
  notes: string;
}

const numToStr = (n: number | null) => (n === null ? "" : String(n));
/** A level list must always show at least one input row. */
const listToStr = (xs: number[]) => (xs.length ? xs.map(String) : [""]);

function blankForm(): FormState {
  return {
    weekEnding: fridayOf(new Date()),
    horizon: "Medium Term",
    trend: "Neutral",
    bias: "HOLD",
    setupStatus: "Watching",
    spotPrice: "",
    changePoints: "",
    changePercent: "",
    supportLevels: [""],
    resistanceLevels: [""],
    target: { from: "", to: "" },
    reversal: { from: "", to: "" },
    explanatoryNote: "",
    recommendationText: "",
    notes: "",
  };
}

function formFrom(rec: Recommendation): FormState {
  return {
    weekEnding: rec.weekEnding,
    horizon: rec.horizon,
    trend: rec.trend,
    bias: rec.bias,
    setupStatus: rec.setupStatus,
    spotPrice: numToStr(rec.spotPrice),
    changePoints: numToStr(rec.changePoints),
    changePercent: numToStr(rec.changePercent),
    supportLevels: listToStr(rec.supportLevels),
    resistanceLevels: listToStr(rec.resistanceLevels),
    target: { from: numToStr(rec.target.from), to: numToStr(rec.target.to) },
    reversal: { from: numToStr(rec.reversal.from), to: numToStr(rec.reversal.to) },
    explanatoryNote: rec.explanatoryNote,
    recommendationText: rec.recommendationText,
    notes: rec.notes,
  };
}

/** Only object URLs need releasing; a Supabase https URL must not be touched. */
function releasePreview(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function RecommendationModal({ open, initial, onClose, onSaved }: Props) {
  const { push } = useToast();
  const editing = initial != null;

  const [form, setForm] = React.useState<FormState>(blankForm);
  const [image, setImage] = React.useState<{ path: string | null; url: string } | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const fileRef = React.useRef<HTMLInputElement>(null);

  // Reload the form whenever the dialog opens, so editing one card and then
  // another does not show the first card's values.
  React.useEffect(() => {
    if (!open) return;
    setForm(initial ? formFrom(initial) : blankForm());
    setPreview((prev) => {
      releasePreview(prev);
      return initial?.chartImageUrl ?? null;
    });
    setImage(
      initial?.chartImageUrl
        ? { path: initial.chartImagePath, url: initial.chartImageUrl }
        : null
    );
    if (fileRef.current) fileRef.current.value = "";
    // `initial` is only read at open time on purpose -- re-syncing mid-edit
    // would discard whatever the user has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => () => releasePreview(preview), [preview]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const upload = React.useCallback(
    async (file: File) => {
      setUploading(true);
      setPreview((prev) => {
        releasePreview(prev);
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
          releasePreview(prev);
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
    setForm((f) => {
      const next = [...f[field]];
      next[index] = value;
      return { ...f, [field]: next };
    });
  }

  function addLevel(field: LevelField) {
    setForm((f) => ({ ...f, [field]: [...f[field], ""] }));
  }

  function removeLevel(field: LevelField, index: number) {
    setForm((f) => {
      const next = f[field].filter((_, i) => i !== index);
      return { ...f, [field]: next.length ? next : [""] };
    });
  }

  function setRange(field: RangeField, end: "from" | "to", value: string) {
    setForm((f) => ({ ...f, [field]: { ...f[field], [end]: value } }));
  }

  function clearImage() {
    setImage(null);
    setPreview((prev) => {
      releasePreview(prev);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || uploading) return;
    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/nifty-weekly/${initial!.id}` : "/api/nifty-weekly",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            chartImagePath: image?.path ?? null,
            chartImageUrl: image?.url ?? null,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save");
      onSaved(json.recommendation as Recommendation, editing ? "updated" : "created");
      push(editing ? "Recommendation updated" : "Recommendation added", "success");
      onClose();
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="rec-form-title" className="kite-theme max-w-2xl">
      <form onSubmit={submit}>
        <div className="border-b px-5 py-4 pr-14">
          <h2 id="rec-form-title" className="text-base font-semibold text-foreground">
            {editing ? "Edit weekly recommendation" : "Add weekly recommendation"}
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
                    onClick={clearImage}
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
                value={form.weekEnding}
                onChange={(e) => set("weekEnding", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="horizon">Recommendation time</Label>
              <Select
                id="horizon"
                value={form.horizon}
                onChange={(e) => set("horizon", e.target.value as Horizon)}
                className="mt-1.5 h-9 w-full"
              >
                {HORIZONS.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="trend">Trend</Label>
              <Select
                id="trend"
                value={form.trend}
                onChange={(e) => set("trend", e.target.value as Trend)}
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
                value={form.bias}
                onChange={(e) => set("bias", e.target.value as Bias)}
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
                value={form.setupStatus}
                onChange={(e) => set("setupStatus", e.target.value as SetupStatus)}
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
                value={form.spotPrice}
                onChange={(e) => set("spotPrice", e.target.value)}
                className="mt-1.5 kite-num"
              />
            </div>
            <div>
              <Label htmlFor="chg-pts">Change (pts)</Label>
              <Input
                id="chg-pts"
                inputMode="decimal"
                placeholder="+142.30"
                value={form.changePoints}
                onChange={(e) => set("changePoints", e.target.value)}
                className="mt-1.5 kite-num"
              />
            </div>
            <div>
              <Label htmlFor="chg-pct">Change (%)</Label>
              <Input
                id="chg-pct"
                inputMode="decimal"
                placeholder="+0.59"
                value={form.changePercent}
                onChange={(e) => set("changePercent", e.target.value)}
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
                  {form[key].map((value, i) => (
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

          {/* ------------------------------------------- ranges -------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {RANGE_FIELDS.map(({ key, label, hint, from, to }) => (
              <div key={key}>
                <Label htmlFor={`${key}-from`}>
                  {label} <span className="font-normal text-muted-foreground">— {hint}</span>
                </Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    id={`${key}-from`}
                    inputMode="decimal"
                    placeholder={from}
                    aria-label={`${label} range from`}
                    value={form[key].from}
                    onChange={(e) => setRange(key, "from", e.target.value)}
                    className="kite-num"
                  />
                  <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                    –
                  </span>
                  <Input
                    inputMode="decimal"
                    placeholder={to}
                    aria-label={`${label} range to`}
                    value={form[key].to}
                    onChange={(e) => setRange(key, "to", e.target.value)}
                    className="kite-num"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ------------------------------------------- prose --------- */}
          <div>
            <Label htmlFor="explanatory-note">Explanatory note</Label>
            <Textarea
              id="explanatory-note"
              rows={2}
              maxLength={400}
              placeholder="One or two lines — the gist of the call."
              value={form.explanatoryNote}
              onChange={(e) => set("explanatoryNote", e.target.value)}
              className="mt-1.5"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {form.explanatoryNote.length}/400
            </p>
          </div>

          <div>
            <Label htmlFor="recommendation-text">Recommendation</Label>
            <Textarea
              id="recommendation-text"
              rows={3}
              placeholder="The call itself — e.g. buy dips into 24,150–23,880, target 25,400, exit below 23,750."
              value={form.recommendationText}
              onChange={(e) => set("recommendationText", e.target.value)}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={5}
              placeholder="Wave count, momentum, levels to watch, anything worth remembering…"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
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
            {saving ? "Saving…" : editing ? "Save changes" : "Save recommendation"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
