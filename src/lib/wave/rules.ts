/**
 * Elliott rule and guideline engine.
 *
 * The drawing tools only label; they do not check anything. This file is the
 * part that does — non-overlap, wave 2 retracement, wave 3 length, alternation,
 * channelling, the Fibonacci relationships, and the pattern-specific rules for
 * diagonals, flats, triangles and combinations.
 *
 * Two tiers, kept strictly apart:
 *
 *   `rule`      — breaking it invalidates the count. There are only a handful,
 *                 and they are the ones Elliott stated as absolutes.
 *   `guideline` — a tendency. Missing several weakens a count without killing
 *                 it, and some patterns are defined by breaking one.
 *
 * The verdict tiers follow the trade-thesis table in the house SOP: a hard
 * failure is a Pass (re-label, do not trade) no matter how pretty the ratios.
 */

import { formatPct, formatRatio, matchRatio, PRICE_RATIOS } from "./fib";
import type { DrawingMetrics, LegMetric } from "./metrics";
import { variantSpec } from "./patterns";
import type { Drawing } from "./types";

export type RuleSeverity = "rule" | "guideline" | "info";
export type RuleStatus = "pass" | "fail" | "warn" | "na";

export interface RuleResult {
  id: string;
  title: string;
  severity: RuleSeverity;
  status: RuleStatus;
  detail: string;
}

export type ConfidenceTier = "High" | "Medium" | "Low" | "Pass";

export interface Validation {
  drawingId: string;
  results: RuleResult[];
  hardFailures: number;
  guidelineMisses: number;
  /** 0–100, guidelines only — hard failures are reported separately. */
  score: number;
  tier: ConfidenceTier;
  summary: string;
  /** Price level that would invalidate the count, when the pattern defines one. */
  invalidation: { price: number; reason: string } | null;
}

export function validate(drawing: Drawing, metrics: DrawingMetrics | null): Validation {
  if (!metrics || metrics.legs.length === 0) {
    return {
      drawingId: drawing.id,
      results: [],
      hardFailures: 0,
      guidelineMisses: 0,
      score: 0,
      tier: "Low",
      summary: "Not enough points to validate yet.",
      invalidation: null,
    };
  }

  const results: RuleResult[] = [];
  switch (drawing.tool) {
    case "impulse":
      results.push(...impulseRules(drawing, metrics));
      break;
    case "correction":
      results.push(...correctionRules(drawing, metrics));
      break;
    case "triangle":
      results.push(...triangleRules(drawing, metrics));
      break;
    case "doubleCombo":
    case "tripleCombo":
      results.push(...comboRules(drawing, metrics));
      break;
    default:
      break;
  }
  results.push(...sharedChecks(metrics));

  return summarise(drawing, metrics, results);
}

// -------------------------------------------------------------- impulse ---

