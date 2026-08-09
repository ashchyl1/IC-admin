/**
 * The Claude hand-off.
 *
 * Everything on screen — the price series, the wave labels, every measured
 * ratio, every time count and the rule verdicts — reduced to one JSON document
 * that Claude can read without seeing the chart, plus a Markdown brief for
 * pasting straight into a conversation.
 *
 * The schema is versioned and round-trips: `serialize.ts` reads the same
 * document back, so a count Claude proposes can be loaded onto the chart and a
 * count you drew can be handed to Claude, with no lossy step in between.
 */

import { fromChartTime } from "@/lib/scalper/time";
import type { MarketCandle, ProviderInfo } from "@/lib/market/types";
import { INTERVALS } from "@/lib/market/types";
import { DEGREES, decorateLabel } from "./degrees";
import { formatPct, formatRatio, upcomingTimeBars } from "./fib";
import { computeIndicators, lastValue } from "./indicators";
import { computeMetrics, type DrawingMetrics } from "./metrics";
import { TOOLS, variantSpec } from "./patterns";
import { pnlOf, rMultiple, summarise, type PaperPosition } from "./paper";
import { validate, type Validation } from "./rules";
import { barIndexer, type Drawing, type TerminalState } from "./types";

export const SCHEMA_ID = "indiacharts.wave-analysis/v1";

export type CandlePolicy = "none" | "pattern" | "recent" | "all";

export interface ExportOptions {
  /** How much of the price series to embed. `pattern` covers the labelled span. */
  candles: CandlePolicy;
  /** Cap for `recent` and the padding either side of `pattern`. */
  recentBars: number;
  /** A question to put at the top of the brief. */
  question?: string;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  candles: "pattern",
  recentBars: 250,
};

export interface PointExport {
  label: string;
  base: string;
  time: number;
  iso: string;
  barIndex: number;
  price: number;
}

export interface DrawingExport {
  id: string;
  tool: string;
  toolLabel: string;
  degree: string;
  degreeLabel: string;
  variant?: string;
  variantLabel?: string;
  variantDescription?: string;
  sequence: string;
  note?: string;
  complete: boolean;
  direction: "up" | "down";
  points: PointExport[];
  legs: {
    wave: string;
    label: string;
    from: { iso: string; price: number; barIndex: number };
    to: { iso: string; price: number; barIndex: number };
    pricePoints: number;
    pricePct: number;
    bars: number;
  }[];
  ratios: { label: string; kind: "price" | "time"; value: number; nearest: string | null; onTarget: boolean }[];
  timeCounts: { label: string; bars: number; matches: string[] }[];
  timeClusters: { bars: number; strength: number; counts: string[] }[];
  channel: { baseFrom: number; baseTo: number; through: number; projectedAtEnd: number; overshoot: number } | null;
  totals: { rangePoints: number; rangePct: number; bars: number; priceNumber: string | null };
  validation: {
    tier: Validation["tier"];
    summary: string;
    hardFailures: number;
    guidelineScore: number;
    invalidation: Validation["invalidation"];
    checks: { id: string; title: string; severity: string; status: string; detail: string }[];
  };
}

export interface TerminalExport {
  id: string;
  title: string;
  symbol: string;
  instrumentToken?: number;
  interval: string;
  intervalLabel: string;
  chartType: string;
  priceScale: string;
  provider: ProviderInfo | null;
  range: {
    fromIso: string;
    toIso: string;
    bars: number;
    first: number;
    last: number;
    high: number;
    low: number;
    changePct: number;
  } | null;
  indicators: {
    emas: { period: number; last: number | null; priceVsEma: string | null }[];
    bollinger:
      | { period: number; stdDev: number; source: string; basis: number | null; upper: number | null; lower: number | null; percentB: number | null; bandwidth: number | null; state: string }
      | null;
    vwap: number | null;
  };
  /** Bars since the most recent labelled pivot, and the next key counts. */
  timeWatch: { barsSinceLastPivot: number | null; upcomingKeyBars: number[] } | null;
  drawings: DrawingExport[];
  candles?: { columns: string[]; rows: (string | number)[][] };
}

