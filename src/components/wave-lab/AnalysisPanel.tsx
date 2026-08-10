"use client";

/**
 * The verdict panel. §5.
 *
 * Hard rules are listed above guidelines and coloured differently, because the
 * distinction is the whole point: red means the count is wrong, amber means it
 * is unusual. Each row carries its sentence rather than a tick, since "which
 * guideline failed, and by how much" is what an analyst acts on.
 */

import * as React from "react";
import { AlertTriangle, Check, Circle, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { analyse, type Analysis, type RuleResult } from "@/lib/wave-lab/analysis/rules";
import { useDrawings } from "@/lib/wave-lab/drawings/store";
import { TOOL_SPECS } from "@/lib/wave-lab/drawings/tools";
import { DEGREE_META } from "@/lib/wave-lab/drawings/degrees";
import type { MarketCandle } from "@/lib/wave-lab/types";
import type { TerminalId } from "@/lib/wave-lab/workspace-store";

const CONFIDENCE_STYLE: Record<Analysis["confidence"], string> = {
  High: "bg-[var(--wl-profit)]/15 text-[var(--wl-profit)] border-[var(--wl-profit)]/40",
  Medium: "bg-[var(--wl-blue)]/15 text-[var(--wl-blue)] border-[var(--wl-blue)]/40",
  Low: "bg-[var(--wl-amber)]/15 text-[var(--wl-amber)] border-[var(--wl-amber)]/40",
  Invalid: "bg-[var(--wl-sell)]/15 text-[var(--wl-sell)] border-[var(--wl-sell)]/40",
};

const num = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AnalysisPanel({
  terminal,
  candles,
  onClose,
}: {
  terminal: TerminalId;
  candles: MarketCandle[];
  onClose: () => void;
}) {
  const selectedId = useDrawings((s) => s.selectedId);
  const drawings = useDrawings((s) => s.byTerminal[terminal]?.drawings ?? []);
  const selected = drawings.find((d) => d.id === selectedId) ?? null;

  const analysis = React.useMemo(
    () => (selected ? analyse(selected, candles) : null),
    [selected, candles]
  );

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--wl-border)] bg-[var(--wl-bg)]">
      <header className="flex items-center gap-2 border-b border-[var(--wl-border)] px-2 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
          Wave analysis
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close analysis panel"
          className="ml-auto rounded-[3px] p-0.5 text-[var(--wl-muted)] hover:bg-[var(--wl-hover)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selected && (
          <p className="p-3 text-[12px] leading-relaxed text-[var(--wl-muted)]">
            Select a completed impulse, correction or triangle to see its verdict, the rules it
            passes, and the level at which the count is dead.
          </p>
        )}

        {selected && !analysis && (
          <p className="p-3 text-[12px] leading-relaxed text-[var(--wl-muted)]">
            {TOOL_SPECS[selected.kind].label} drawings are not rule-checked
            {selected.complete ? "" : " until every pivot is placed"}.
          </p>
        )}

        {selected && analysis && (
          <>
            {/* ------------------------------------------------ verdict -- */}
            <div className="border-b border-[var(--wl-border)] p-2.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-[3px] border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                    CONFIDENCE_STYLE[analysis.confidence]
                  )}
                  data-testid="verdict"
                >
                  {analysis.confidence}
                </span>
                <span className="text-[11px] text-[var(--wl-muted)]">
                  {TOOL_SPECS[selected.kind].label} · {DEGREE_META[selected.degree].label}
                </span>
              </div>

              <ul className="mt-2 space-y-1">
                {analysis.reasoning.map((line, i) => (
                  <li key={i} className="text-[12px] leading-snug text-[var(--wl-text)]">
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            {/* ------------------------------------------- invalidation -- */}
            {analysis.invalidation && (
              <div
                className="border-b border-[var(--wl-border)] bg-[var(--wl-sell)]/[0.06] p-2.5"
                data-testid="invalidation"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-sell)]">
                  Invalidation
                </div>
                <div className="mt-0.5 font-[var(--wl-font-num)] text-[15px] font-semibold tabular-nums text-[var(--wl-sell)]">
                  {num(analysis.invalidation.price)}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--wl-text)]">
                  {analysis.invalidation.rationale}
                </p>
              </div>
            )}

            <RuleList
              title="Hard rules"
              rules={analysis.results.filter((r) => r.kind === "hard")}
            />
            <RuleList
              title="Guidelines"
              rules={analysis.results.filter((r) => r.kind === "guideline")}
            />

            {/* ------------------------------------------------ legs ----- */}
            <section className="border-b border-[var(--wl-border)] p-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
                Legs
              </h3>
              <table className="mt-1.5 w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-left text-[var(--wl-muted)]">
                    <th className="font-medium">Wave</th>
                    <th className="font-medium">Points</th>
                    <th className="font-medium">%</th>
                    <th className="font-medium">Bars</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.legs.map((leg) => {
                    const clean = leg.matches.filter((m) => m.significant);
                    return (
                      <tr key={leg.label} className="border-t border-[var(--wl-border)]">
                        <td className="py-0.5 font-semibold text-[var(--wl-text-strong)]">
                          {leg.label}
                        </td>
                        <td className={leg.points >= 0 ? "text-[var(--wl-profit)]" : "text-[var(--wl-loss)]"}>
                          {leg.points >= 0 ? "+" : ""}
                          {num(leg.points)}
                        </td>
                        <td className="text-[var(--wl-text)]">{(leg.percent * 100).toFixed(1)}</td>
                        <td className="text-[var(--wl-text)]">
                          {leg.bars}
                          {clean.length > 0 && (
                            <span
                              title={clean
                                .map((m) => `${m.series} ${m.term}${m.delta ? ` ${m.delta > 0 ? "+" : ""}${m.delta}` : ""}`)
                                .join(", ")}
                              className="ml-1 text-[var(--wl-blue)]"
                            >
                              ✦
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] leading-snug text-[var(--wl-muted)]">
                ✦ marks a clean Fibonacci or Lucas bar count. Spans under 13 bars are excluded —
                both series blanket the small numbers, so a match there means nothing.
              </p>
            </section>

            {/* --------------------------------------------- time ------- */}
            <section className="p-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
                Time
              </h3>
              {analysis.barsSinceLastPivot !== null && (
                <p className="mt-1 text-[11px] text-[var(--wl-text)]">
                  <span className="tabular-nums font-semibold">{analysis.barsSinceLastPivot}</span>{" "}
                  bars since the last pivot.
                  {analysis.upcoming.length > 0 && (
                    <>
                      {" "}
                      Next counts to watch:{" "}
                      <span className="tabular-nums font-semibold">
                        {analysis.upcoming.join(", ")}
                      </span>
                      .
                    </>
                  )}
                </p>
              )}
              {analysis.clusters.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {analysis.clusters.map((c) => (
                    <li key={c.barIndex} className="text-[11px] text-[var(--wl-text)]">
                      Bar <span className="tabular-nums font-semibold">{c.barIndex}</span> —{" "}
                      {c.convergence} pivots converge
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[11px] text-[var(--wl-muted)]">
                  No time cluster with two or more independent pivots converging.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function RuleList({ title, rules }: { title: string; rules: RuleResult[] }) {
  if (!rules.length) return null;
  return (
    <section className="border-b border-[var(--wl-border)] p-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wl-muted)]">
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1.5">
        {rules.map((r) => (
          <li key={r.id} className="flex gap-1.5">
            <RuleIcon rule={r} />
            <div className="min-w-0">
              <div
                className={cn(
                  "text-[11px] font-medium leading-snug",
                  r.status === "fail" && r.kind === "hard" && "text-[var(--wl-sell)]",
                  r.status === "fail" && r.kind === "guideline" && "text-[var(--wl-amber)]",
                  r.status === "pass" && "text-[var(--wl-text-strong)]",
                  r.status === "not-applicable" && "text-[var(--wl-muted)]"
                )}
              >
                {r.label}
              </div>
              <p className="text-[11px] leading-snug text-[var(--wl-muted)]">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RuleIcon({ rule }: { rule: RuleResult }) {
  const cls = "mt-0.5 h-3 w-3 shrink-0";
  if (rule.status === "not-applicable") return <Minus className={cn(cls, "text-[var(--wl-muted)]")} />;
  if (rule.status === "pass") return <Check className={cn(cls, "text-[var(--wl-profit)]")} />;
  return rule.kind === "hard" ? (
    <X className={cn(cls, "text-[var(--wl-sell)]")} />
  ) : (
    <AlertTriangle className={cn(cls, "text-[var(--wl-amber)]")} />
  );
}