function impulseRules(drawing: Drawing, metrics: DrawingMetrics): RuleResult[] {
  const { legs } = metrics;
  const out: RuleResult[] = [];
  const variant = drawing.variant ?? "impulse";
  const diagonal = variant === "leadingDiagonal" || variant === "endingDiagonal";

  if (legs.length < 5) {
    out.push({
      id: "impulse.incomplete",
      title: "Five legs placed",
      severity: "info",
      status: "warn",
      detail: `${legs.length} of 5 legs drawn. Rules that need the missing legs are skipped.`,
    });
  }

  const dir = legs[0].direction;
  const wrongWay = legs.findIndex((leg, i) => leg.direction !== (i % 2 === 0 ? dir : -dir));
  out.push({
    id: "impulse.alternating-direction",
    title: "Legs alternate direction",
    severity: "rule",
    status: wrongWay === -1 ? "pass" : "fail",
    detail:
      wrongWay === -1
        ? `Motive legs run ${dir > 0 ? "up" : "down"}, corrective legs against.`
        : `Wave ${legs[wrongWay].base} runs the wrong way for a ${dir > 0 ? "bullish" : "bearish"} impulse.`,
  });

  // Rule 1 — wave 2 never retraces more than 100% of wave 1.
  if (legs.length >= 2) {
    const retrace = legs[1].length / legs[0].length;
    const beyondOrigin = dir > 0 ? legs[1].to.price <= metrics.startPrice : legs[1].to.price >= metrics.startPrice;
    out.push({
      id: "impulse.wave2-retracement",
      title: "Wave 2 holds above the start of wave 1",
      severity: "rule",
      status: retrace >= 1 || beyondOrigin ? "fail" : "pass",
      detail:
        retrace >= 1 || beyondOrigin
          ? `Wave 2 retraced ${formatPct(retrace)} of wave 1 and breached the origin at ${fmt(metrics.startPrice)}. That is not an impulse.`
          : `Wave 2 retraced ${formatPct(retrace)} of wave 1.`,
    });

    out.push(
      guideline(
        "impulse.wave2-depth",
        "Wave 2 depth is typical (0.5–0.786)",
        retrace >= 0.45 && retrace <= 0.82,
        `Wave 2 retraced ${formatPct(retrace)} of wave 1${
          retrace < 0.45 ? " — shallow, which hints at a strong trend or a running flat" : retrace > 0.82 ? " — deep; check that this is not wave B of a larger correction" : ""
        }.`
      )
    );
  }

  // Rule 2 — wave 3 is never the shortest of 1, 3 and 5.
  if (legs.length >= 5) {
    const [w1, , w3, , w5] = legs;
    const shortest = w3.length < w1.length && w3.length < w5.length;
    out.push({
      id: "impulse.wave3-not-shortest",
      title: "Wave 3 is not the shortest motive wave",
      severity: "rule",
      status: shortest ? "fail" : "pass",
      detail: shortest
        ? `Wave 3 (${fmt(w3.length)}) is shorter than both wave 1 (${fmt(w1.length)}) and wave 5 (${fmt(w5.length)}).`
        : `Wave 3 ${fmt(w3.length)} vs wave 1 ${fmt(w1.length)} and wave 5 ${fmt(w5.length)}.`,
    });
  }

  // Rule 3 — wave 4 does not enter wave 1's territory, except in a diagonal.
  if (legs.length >= 4) {
    const w1End = legs[0].to.price;
    const w4End = legs[3].to.price;
    const overlaps = dir > 0 ? w4End <= w1End : w4End >= w1End;

    if (diagonal) {
      out.push({
        id: "impulse.wave4-overlap",
        title: "Wave 1 / wave 4 overlap (diagonal)",
        severity: "info",
        status: overlaps ? "pass" : "warn",
        detail: overlaps
          ? `Wave 4 overlaps wave 1 at ${fmt(w4End)} — expected in a ${variantSpec("impulse", variant)?.label ?? "diagonal"}.`
          : "No overlap present. A diagonal usually shows one; consider labelling this as a plain impulse.",
      });
    } else {
      out.push({
        id: "impulse.wave4-overlap",
        title: "Wave 4 stays clear of wave 1",
        severity: "rule",
        status: overlaps ? "fail" : "pass",
        detail: overlaps
          ? `Wave 4 ended at ${fmt(w4End)}, inside wave 1's territory (${fmt(w1End)}). Re-label as a corrective structure or as a diagonal.`
          : `Wave 4 ended at ${fmt(w4End)}, clear of wave 1's ${fmt(w1End)}.`,
      });
    }

    const retrace4 = legs[3].length / legs[2].length;
    out.push(
      guideline(
        "impulse.wave4-depth",
        "Wave 4 depth is typical (0.236–0.5 of wave 3)",
        retrace4 >= 0.2 && retrace4 <= 0.55,
        `Wave 4 retraced ${formatPct(retrace4)} of wave 3.`
      )
    );

    // Alternation — the single most useful guideline for reading what comes next.
    if (legs.length >= 4) {
      const depth2 = legs[1].length / legs[0].length;
      const depthDiffers = Math.abs(depth2 - retrace4) > 0.15;
      const timeDiffers =
        legs[1].bars > 0 && legs[3].bars > 0
          ? Math.max(legs[1].bars, legs[3].bars) / Math.min(legs[1].bars, legs[3].bars) >= 1.4
          : false;
      out.push(
        guideline(
          "impulse.alternation",
          "Waves 2 and 4 alternate",
          depthDiffers || timeDiffers,
          depthDiffers || timeDiffers
            ? `Wave 2 ${formatPct(depth2)} over ${legs[1].bars} bars vs wave 4 ${formatPct(retrace4)} over ${legs[3].bars} bars — they alternate in ${depthDiffers ? "depth" : "duration"}.`
            : `Wave 2 (${formatPct(depth2)}, ${legs[1].bars} bars) and wave 4 (${formatPct(retrace4)}, ${legs[3].bars} bars) are alike. Alternation says one should be sharp and the other sideways — re-check the count.`
        )
      );
    }
  }

  // Wave 3 extension and the fifth-wave relationship.
  if (legs.length >= 3) {
    const ratio31 = legs[2].length / legs[0].length;
    const match = matchRatio(ratio31, PRICE_RATIOS);
    out.push(
      guideline(
        "impulse.wave3-extension",
        "Wave 3 reaches a Fibonacci multiple of wave 1",
        match.hit && (match.target ?? 0) >= 1.272,
        `Wave 3 = ${formatRatio(ratio31)} of wave 1${match.hit ? ` (${match.label})` : ""}${
          ratio31 >= 1.55 ? " — extended third." : ratio31 < 1 ? " — wave 3 is shorter than wave 1; check whether wave 5 will extend." : ""
        }`
      )
    );
  }

  if (legs.length >= 5) {
    const equality = legs[4].length / legs[0].length;
    const combined = legs[4].length / (legs[0].length + legs[2].length);
    const hit = matchRatio(equality, PRICE_RATIOS).hit || matchRatio(combined, PRICE_RATIOS).hit;
    out.push(
      guideline(
        "impulse.wave5-target",
        "Wave 5 lands on a standard projection",
        hit,
        `Wave 5 = ${formatRatio(equality)} of wave 1, ${formatRatio(combined)} of (1 + 3).`
      )
    );

    const truncated = dir > 0 ? legs[4].to.price <= legs[2].to.price : legs[4].to.price >= legs[2].to.price;
    if (truncated) {
      out.push({
        id: "impulse.truncation",
        title: "Truncated fifth",
        severity: variant === "truncatedFifth" ? "info" : "guideline",
        status: variant === "truncatedFifth" ? "pass" : "warn",
        detail: `Wave 5 (${fmt(legs[4].to.price)}) failed to exceed the end of wave 3 (${fmt(legs[2].to.price)}). Truncation signals exhaustion and a fast retracement — or a mislabelled count.`,
      });
    }
  }

  // Diagonals must actually wedge.
  if (diagonal && legs.length >= 5) {
    const contracting = legs[2].length < legs[0].length && legs[4].length < legs[2].length;
    out.push(
      guideline(
        "impulse.diagonal-contraction",
        "Diagonal contracts (3 < 1, 5 < 3)",
        contracting,
        contracting
          ? `Legs contract: ${fmt(legs[0].length)} → ${fmt(legs[2].length)} → ${fmt(legs[4].length)}.`
          : `Legs do not contract (${fmt(legs[0].length)} → ${fmt(legs[2].length)} → ${fmt(legs[4].length)}). An expanding diagonal is rare — verify before relying on it.`
      )
    );
  }

  return out;
}