export interface PaperTradeExport {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entry: { price: number; iso: string };
  stopLoss: number | null;
  target: number | null;
  status: string;
  exit?: { price: number; iso: string; reason: string };
  pnl: number;
  rMultiple: number | null;
  /** The wave count this trade was taken on, when it was linked to one. */
  onCount?: string;
  note?: string;
}

export interface WaveAnalysisBundle {
  schema: typeof SCHEMA_ID;
  generatedAt: string;
  source: { app: string; module: string; timezone: string };
  question?: string;
  terminals: TerminalExport[];
  /**
   * Simulated trades. Included so a review can ask whether the count was right
   * *and* whether it was traded well — two different questions that a bare set
   * of labels cannot answer. No broker was involved in any of these.
   */
  paperTrades?: {
    simulated: true;
    summary: { net: number; realised: number; unrealised: number; wins: number; losses: number; totalR: number | null };
    trades: PaperTradeExport[];
  };
}

export interface TerminalSnapshot {
  state: TerminalState;
  candles: MarketCandle[];
  provider: ProviderInfo | null;
}

export function buildBundle(
  terminals: TerminalSnapshot[],
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  positions: PaperPosition[] = []
): WaveAnalysisBundle {
  const lastFor = (position: PaperPosition) => {
    const terminal = terminals.find((entry) => entry.state.symbol === position.symbol);
    return terminal?.candles[terminal.candles.length - 1]?.close ?? null;
  };

  return {
    schema: SCHEMA_ID,
    generatedAt: new Date().toISOString(),
    source: {
      app: "IndiaCharts admin",
      module: "Wave Lab",
      timezone: "Asia/Kolkata",
    },
    question: options.question,
    terminals: terminals.map((terminal) => buildTerminal(terminal, options)),
    paperTrades:
      positions.length === 0
        ? undefined
        : {
            simulated: true,
            summary: (() => {
              const totals = summarise(positions, lastFor);
              return {
                net: round(totals.net),
                realised: round(totals.realised),
                unrealised: round(totals.unrealised),
                wins: totals.wins,
                losses: totals.losses,
                totalR: totals.totalR === null ? null : round(totals.totalR, 2),
              };
            })(),
            trades: positions.map((position) => ({
              id: position.id,
              symbol: position.symbol,
              side: position.side,
              quantity: position.quantity,
              entry: { price: position.entryPrice, iso: isoOf(position.entryTime) },
              stopLoss: position.stopLoss,
              target: position.target,
              status: position.status,
              exit: position.exit
                ? { price: position.exit.price, iso: isoOf(position.exit.time), reason: position.exit.reason }
                : undefined,
              pnl: round(pnlOf(position, lastFor(position))),
              rMultiple: (() => {
                const r = rMultiple(position, lastFor(position));
                return r === null ? null : round(r, 2);
              })(),
              onCount: position.drawingLabel,
              note: position.note,
            })),
          },
  };
}

