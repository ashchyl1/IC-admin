"use client";

/**
 * The inspector — the half of Elliott work the drawing tools do not do.
 *
 * TradingView's wave tools label and stop there; every rule check is left to
 * the analyst's memory. This panel runs them: non-overlap, wave 2 retracement,
 * wave 3 length, alternation, channelling, the Fibonacci relationships and the
 * pattern-specific rules for diagonals, flats, triangles and combinations —
 * each with the number that produced the verdict, so a "fail" can be argued
 * with rather than merely obeyed.
 */

import * as React from "react";
import { ChevronRight, Eye, EyeOff, Trash2 } from "lucide-react";

import type { MarketCandle } from "@/lib/market/types";
import { DEGREES, decorateLabel } from "@/lib/wave/degrees";
import { formatRatio } from "@/lib/wave/fib";
import { computeMetrics, type DrawingMetrics } from "@/lib/wave/metrics";
import { TOOLS, variantSpec } from "@/lib/wave/patterns";
import { validate, type ConfidenceTier, type RuleResult, type Validation } from "@/lib/wave/rules";
import { barIndexer, type Drawing, type TerminalState } from "@/lib/wave/types";
import { Badge, clsx } from "@/components/scalper/ui";

interface Props {
  terminal: TerminalState;
  candles: MarketCandle[];
  onSelect: (drawingId: string | null) => void;
  onUpdate: (drawingId: string, patch: Partial<Drawing>) => void;
  onDelete: (drawingId: string) => void;
}