// ------------------------------------------------------------ correction ---

function correctionRules(drawing: Drawing, metrics: DrawingMetrics): RuleResult[] {
  const { legs } = metrics;
  const out: RuleResult[] = [];
  const variant = drawing.variant ?? "zigzag";
  if (legs.length < 2) return out;

  const dirA = legs[0].direction;
  const shapeOk = legs[1].direction === -dirA && (legs.length < 3 || legs[2].direction === dirA);
  out.push({
    id: "abc.shape",
    title: "A and C run together, B runs against",
    severity: "rule",
    status: shapeOk ? "pass" : "fail",
    detail: shapeOk
      ? "Leg directions are consistent with a three-wave correction."
      : "B does not oppose A, or C does not resume A's direction. This is not an ABC.",
  });

  const retraceB = legs[1].length / legs[0].length;

  if (variant === "zigzag") {
    out.push({
      id: "abc.zigzag-b",
      title: "Wave B holds inside wave A",
      severity: "rule",
      status: retraceB < 1 ? "pass" : "fail",
      detail:
        retraceB < 1
          ? `B retraced ${formatPct(retraceB)} of A.`
          : `B retraced ${formatPct(retraceB)} of A and passed A's origin. That makes this a flat or a triangle, not a zigzag.`,
    });
    out.push(
      guideline(
        "abc.zigzag-b-depth",
        "Wave B is a typical zigzag depth (0.382–0.786)",
        retraceB >= 0.35 && retraceB <= 0.8,
        `B retraced ${formatPct(retraceB)} of A.`
      )
    );
  }

  if (variant === "flat" || variant === "expandedFlat" || variant === "runningFlat") {
    out.push(
      guideline(
        "abc.flat-b",
        "Wave B retraces at least 90% of wave A",
        retraceB >= 0.9,
        `B retraced ${formatPct(retraceB)} of A. Below 90% the structure reads as a zigzag rather than a flat.`
      )
    );
  }

  if (legs.length >= 3) {
    const ratioCA = legs[2].length / legs[0].length;
    const beyondA = dirA > 0 ? legs[2].to.price > legs[0].to.price : legs[2].to.price < legs[0].to.price;

    if (variant === "expandedFlat") {
      out.push({
        id: "abc.expanded-c",
        title: "Wave C exceeds the end of wave A",
        severity: "guideline",
        status: beyondA ? "pass" : "warn",
        detail: beyondA
          ? `C ran past A's extreme; C = ${formatRatio(ratioCA)} of A (1.618 is the common target).`
          : `C stopped short of A's extreme — that is a running flat, not an expanded one.`,
      });
    } else if (variant === "runningFlat") {
      out.push({
        id: "abc.running-c",
        title: "Wave C falls short of wave A",
        severity: "guideline",
        status: beyondA ? "warn" : "pass",
        detail: beyondA
          ? "C exceeded A's extreme, so this is an expanded flat rather than a running one."
          : `C = ${formatRatio(ratioCA)} of A and held above A's extreme — a strong-trend signature.`,
      });
    }

    const match = matchRatio(ratioCA, PRICE_RATIOS);
    out.push(
      guideline(
        "abc.c-target",
        "Wave C lands on a Fibonacci multiple of wave A",
        match.hit,
        `C = ${formatRatio(ratioCA)} of A${match.hit ? ` (${match.label})` : " — no standard relationship"}.`
      )
    );

    if (legs[0].bars > 0) {
      const timeCA = legs[2].bars / legs[0].bars;
      out.push(
        guideline(
          "abc.c-time",
          "Wave C duration relates to wave A",
          matchRatio(timeCA, [0.618, 1, 1.618, 2.618]).hit,
          `C ran ${legs[2].bars} bars against A's ${legs[0].bars} (${formatRatio(timeCA)}).`
        )
      );
    }
  }

  return out;
}