function buildTerminal(snapshot: TerminalSnapshot, options: ExportOptions): TerminalExport {
  const { state, candles, provider } = snapshot;
  const index = barIndexer(candles);
  const indicators = computeIndicators(candles, state.indicators);

  const elliottDrawings = state.drawings.filter((drawing) => TOOLS[drawing.tool].elliott);
  const drawings = elliottDrawings
    .map((drawing) => {
      const metrics = computeMetrics(drawing, candles, index);
      return metrics ? buildDrawing(drawing, metrics, validate(drawing, metrics)) : null;
    })
    .filter((entry): entry is DrawingExport => entry !== null);

  const last = candles[candles.length - 1];
  const first = candles[0];
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);

  const lastPivotTime = elliottDrawings
    .flatMap((drawing) => drawing.points.map((point) => point.time))
    .reduce<number | null>((max, time) => (max === null || time > max ? time : max), null);

  const bbSettings = state.indicators.bollinger;
  const bbLastUpper = lastValue(indicators.bollinger?.upper);
  const bbLastLower = lastValue(indicators.bollinger?.lower);
  const bbPercentB = lastValue(indicators.bollinger?.percentB);
  const bbBandwidth = lastValue(indicators.bollinger?.bandwidth);

  return {
    id: state.id,
    title: state.title,
    symbol: state.symbol,
    instrumentToken: state.instrumentToken,
    interval: state.interval,
    intervalLabel: INTERVALS[state.interval].label,
    chartType: state.chartType,
    priceScale: state.scale,
    provider,
    range:
      first && last
        ? {
            fromIso: isoOf(first.time),
            toIso: isoOf(last.time),
            bars: candles.length,
            first: first.open,
            last: last.close,
            high: Math.max(...highs),
            low: Math.min(...lows),
            changePct: first.open === 0 ? 0 : ((last.close - first.open) / first.open) * 100,
          }
        : null,
    indicators: {
      emas: indicators.emas.map((line) => {
        const value = lastValue(line.values);
        return {
          period: line.period,
          last: value,
          priceVsEma:
            value === null || !last ? null : last.close >= value ? "above" : "below",
        };
      }),
      bollinger: indicators.bollinger
        ? {
            period: bbSettings.period,
            stdDev: bbSettings.stdDev,
            source: bbSettings.source,
            basis: lastValue(indicators.bollinger.basis),
            upper: bbLastUpper,
            lower: bbLastLower,
            percentB: bbPercentB,
            bandwidth: bbBandwidth,
            state: bollingerState(bbPercentB, bbBandwidth, indicators.bollinger.bandwidth),
          }
        : null,
      vwap: lastValue(indicators.vwap),
    },
    timeWatch:
      lastPivotTime === null
        ? null
        : (() => {
            const bars = Math.max(0, index.indexOf(last?.time ?? 0) - index.indexOf(lastPivotTime));
            return { barsSinceLastPivot: bars, upcomingKeyBars: upcomingTimeBars(bars, 5) };
          })(),
    drawings,
    candles: buildCandleBlock(candles, elliottDrawings, index, options),
  };
}