export function WaveInspector({ terminal, candles, onSelect, onUpdate, onDelete }: Props) {
  const index = React.useMemo(() => barIndexer(candles), [candles]);
  const selected = terminal.drawings.find((drawing) => drawing.id === terminal.selectedId) ?? null;

  const analysis = React.useMemo(() => {
    if (!selected) return null;
    const metrics = computeMetrics(selected, candles, index);
    return metrics ? { metrics, validation: validate(selected, metrics) } : null;
  }, [selected, candles, index]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DrawingList
        terminal={terminal}
        candles={candles}
        onSelect={onSelect}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selected ? (
          <Empty />
        ) : !analysis ? (
          <p className="p-3 text-[11px] text-slate-500">
            {TOOLS[selected.tool].elliott
              ? "Place at least two points to measure this pattern."
              : "Measurement tools are not rule-checked — use them to test a count, not to state one."}
          </p>
        ) : (
          <SelectedDetail
            drawing={selected}
            metrics={analysis.metrics}
            validation={analysis.validation}
            onUpdate={onUpdate}
          />
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="space-y-2 p-3 text-[11px] leading-relaxed text-slate-500">
      <p className="font-semibold text-slate-400">No drawing selected.</p>
      <p>
        Pick an Elliott tool from the rail, then click the origin followed by each labelled pivot. With
        the magnet on, every click lands on the nearest bar&apos;s high or low.
      </p>
      <p>
        Once a pattern is complete, every rule and guideline is checked here — and exported with the
        count when you send it to Claude.
      </p>
    </div>
  );
}

function DrawingList({
  terminal,
  candles,
  onSelect,
  onUpdate,
  onDelete,
}: {
  terminal: TerminalState;
  candles: MarketCandle[];
  onSelect: (drawingId: string | null) => void;
  onUpdate: (drawingId: string, patch: Partial<Drawing>) => void;
  onDelete: (drawingId: string) => void;
}) {
  const index = React.useMemo(() => barIndexer(candles), [candles]);

  return (
    <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-slate-800">
      {terminal.drawings.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-slate-600">No drawings on this chart yet.</p>
      ) : (
        terminal.drawings.map((drawing) => {
          const spec = TOOLS[drawing.tool];
          const degree = DEGREES[drawing.degree];
          const metrics = spec.elliott ? computeMetrics(drawing, candles, index) : null;
          const tier = metrics ? validate(drawing, metrics).tier : null;
          const active = drawing.id === terminal.selectedId;

          return (
            <div
              key={drawing.id}
              className={clsx(
                "flex items-center gap-1.5 border-l-2 px-2 py-1.5 transition-colors",
                active ? "border-cyan-500 bg-slate-800/60" : "border-transparent hover:bg-slate-800/30"
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(drawing.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: drawing.color ?? degree.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-slate-200">
                    {spec.elliott
                      ? spec.labels.map((base) => decorateLabel(base, drawing.degree)).join("-")
                      : spec.label}
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {spec.elliott ? `${degree.label}${drawing.variant ? ` · ${variantSpec(drawing.tool, drawing.variant)?.label}` : ""}` : `${drawing.points.length} points`}
                  </span>
                </span>
                {tier ? <TierBadge tier={tier} /> : null}
              </button>

              <button
                type="button"
                aria-label={drawing.hidden ? "Show drawing" : "Hide drawing"}
                title={drawing.hidden ? "Show" : "Hide"}
                onClick={() => onUpdate(drawing.id, { hidden: !drawing.hidden })}
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              >
                {drawing.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                aria-label="Delete drawing"
                title="Delete"
                onClick={() => onDelete(drawing.id)}
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-rose-900/50 hover:text-rose-300"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function SelectedDetail({
  drawing,
  metrics,
  validation,
  onUpdate,
}: {
  drawing: Drawing;
  metrics: DrawingMetrics;
  validation: Validation;
  onUpdate: (drawingId: string, patch: Partial<Drawing>) => void;
}) {
  const spec = TOOLS[drawing.tool];
  const variant = variantSpec(drawing.tool, drawing.variant);

  return (
    <div className="divide-y divide-slate-800">
      <section className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-slate-100">
              {DEGREES[drawing.degree].label}{" "}
              <span style={{ color: DEGREES[drawing.degree].color }}>
                {spec.labels.map((base) => decorateLabel(base, drawing.degree)).join("-")}
              </span>
            </div>
            <div className="truncate text-[10px] text-slate-500">{spec.label}</div>
          </div>
          <TierBadge tier={validation.tier} />
        </div>

        {variant ? (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-300">{variant.label}.</span> {variant.description}
          </p>
        ) : null}

        <p
          className={clsx(
            "mt-2 rounded border px-2 py-1.5 text-[11px] leading-relaxed",
            validation.hardFailures > 0
              ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
              : "border-slate-800 bg-slate-900/60 text-slate-300"
          )}
        >
          {validation.summary}
        </p>

        {validation.invalidation ? (
          <p className="mt-1.5 text-[11px] text-slate-400">
            <span className="font-semibold text-amber-300">Invalidation </span>
            <span className="font-mono">{fmt(validation.invalidation.price)}</span> —{" "}
            {validation.invalidation.reason}
          </p>
        ) : null}

        <textarea
          value={drawing.note ?? ""}
          onChange={(event) => onUpdate(drawing.id, { note: event.target.value })}
          placeholder="Note for this count — alternate labelling, what would change your mind…"
          rows={2}
          className="mt-2 w-full resize-y rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
        />
      </section>

      <Section title="Legs">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="pb-1 font-semibold">Wave</th>
              <th className="pb-1 text-right font-semibold">Move</th>
              <th className="pb-1 text-right font-semibold">%</th>
              <th className="pb-1 text-right font-semibold">Bars</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {metrics.legs.map((leg) => (
              <tr key={leg.index} className="border-t border-slate-800/60">
                <td className="py-1 font-sans font-semibold" style={{ color: DEGREES[drawing.degree].color }}>
                  {leg.label}
                </td>
                <td className={clsx("py-1 text-right", leg.change >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {leg.change >= 0 ? "+" : ""}
                  {fmt(leg.change)}
                </td>
                <td className="py-1 text-right text-slate-400">{leg.changePct.toFixed(1)}</td>
                <td className="py-1 text-right text-slate-400">{leg.bars}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[10px] text-slate-500">
          Total {fmt(metrics.totalRange)} points over {metrics.totalBars} bars
          {metrics.priceNumber
            ? ` — range lands on Fibonacci/Lucas ${metrics.priceNumber.value} × ${metrics.priceNumber.scale}`
            : ""}
          .
        </p>
      </Section>

      <Section title="Fibonacci relationships">
        <ul className="space-y-0.5">
          {metrics.ratios.map((ratio) => (
            <li key={ratio.key} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-slate-400">{ratio.label}</span>
              <span
                className={clsx(
                  "shrink-0 font-mono",
                  ratio.match.hit ? "font-bold text-emerald-300" : "text-slate-500"
                )}
                title={ratio.match.target ? `nearest standard ratio ${ratio.match.target}` : undefined}
              >
                {formatRatio(ratio.value)}
                {ratio.match.hit ? ` ✓ ${ratio.match.label}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Time analysis">
        {metrics.clusters.length > 0 ? (
          <div className="mb-2 space-y-1">
            {metrics.clusters.map((cluster) => (
              <div
                key={cluster.bars}
                className="rounded border border-cyan-800/60 bg-cyan-950/30 px-2 py-1 text-[11px] text-cyan-200"
              >
                <span className="font-bold">Cluster at bar {cluster.bars}</span> — {cluster.strength} counts:{" "}
                <span className="text-cyan-300/80">{cluster.members.map((m) => m.label).join("; ")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-[11px] text-slate-500">
            No time clusters. Off a significant bar, a trend more often continues than turns.
          </p>
        )}

        <ul className="space-y-0.5">
          {metrics.timeCounts.map((count) => (
            <li key={count.label} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-slate-400">{count.label}</span>
              <span
                className={clsx(
                  "shrink-0 font-mono",
                  count.match.hit ? "font-bold text-emerald-300" : "text-slate-500"
                )}
              >
                {count.bars}
                {count.match.hit
                  ? ` ✓ ${count.match.hits.map((hit) => `${hit.series[0].toUpperCase()}${hit.value}`).join(" ")}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Rule checks — ${validation.score}% of guidelines met`}>
        <ul className="space-y-1.5">
          {validation.results.map((result) => (
            <RuleRow key={result.id} result={result} />
          ))}
        </ul>
      </Section>
    </div>
  );
}

function RuleRow({ result }: { result: RuleResult }) {
  const [open, setOpen] = React.useState(result.status === "fail");
  const mark =
    result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : result.status === "warn" ? "⚠️" : "—";

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 text-left"
      >
        <span className="mt-px shrink-0 text-[11px]" aria-hidden="true">
          {mark}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              "block text-[11px] font-semibold",
              result.status === "fail"
                ? "text-rose-300"
                : result.status === "warn"
                  ? "text-amber-200"
                  : "text-slate-300"
            )}
          >
            {result.title}
            {result.severity === "rule" ? (
              <span className="ml-1 rounded bg-slate-800 px-1 text-[9px] font-bold uppercase text-slate-400">
                rule
              </span>
            ) : null}
          </span>
          {open ? <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">{result.detail}</span> : null}
        </span>
        <ChevronRight
          className={clsx("mt-0.5 h-3 w-3 shrink-0 text-slate-600 transition-transform", open && "rotate-90")}
        />
      </button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p-3">
      <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function TierBadge({ tier }: { tier: ConfidenceTier }) {
  const tone = tier === "High" ? "green" : tier === "Medium" ? "cyan" : tier === "Low" ? "amber" : "red";
  const title =
    tier === "High"
      ? "Pattern, price ratio and a time cluster all agree."
      : tier === "Medium"
        ? "Pattern plus one confirming layer. Size down."
        : tier === "Low"
          ? "Structure is legal but unconfirmed."
          : "A hard rule is broken — re-label before trading this count.";
  return (
    <Badge tone={tone} title={title}>
      {tier}
    </Badge>
  );
}

function fmt(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