// -------------------------------------------------------------- triangle ---

function triangleRules(drawing: Drawing, metrics: DrawingMetrics): RuleResult[] {
  const { legs } = metrics;
  const out: RuleResult[] = [];
  const variant = drawing.variant ?? "contracting";
  if (legs.length < 2) return out;

  const dirA = legs[0].direction;
  const alternates = legs.every((leg, i) => leg.direction === (i % 2 === 0 ? dirA : -dirA));
  out.push({
    id: "triangle.alternating",
    title: "All five legs alternate direction",
    severity: "rule",
    status: alternates ? "pass" : "fail",
    detail: alternates
      ? "A, C and E run one way; B and D run against."
      : "Two adjacent legs run the same way — a triangle cannot do that.",
  });

  if (legs.length >= 5) {
    const [a, b, c, d, e] = legs;
    if (variant === "contracting" || variant === "barrier") {
      const contracting = c.length < a.length && d.length < b.length && e.length < c.length;
      out.push({
        id: "triangle.contraction",
        title: "Legs contract (C < A, D < B, E < C)",
        severity: "guideline",
        status: contracting ? "pass" : "warn",
        detail: contracting
          ? `A ${fmt(a.length)} → C ${fmt(c.length)} → E ${fmt(e.length)}, B ${fmt(b.length)} → D ${fmt(d.length)}.`
          : `Legs do not contract cleanly (A ${fmt(a.length)}, C ${fmt(c.length)}, E ${fmt(e.length)}). Check whether this is an expanding triangle or a different pattern.`,
      });

      // In a contracting triangle E must not exceed C — otherwise the boundary
      // line is broken and the pattern is something else.
      const eBeyondC = dirA > 0 ? e.to.price > c.to.price : e.to.price < c.to.price;
      out.push({
        id: "triangle.e-within-c",
        title: "Wave E stays inside wave C",
        severity: "rule",
        status: eBeyondC ? "fail" : "pass",
        detail: eBeyondC
          ? `E (${fmt(e.to.price)}) ran past C (${fmt(c.to.price)}), breaking the boundary line.`
          : `E terminated at ${fmt(e.to.price)}, inside C's ${fmt(c.to.price)}.`,
      });
    }

    if (variant === "expanding") {
      const expanding = c.length > a.length && d.length > b.length && e.length > c.length;
      out.push(
        guideline(
          "triangle.expansion",
          "Legs expand (C > A, D > B, E > C)",
          expanding,
          `A ${fmt(a.length)} → C ${fmt(c.length)} → E ${fmt(e.length)}.`
        )
      );
    }

    if (variant === "barrier") {
      const flatSide = Math.abs(b.to.price - d.to.price) / Math.max(1e-9, metrics.totalRange);
      out.push(
        guideline(
          "triangle.barrier",
          "B and D terminate at the same level",
          flatSide <= 0.08,
          `B ended at ${fmt(b.to.price)} and D at ${fmt(d.to.price)} — ${formatPct(flatSide)} of the pattern's range apart.`
        )
      );
    }
  }

  // SOP: at least two legs must share a 0.618 / 1.618 relationship, A:C most often.
  const legRatios = metrics.ratios.filter((ratio) => ratio.kind === "price");
  const keyHits = legRatios.filter(
    (ratio) => ratio.match.hit && [0.618, 1.618].includes(ratio.match.target ?? 0)
  );
  out.push(
    guideline(
      "triangle.leg-ratio",
      "At least two legs share a 0.618 / 1.618 ratio",
      keyHits.length >= 1,
      keyHits.length >= 1
        ? keyHits.map((hit) => `${hit.label} = ${formatRatio(hit.value)}`).join("; ")
        : "No leg pair lands on 0.618 or 1.618. Triangles are usually tidy — re-check the pivots."
    )
  );

  // Lucas 29% internal relationship: (A + C bars) ÷ total bars ≈ 0.289.
  if (legs.length >= 5 && metrics.totalBars > 0) {
    const share = (legs[0].bars + legs[2].bars) / metrics.totalBars;
    out.push(
      guideline(
        "triangle.lucas-29",
        "A + C occupy ~29% of the triangle's bars",
        Math.abs(share - 0.289) <= 0.06,
        `A + C = ${legs[0].bars + legs[2].bars} of ${metrics.totalBars} bars (${formatPct(share)}).`
      )
    );
  }

  return out;
}