function buildDrawing(drawing: Drawing, metrics: DrawingMetrics, validation: Validation): DrawingExport {
  const spec = TOOLS[drawing.tool];
  const variant = variantSpec(drawing.tool, drawing.variant);

  return {
    id: drawing.id,
    tool: drawing.tool,
    toolLabel: spec.label,
    degree: drawing.degree,
    degreeLabel: DEGREES[drawing.degree].label,
    variant: drawing.variant,
    variantLabel: variant?.label,
    variantDescription: variant?.description,
    sequence: spec.labels.map((base) => decorateLabel(base, drawing.degree)).join("-"),
    note: drawing.note,
    complete: metrics.complete,
    direction: metrics.direction > 0 ? "up" : "down",
    points: drawing.points.map((point, i) => {
      const base = i === 0 ? "0" : spec.labels[i - 1] ?? "";
      return {
        label: i === 0 ? "origin" : decorateLabel(base, drawing.degree),
        base: i === 0 ? "origin" : base,
        time: point.time,
        iso: isoOf(point.time),
        barIndex: metrics.legs[Math.max(0, i - 1)]
          ? i === 0
            ? metrics.legs[0].fromIndex
            : metrics.legs[i - 1].toIndex
          : 0,
        price: round(point.price),
      };
    }),
    legs: metrics.legs.map((leg) => ({
      wave: leg.base,
      label: leg.label,
      from: { iso: isoOf(leg.from.time), price: round(leg.from.price), barIndex: leg.fromIndex },
      to: { iso: isoOf(leg.to.time), price: round(leg.to.price), barIndex: leg.toIndex },
      pricePoints: round(leg.change),
      pricePct: round(leg.changePct),
      bars: leg.bars,
    })),
    ratios: metrics.ratios.map((ratio) => ({
      label: ratio.label,
      kind: ratio.kind,
      value: round(ratio.value, 3),
      nearest: ratio.match.label,
      onTarget: ratio.match.hit,
    })),
    timeCounts: metrics.timeCounts.map((count) => ({
      label: count.label,
      bars: count.bars,
      matches: count.match.hits.map(
        (hit) => `${hit.series} ${hit.value}${hit.delta === 0 ? "" : ` (${hit.delta > 0 ? "+" : ""}${hit.delta})`}`
      ),
    })),
    timeClusters: metrics.clusters.map((cluster) => ({
      bars: cluster.bars,
      strength: cluster.strength,
      counts: cluster.members.map((member) => member.label),
    })),
    channel: metrics.channel
      ? {
          baseFrom: round(metrics.channel.base[0].price),
          baseTo: round(metrics.channel.base[1].price),
          through: round(metrics.channel.through.price),
          projectedAtEnd: round(metrics.channel.projectionAtEnd),
          overshoot: round(metrics.channel.overshoot),
        }
      : null,
    totals: {
      rangePoints: round(metrics.totalRange),
      rangePct: round(metrics.startPrice === 0 ? 0 : (metrics.totalRange / metrics.startPrice) * 100),
      bars: metrics.totalBars,
      priceNumber: metrics.priceNumber
        ? `${metrics.priceNumber.value} × ${metrics.priceNumber.scale}`
        : null,
    },
    validation: {
      tier: validation.tier,
      summary: validation.summary,
      hardFailures: validation.hardFailures,
      guidelineScore: validation.score,
      invalidation: validation.invalidation,
      checks: validation.results.map((result) => ({
        id: result.id,
        title: result.title,
        severity: result.severity,
        status: result.status,
        detail: result.detail,
      })),
    },
  };
}

/**
 * Which bars to embed. `pattern` is the default because it is the honest
 * middle: enough context for Claude to see what the labels sit on, without
 * pasting six years of daily data into a message.
 */
function buildCandleBlock(
  candles: MarketCandle[],
  drawings: Drawing[],
  index: ReturnType<typeof barIndexer>,
  options: ExportOptions
): TerminalExport["candles"] {
  if (options.candles === "none" || candles.length === 0) return undefined;

  let slice = candles;
  if (options.candles === "recent") {
    slice = candles.slice(-options.recentBars);
  } else if (options.candles === "pattern") {
    const times = drawings.flatMap((drawing) => drawing.points.map((point) => point.time));
    if (times.length === 0) {
      slice = candles.slice(-options.recentBars);
    } else {
      const pad = Math.max(20, Math.round(options.recentBars * 0.2));
      const from = Math.max(0, index.indexOf(Math.min(...times)) - pad);
      const to = Math.min(candles.length, index.indexOf(Math.max(...times)) + pad);
      slice = candles.slice(from, to);
    }
  }

  return {
    columns: ["time", "open", "high", "low", "close", "volume"],
    rows: slice.map((candle) => [
      isoOf(candle.time),
      round(candle.open),
      round(candle.high),
      round(candle.low),
      round(candle.close),
      Math.round(candle.volume),
    ]),
  };
}

function bollingerState(
  percentB: number | null,
  bandwidth: number | null,
  history: (number | null)[] | undefined
): string {
  if (percentB === null) return "insufficient data";
  const position =
    percentB > 1 ? "closed above the upper band" : percentB < 0 ? "closed below the lower band" : percentB > 0.8 ? "riding the upper band" : percentB < 0.2 ? "riding the lower band" : "inside the bands";

  if (bandwidth === null || !history) return position;
  const recent = history.filter((value): value is number => value !== null).slice(-120);
  if (recent.length < 20) return position;
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const squeeze = bandwidth <= min * 1.15;
  const expansion = bandwidth >= max * 0.85;
  return `${position}${squeeze ? "; bandwidth at the low end of its recent range (squeeze)" : expansion ? "; bandwidth near its recent high (expansion)" : ""}`;
}