// ------------------------------------------------------- WXY / WXYXZ ---

function comboRules(drawing: Drawing, metrics: DrawingMetrics): RuleResult[] {
  const { legs } = metrics;
  const out: RuleResult[] = [];
  if (legs.length < 2) return out;

  const dirW = legs[0].direction;
  const alternates = legs.every((leg, i) => leg.direction === (i % 2 === 0 ? dirW : -dirW));
  out.push({
    id: "combo.alternating",
    title: "Corrective legs alternate with their X connectors",
    severity: "rule",
    status: alternates ? "pass" : "fail",
    detail: alternates
      ? "W, Y (and Z) run with the correction; each X runs against it."
      : "An X wave runs the same way as the structure it connects — re-check the pivots.",
  });

  if (legs.length >= 3) {
    const ratioYW = legs[2].length / legs[0].length;
    out.push(
      guideline(
        "combo.y-equals-w",
        "Wave Y relates to wave W",
        matchRatio(ratioYW, [0.618, 1, 1.272, 1.618]).hit,
        `Y = ${formatRatio(ratioYW)} of W. Equality is the most common outcome in a double zigzag.`
      )
    );

    const retraceX = legs[1].length / legs[0].length;
    out.push(
      guideline(
        "combo.x-depth",
        "Wave X is a partial retracement of W",
        retraceX < 1,
        `X retraced ${formatPct(retraceX)} of W${retraceX >= 1 ? " — beyond W's origin, which makes this a running combination at best" : ""}.`
      )
    );
  }

  if (drawing.tool === "tripleCombo" && legs.length >= 5) {
    const ratioZW = legs[4].length / legs[0].length;
    out.push(
      guideline(
        "combo.z-equals-w",
        "Wave Z relates to wave W",
        matchRatio(ratioZW, [0.618, 1, 1.618]).hit,
        `Z = ${formatRatio(ratioZW)} of W.`
      )
    );
  }

  return out;
}

// ---------------------------------------------------------------- shared ---

function sharedChecks(metrics: DrawingMetrics): RuleResult[] {
  const out: RuleResult[] = [];

  const whole = metrics.timeCounts.find((count) => count.label === "whole pattern");
  if (whole) {
    out.push({
      id: "time.completion",
      title: "Pattern completes on a Fibonacci / Lucas bar",
      severity: "guideline",
      status: whole.match.hit ? "pass" : "warn",
      detail: whole.match.hit
        ? `${whole.bars} bars — ${describeHits(whole.match.hits)}.`
        : `${whole.bars} bars, which is not a key count. Guideline 1: off a significant bar, the trend more often continues.`,
    });
  }

  if (metrics.clusters.length > 0) {
    const best = metrics.clusters.reduce((a, b) => (b.strength > a.strength ? b : a));
    out.push({
      id: "time.cluster",
      title: "Independent time counts cluster",
      severity: "info",
      status: "pass",
      detail: `${metrics.clusters.length} cluster${metrics.clusters.length > 1 ? "s" : ""}; strongest at bar ${best.bars} with ${best.strength} counts (${best.members
        .map((member) => member.label)
        .join(", ")}).`,
    });
  }

  if (metrics.priceNumber) {
    out.push({
      id: "price.number-completion",
      title: "Total range lands on a Fibonacci / Lucas number",
      severity: "info",
      status: "pass",
      detail: `Range ${fmt(metrics.totalRange)} ≈ ${metrics.priceNumber.value} × ${metrics.priceNumber.scale}.`,
    });
  }

  if (metrics.channel) {
    const { channel } = metrics;
    const throwOver = channel.overshoot > 0;
    out.push({
      id: "channel.parallel",
      title: "Terminal pivot against the channel parallel",
      severity: "guideline",
      status: Math.abs(channel.overshoot) <= metrics.totalRange * 0.12 ? "pass" : "warn",
      detail: `Parallel projects ${fmt(channel.projectionAtEnd)}; the pattern ended ${fmt(
        Math.abs(channel.overshoot)
      )} ${throwOver ? "beyond" : "short of"} it.${throwOver ? " A throw-over is a classic fifth-wave ending signal." : ""}`,
    });
  }

  return out;
}

// -------------------------------------------------------------- verdict ---