// -------------------------------------------------------------- markdown ---

/**
 * A brief in the SOP's own output format. This is what gets copied to the
 * clipboard — Claude reads it directly, and it stays readable to a human.
 */
export function toMarkdown(bundle: WaveAnalysisBundle): string {
  const lines: string[] = [];
  lines.push(`# Elliott Wave analysis pack`);
  lines.push("");
  lines.push(`Generated ${bundle.generatedAt} · ${bundle.source.app} → ${bundle.source.module} · times are ${bundle.source.timezone}.`);
  if (bundle.question) {
    lines.push("");
    lines.push(`**Question:** ${bundle.question}`);
  }

  for (const terminal of bundle.terminals) {
    lines.push("");
    lines.push(`## ${terminal.title} — ${terminal.intervalLabel} (${terminal.chartType}, ${terminal.priceScale} scale)`);
    lines.push("");
    lines.push(
      `Symbol \`${terminal.symbol}\` · data from ${terminal.provider?.label ?? "unknown"}${
        terminal.provider && !terminal.provider.live ? " **(simulated — not real market data)**" : ""
      }`
    );

    if (terminal.range) {
      lines.push(
        `Range ${terminal.range.fromIso} → ${terminal.range.toIso} · ${terminal.range.bars} bars · ` +
          `high ${terminal.range.high}, low ${terminal.range.low}, last ${terminal.range.last} (${terminal.range.changePct.toFixed(1)}%)`
      );
    }

    const { emas, bollinger } = terminal.indicators;
    if (emas.length > 0) {
      lines.push(
        `EMAs — ${emas.map((line) => `${line.period}: ${fmtNum(line.last)} (price ${line.priceVsEma ?? "n/a"})`).join(" · ")}`
      );
    }
    if (bollinger) {
      lines.push(
        `Bollinger ${bollinger.period}/${bollinger.stdDev}σ on ${bollinger.source} — upper ${fmtNum(bollinger.upper)}, basis ${fmtNum(bollinger.basis)}, lower ${fmtNum(bollinger.lower)}; %B ${fmtNum(bollinger.percentB, 2)}, bandwidth ${fmtNum(bollinger.bandwidth, 3)}; ${bollinger.state}.`
      );
    }
    if (terminal.timeWatch) {
      lines.push(
        `Time watch — ${terminal.timeWatch.barsSinceLastPivot} bars since the last labelled pivot; next key bars: ${terminal.timeWatch.upcomingKeyBars.join(", ")}.`
      );
    }

    if (terminal.drawings.length === 0) {
      lines.push("");
      lines.push("_No wave labels on this chart._");
      continue;
    }

    for (const drawing of terminal.drawings) {
      lines.push("");
      lines.push(`### ${drawing.degreeLabel} ${drawing.sequence} — ${drawing.toolLabel}`);
      lines.push(
        `**Confidence:** ${drawing.validation.tier}${drawing.variantLabel ? ` · Variant: ${drawing.variantLabel}` : ""}${
          drawing.complete ? "" : " · **incomplete count**"
        }`
      );
      if (drawing.note) lines.push(`> ${drawing.note}`);

      lines.push("");
      lines.push("#### Pattern structure");
      lines.push("");
      lines.push("| Wave | From | To | Points | % | Bars |");
      lines.push("|---|---|---|---:|---:|---:|");
      for (const leg of drawing.legs) {
        lines.push(
          `| ${leg.label} | ${leg.from.iso} @ ${leg.from.price} | ${leg.to.iso} @ ${leg.to.price} | ${leg.pricePoints} | ${leg.pricePct.toFixed(1)}% | ${leg.bars} |`
        );
      }

      const priceRatios = drawing.ratios.filter((ratio) => ratio.kind === "price");
      if (priceRatios.length > 0) {
        lines.push("");
        lines.push("#### Price relationships");
        for (const ratio of priceRatios) {
          lines.push(
            `- ${ratio.label}: ${formatRatio(ratio.value)}${ratio.nearest ? ` → nearest ${ratio.nearest}${ratio.onTarget ? " ✅" : " (off target)"}` : ""}`
          );
        }
        lines.push(
          `- Total move: ${drawing.totals.rangePoints} points (${drawing.totals.rangePct.toFixed(1)}%)${
            drawing.totals.priceNumber ? ` — lands on Fibonacci/Lucas ${drawing.totals.priceNumber}` : ""
          }`
        );
      }

      lines.push("");
      lines.push("#### Time analysis");
      for (const count of drawing.timeCounts.filter((entry) => entry.matches.length > 0)) {
        lines.push(`- ${count.label}: ${count.bars} bars → ${count.matches.join(", ")}`);
      }
      if (drawing.timeClusters.length > 0) {
        for (const cluster of drawing.timeClusters) {
          lines.push(`- **Cluster at bar ${cluster.bars}** (${cluster.strength} counts): ${cluster.counts.join("; ")}`);
        }
      } else {
        lines.push("- No time clusters found.");
      }

      lines.push("");
      lines.push("#### Rule checks");
      for (const check of drawing.validation.checks) {
        const mark = check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : check.status === "warn" ? "⚠️" : "—";
        lines.push(`- ${mark} **${check.title}** (${check.severity}) — ${check.detail}`);
      }
      lines.push("");
      lines.push(`**Verdict:** ${drawing.validation.summary}`);
      if (drawing.validation.invalidation) {
        lines.push(
          `**Invalidation:** ${drawing.validation.invalidation.price} — ${drawing.validation.invalidation.reason}`
        );
      }
    }
  }

  if (bundle.paperTrades && bundle.paperTrades.trades.length > 0) {
    const { summary, trades } = bundle.paperTrades;
    lines.push("");
    lines.push("## Paper trades (simulated — no broker was involved)");
    lines.push("");
    lines.push(
      `Net ${summary.net} · realised ${summary.realised} · open ${summary.unrealised} · ` +
        `${summary.wins}W / ${summary.losses}L${summary.totalR === null ? "" : ` · ${summary.totalR}R`}`
    );
    lines.push("");
    lines.push("| Side | Qty | Entry | Stop | Target | Exit | P&L | R | On count |");
    lines.push("|---|---:|---:|---:|---:|---|---:|---:|---|");
    for (const trade of trades) {
      lines.push(
        `| ${trade.side} | ${trade.quantity} | ${trade.entry.price} | ${trade.stopLoss ?? "—"} | ` +
          `${trade.target ?? "—"} | ${trade.exit ? `${trade.exit.price} (${trade.exit.reason})` : "open"} | ` +
          `${trade.pnl} | ${trade.rMultiple ?? "—"} | ${trade.onCount ?? "—"} |`
      );
    }
  }

  lines.push("");
  lines.push("---");
  lines.push(
    "The rule checks above are computed, not judged. Confirm the visual look, consider alternate counts, " +
      "and weigh the higher and lower degrees before acting."
  );
  return lines.join("\n");
}

export function suggestedPrompt(bundle: WaveAnalysisBundle): string {
  const names = bundle.terminals.map((terminal) => `${terminal.title} ${terminal.intervalLabel}`).join(" and ");
  return (
    `Use the elliott-wave-analysis SOP on the attached wave pack (${names}). ` +
    `Confirm or challenge each labelled count, propose the best alternate count, ` +
    `identify the next Fibonacci/Lucas time windows, and give me an entry, invalidation and target with a confidence tier.`
  );
}

function isoOf(chartSeconds: number): string {
  // Chart time is exchange-shifted; convert back before formatting so the
  // string is a real instant rather than a shifted one.
  return new Date(fromChartTime(chartSeconds)).toISOString();
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "n/a" : value.toFixed(digits);
}

export { formatPct };