function summarise(drawing: Drawing, metrics: DrawingMetrics, results: RuleResult[]): Validation {
  const hardFailures = results.filter((r) => r.severity === "rule" && r.status === "fail").length;
  const guidelines = results.filter((r) => r.severity === "guideline");
  const guidelineMisses = guidelines.filter((r) => r.status === "warn").length;
  const score = guidelines.length === 0 ? 0 : Math.round(((guidelines.length - guidelineMisses) / guidelines.length) * 100);

  const priceConfirmed = metrics.ratios.some(
    (ratio) => ratio.kind === "price" && ratio.match.hit && [0.618, 1, 1.618, 2.618].includes(ratio.match.target ?? 0)
  );
  const timeConfirmed = metrics.clusters.length > 0;
  // A *named* series hit only. The master key-bar list is dense below ~60 bars,
  // so "landed on some key bar" there is close to free and would inflate every
  // count to Medium; a Fibonacci or Lucas number is the claim worth making.
  const timeTouch = metrics.timeCounts.some((count) =>
    count.match.hits.some((hit) => hit.series === "fibonacci" || hit.series === "lucas")
  );

  let tier: ConfidenceTier;
  if (hardFailures > 0) tier = "Pass";
  else if (!metrics.complete) tier = "Low";
  else if (priceConfirmed && timeConfirmed) tier = "High";
  else if (priceConfirmed || timeTouch) tier = "Medium";
  else tier = "Low";

  const summary =
    hardFailures > 0
      ? `${hardFailures} hard rule${hardFailures > 1 ? "s" : ""} broken — re-label before trading this count.`
      : tier === "High"
        ? "Pattern, a key Fibonacci price relationship and a time cluster all line up."
        : tier === "Medium"
          ? `Pattern holds with ${priceConfirmed ? "a confirmed price ratio" : "a time-bar touch"} but not both. Size down and wait for confirmation.`
          : metrics.complete
            ? "Structure is legal but nothing confirms it yet. Watch the upcoming time bars."
            : "Count is unfinished — place the remaining pivots to validate it.";

  return {
    drawingId: drawing.id,
    results,
    hardFailures,
    guidelineMisses,
    score,
    tier,
    summary,
    invalidation: invalidationFor(drawing, metrics),
  };
}

/**
 * The price that kills the count. For an impulse it is the start of wave 1
 * (wave 2 may not breach it) or, once wave 3 is under way, the end of wave 1
 * that wave 4 may not enter.
 */
function invalidationFor(drawing: Drawing, metrics: DrawingMetrics): Validation["invalidation"] {
  const { legs } = metrics;
  if (legs.length === 0) return null;

  if (drawing.tool === "impulse") {
    const diagonal = drawing.variant === "leadingDiagonal" || drawing.variant === "endingDiagonal";
    if (legs.length >= 3 && !diagonal) {
      return {
        price: legs[0].to.price,
        reason: "End of wave 1 — wave 4 entering this level invalidates the impulse.",
      };
    }
    return {
      price: metrics.startPrice,
      reason: "Start of wave 1 — wave 2 may not trade beyond it.",
    };
  }

  if (drawing.tool === "correction" && drawing.variant === "zigzag" && legs.length >= 1) {
    return { price: metrics.startPrice, reason: "Origin of wave A — wave B may not pass it in a zigzag." };
  }

  if (drawing.tool === "triangle" && legs.length >= 3) {
    return { price: legs[2].to.price, reason: "End of wave C — wave E may not exceed it in a contracting triangle." };
  }

  return null;
}

// ---------------------------------------------------------------- helpers ---

function guideline(id: string, title: string, ok: boolean, detail: string): RuleResult {
  return { id, title, severity: "guideline", status: ok ? "pass" : "warn", detail };
}

function describeHits(hits: { series: string; value: number; delta: number }[]): string {
  return hits
    .map((hit) => `${hit.series === "lucas" ? "Lucas" : hit.series === "fibonacci" ? "Fibonacci" : "key bar"} ${hit.value}${hit.delta === 0 ? "" : ` (${hit.delta > 0 ? "+" : ""}${hit.delta})`}`)
    .join(", ");
}

function fmt(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
