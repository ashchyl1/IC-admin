/**
 * The Indiacharts Nifty recommendation timeline, transcribed from
 * "Indiacharts_Nifty_Recommendation_Timeline.docx".
 *
 * Every string here is the document's own wording -- the file was parsed out of
 * the .docx rather than retyped, so the panel shows what was published, not a
 * paraphrase of it. Fifteen entries: fourteen Sunday updates plus the 12 May
 * mid-week contingency note, which is why {@link Recommendation.midWeek} exists.
 *
 * A recommendation governs every trading day from its publication date until the
 * next one supersedes it; {@link recommendationForDate} is the only place that
 * rule is encoded.
 */

/** Coarse direction, derived from the document's free-text Trend label. */
export type Direction = "Up" | "Down" | "DownThenUp" | "Neutral";

export interface Recommendation {
  /** Publication date (yyyy-mm-dd). Sundays, except the 12 May mid-week note. */
  date: string;
  /** The Heading 2 label, e.g. "Down then Up". */
  headline: string;
  /** Narrative phase the document files this entry under. */
  phase: string;
  /** True only for 12 May, which is a contingency note, not a weekly update. */
  midWeek: boolean;
  /** Trend exactly as published -- free text, not one of three values. */
  trend: string;
  direction: Direction;
  /** Target and Reversal as printed, including ranges such as "23,392-23,100". */
  target: string;
  reversal: string;
  publishedView: string;
  explanatoryNote: string;
  reason: string;
  confirmation: string;
  /** Present only where the document carried an intermarket paragraph. */
  bankNifty: string;
  /** The one-line summary from the capstone table; empty for the mid-week note. */
  primaryReason: string;
}

/** Ascending by date, which {@link recommendationForDate} relies on. */
export const RECOMMENDATIONS: Recommendation[] = [
  {
    date: "2026-05-03",
    headline: "Down then Up",
    phase: "Phase 1 - Wave 2 stress and downside risk",
    midWeek: false,
    trend: "Down then Up",
    direction: "DownThenUp",
    target: "24,854",
    reversal: "23,100",
    publishedView: "Trend Down then Up | Target 24,854 | Reversal 23,100",
    explanatoryNote: "Wave 2 is a pullback or retracement of wave 1.",
    reason: "Rotation was strong, but Nifty failed to confirm the fifth consecutive weekly " +
              "high in Smallcaps. That bearish intermarket divergence supported an a-b-c " +
              "pullback, potentially toward 23,500, before the larger wave 3 advance. The " +
              "report still highlighted daily stock breakouts, so the cautious index view did " +
              "not cancel selective stock strength.",
    confirmation: "A move above the prior 24,602 high would remove the divergence. Until " +
                    "then, 23,100 was the invalidation/reference level for the preferred " +
                    "wave-2 interpretation.",
    bankNifty: "",
    primaryReason: "Wave 2 pullback remained preferred. Nifty lagged Midcap and Smallcap " +
                     "new highs, creating bearish non-confirmation, although stock-level " +
                     "breakouts kept the larger bullish thesis intact.",
  },
  {
    date: "2026-05-10",
    headline: "Down then Up",
    phase: "Phase 1 - Wave 2 stress and downside risk",
    midWeek: false,
    trend: "Down then Up",
    direction: "DownThenUp",
    target: "24,640",
    reversal: "23,392-23,100",
    publishedView: "Trend Down then Up | Target 24,640 | Reversal 23,392-23,100",
    explanatoryNote: "",
    reason: "Midcap and Smallcap indices were still making highs that Nifty had not " +
              "confirmed. The report therefore retained the pullback-first path and widened " +
              "the downside reference to the 50% and 61.8% retracement levels at 23,392 and " +
              "23,100.",
    confirmation: "The bearish divergence would be cancelled above 24,602. A break of " +
                    "23,100 would also make the deeper alternate count materially relevant.",
    bankNifty: "",
    primaryReason: "The divergence remained valid unless Nifty cleared 24,602. A deeper " +
                     "second-wave retracement made the 50%-61.8% zone at 23,392-23,100 live " +
                     "support.",
  },
  {
    date: "2026-05-12",
    headline: "Preferred 1-2 count retained; alternate W-X-Y-X-Z recorded",
    phase: "Phase 1 - Wave 2 stress and downside risk",
    midWeek: true,
    trend: "Preferred 1-2 count retained; alternate W-X-Y-X-Z recorded",
    direction: "Neutral",
    target: "No new weekly target",
    reversal: "23,100 trigger",
    publishedView: "Trend Preferred 1-2 count retained; alternate W-X-Y-X-Z recorded | " +
                     "Target No new weekly target | Reversal 23,100 trigger",
    explanatoryNote: "Wave 2 or Z: above 23,100 they implied the same immediate path; below " +
                       "it they differed materially.",
    reason: "The weekly declines could be read as a complex W-X-Y-X-Z correction with wave " +
              "C of Z still falling. The analyst did not prefer this count, but publishing it " +
              "in advance prevented an emotional recount during a free fall.",
    confirmation: "Above 23,100, no immediate action changed. A break below 23,100 opened " +
                    "the possibility of breaking the April low and producing maximum panic " +
                    "before the larger recovery.",
    bankNifty: "",
    primaryReason: "",
  },
  {
    date: "2026-05-17",
    headline: "Down",
    phase: "Phase 1 - Wave 2 stress and downside risk",
    midWeek: false,
    trend: "Down",
    direction: "Down",
    target: "23,100-22,650",
    reversal: "24,200",
    publishedView: "Trend Down | Target 23,100-22,650 | Reversal 24,200",
    explanatoryNote: "Wave 2 is a pullback or retracement of wave 1.",
    reason: "The market was described as being in the eye of the storm. The daily c=a " +
              "projection pointed to 22,650, and the alternate wave Z count allowed a break " +
              "of 22,183 toward the 2024 election low near 21,280. Although weekly RMI had " +
              "issued a buy, the bounce failed at the 20/40-week averages near 24,680, so " +
              "momentum confirmation was absent.",
    confirmation: "A recovery through the failed-bounce structure would invalidate the " +
                    "tactical Down reading. A break below 22,183 would promote wave Z from " +
                    "alternate to operative count.",
    bankNifty: "",
    primaryReason: "Free fall and a failed bounce at the weekly averages suggested the " +
                     "downcycle was incomplete. c=a pointed to 22,650, while the wave Z " +
                     "alternate allowed a still deeper panic.",
  },
  {
    date: "2026-05-24",
    headline: "Up",
    phase: "Phase 2 - Reversal, recount and confirmation",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "24,387",
    reversal: "23,263",
    publishedView: "Trend Up | Target 24,387 | Reversal 23,263",
    explanatoryNote: "Wave 2 is mostly complete, and Wave 3 started and is in early stages.",
    reason: "A positive weekly close was treated as confirmation that wave c of 2 had " +
              "ended. RMI was already bullish, wave 2 had retraced a little more than 50%, " +
              "and the unfilled breakaway gap supported the view that the prior advance was " +
              "impulsive rather than merely a bear-market rally.",
    confirmation: "The first test was the 20-week average at 24,387. A close above it would " +
                    "keep the 3=1 projection near 25,800 in play. The gap was supporting " +
                    "evidence, not a hard rule.",
    bankNifty: "",
    primaryReason: "A positive weekly close confirmed wave c of 2 had ended. RMI was " +
                     "bullish, the 20-week average became the next test, and the larger wave " +
                     "3 projection remained near 25,800.",
  },
  {
    date: "2026-05-31",
    headline: "Up",
    phase: "Phase 2 - Reversal, recount and confirmation",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "24,281",
    reversal: "23,263",
    publishedView: "Trend Up | Target 24,281 | Reversal 23,263",
    explanatoryNote: "Wave 2 is not complete, and Wave 3 will start soon.",
    reason: "The rebound unfolded in three waves and the week closed negative, " +
              "contradicting the prior declaration that wave 2 was complete. The correction " +
              "was therefore re-marked as overlapping w-x-y-x-z. If z=y, 23,368 was a " +
              "candidate; a lower triangle-line break would favour wave z over an expanding " +
              "triangle.",
    confirmation: "The internal path changed, not the larger direction. Both structures " +
                    "still ended wave 2 and led into wave 3, preserving the broader " +
                    "projection around 25,800.",
    bankNifty: "",
    primaryReason: "A three-wave bounce followed by a negative weekly close forced a " +
                     "recount to a complex w-x-y-x-z correction. The Up view stayed because " +
                     "the correction's degree and eventual wave 3 destination were unchanged.",
  },
  {
    date: "2026-06-07",
    headline: "Up",
    phase: "Phase 2 - Reversal, recount and confirmation",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "24,164",
    reversal: "23,264-23,077",
    publishedView: "Trend Up | Target 24,164 | Reversal 23,264-23,077",
    explanatoryNote: "Wave 2 is not complete, and Wave 3 will start soon.",
    reason: "Wave 2 had continued for longer than expected, with each internal segment " +
              "lasting only one or two weeks. Wave z had already lasted two weeks, and the " +
              "expected Monday gap down was viewed as a likely final test of the 61.8% " +
              "retracement at 23,077.",
    confirmation: "Holding 23,077 and then recovering through nearby trend resistance would " +
                    "support completion of wave 2. A decisive break would require another " +
                    "recount.",
    bankNifty: "Bank Nifty had not made a lower June low while Nifty had, creating bullish " +
                 "non-confirmation. It had retraced close to 61.8%, closed positive for three " +
                 "weeks, regained a weekly RMI buy and showed contracting Bollinger bands - " +
                 "behaviour unlike a high-volatility bear market.",
    primaryReason: "Wave z still looked unfinished and 23,077 was expected to be the final " +
                     "61.8% test. Bank Nifty's relative strength, bullish RMI and tighter " +
                     "bands supplied bullish intermarket evidence.",
  },
  {
    date: "2026-06-14",
    headline: "Up",
    phase: "Phase 2 - Reversal, recount and confirmation",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "24,093-24,400",
    reversal: "23,072",
    publishedView: "Trend Up | Target 24,093-24,400 | Reversal 23,072",
    explanatoryNote: "Wave 2 is not complete, and Wave 3 will start soon.",
    reason: "The genuinely new evidence was multi-timeframe momentum alignment: daily RMI " +
              "turned bullish while weekly RMI was already bullish. Price also closed above " +
              "the 20-day average, leading the analyst to state that wave 3 had begun in his " +
              "opinion.",
    confirmation: "The 40-day EMA near 23,682 was the nearest momentum check; 23,700 was " +
                    "the falling trendline break; 24,093 was the 20-week average and the " +
                    "stronger medium-term confirmation. Wave 3 ultimately had to exceed " +
                    "24,602.",
    bankNifty: "",
    primaryReason: "Daily and weekly RMI aligned bullish. The close above the 20-day " +
                     "average and prospective breaks of 23,700 and 24,093 supplied the " +
                     "missing confirmation that wave 3 was beginning.",
  },
  {
    date: "2026-06-21",
    headline: "Up",
    phase: "Phase 3 - Wave 3 advance and momentum tests",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "24,385-24,602",
    reversal: "23,072",
    publishedView: "Trend Up | Target 24,385-24,602 | Reversal 23,072",
    explanatoryNote: "",
    reason: "Nifty printed a weekly doji below the 20-week average. The candle was " +
              "interpreted as a pause rather than a reversal, leaving the wave 3 view intact.",
    confirmation: "A move above the week's 24,189 high would convert the doji into " +
                    "confirmation of continuation, initially toward about 25,050; the wave " +
                    "count still required an eventual move above 24,602.",
    bankNifty: "Bank Nifty printed a stronger doji star. Its equivalent trigger was 58,021, " +
                 "above which the report projected roughly 60,825.",
    primaryReason: "A weekly doji signalled a pause, not a reversal. A move above 24,189 " +
                     "would confirm continuation, with wave 3 still required to exceed the " +
                     "prior 24,602 high.",
  },
  {
    date: "2026-06-28",
    headline: "Up",
    phase: "Phase 3 - Wave 3 advance and momentum tests",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "25,000",
    reversal: "23,600",
    publishedView: "Trend Up | Target 25,000 | Reversal 23,600",
    explanatoryNote: "Wave 3 has started and is subdividing.",
    reason: "A second weekly doji showed continuing indecision. Nifty nevertheless closed " +
              "above the 20-week average, although the report noted that the average had " +
              "fallen toward price. Weekly RMI remained bullish and below zero, so the " +
              "momentum cycle was considered incomplete and still capable of carrying the " +
              "market higher first.",
    confirmation: "The doji itself was not directional; price had to break its range. With " +
                    "RMI still below zero, the bullish cycle argument remained active but " +
                    "would weaken once the cycle matured.",
    bankNifty: "",
    primaryReason: "A second doji preserved indecision, but the close above the 20-week " +
                     "average and a bullish RMI below zero suggested the momentum cycle still " +
                     "had room to rise before correcting.",
  },
  {
    date: "2026-07-05",
    headline: "Up",
    phase: "Phase 3 - Wave 3 advance and momentum tests",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "25,268",
    reversal: "23,600",
    publishedView: "Trend Up | Target 25,268 | Reversal 23,600",
    explanatoryNote: "Wave 3 has started and is subdividing.",
    reason: "The market closed above the previous week's high, resolving the two-week " +
              "indecision in favour of continuation. Minor wave iii was projected near " +
              "24,983. Daily RMI had whipsawed from sell back to buy, so Dow Theory, the " +
              "20-day average and wave structure were given more weight than the indicator " +
              "alone.",
    confirmation: "The Up view remained valid while the confluence of the higher low at " +
                    "23,829 and the 20-day average near 23,805 held. Above 24,364, the path " +
                    "toward 25,268 remained open.",
    bankNifty: "",
    primaryReason: "The close above the prior week's high resolved indecision upward. After " +
                     "an RMI whipsaw, the view relied more on wave structure, Dow Theory, " +
                     "moving averages and support at 23,805-23,829.",
  },
  {
    date: "2026-07-12",
    headline: "Down then Up",
    phase: "Phase 4 - Wave 2 of 3 and portfolio caution",
    midWeek: false,
    trend: "Down then Up",
    direction: "DownThenUp",
    target: "24,356-24,977",
    reversal: "23,380",
    publishedView: "Trend Down then Up | Target 24,356-24,977 | Reversal 23,380",
    explanatoryNote: "Wave 3 has started and is subdividing.",
    reason: "Nifty failed at the 40-week EMA near 24,356, closed down for the week and " +
              "broke the 20-day average. The preferred interpretation was wave 2 of 3, with " +
              "support near 23,800, the gap at 23,645 and the lower trendline near 23,406. " +
              "The alternative treated the recent top as wave X and allowed a 78.6% " +
              "retracement toward 23,380.",
    confirmation: "The market was now inside a 23,400-24,600 range, implying less " +
                    "directional edge and smaller trade exposure. The wave-2 count was " +
                    "preferred because it aligned with Bank Nifty and Midcap structure; wave " +
                    "3 of 3 remained the larger expectation.",
    bankNifty: "",
    primaryReason: "Failure at the 40-week EMA and the break below the 20-day average " +
                     "started wave 2 of 3. Supports at 23,800, 23,645 and 23,406 defined a " +
                     "23,400-24,600 range; the larger wave 3 of 3 remained expected.",
  },
  {
    date: "2026-07-19",
    headline: "Down then Up",
    phase: "Phase 4 - Wave 2 of 3 and portfolio caution",
    midWeek: false,
    trend: "Down then Up",
    direction: "DownThenUp",
    target: "24,356-24,977",
    reversal: "23,380",
    publishedView: "Trend Down then Up | Target 24,356-24,977 | Reversal 23,380",
    explanatoryNote: "Wave 2 of 3 is consuming more time.",
    reason: "Friday's close above 24,300 raised the possibility that wave 2 had ended, but " +
              "the RMI was still on sell without having reset below zero, while the " +
              "call-put/sentiment histogram was flashing red. The evidence was therefore " +
              "promising but unresolved.",
    confirmation: "The report explicitly chose observation over prediction: wait a few days " +
                    "to see whether price sold off again or consolidated at higher levels.",
    bankNifty: "",
    primaryReason: "A close above 24,300 hinted that wave 2 might be over, but an RMI sell " +
                     "condition and a red sentiment histogram withheld confirmation. The " +
                     "instruction was to watch for a sell-off or higher consolidation.",
  },
  {
    date: "2026-07-26",
    headline: "Neutral",
    phase: "Phase 4 - Wave 2 of 3 and portfolio caution",
    midWeek: false,
    trend: "Neutral",
    direction: "Neutral",
    target: "24,356-24,977",
    reversal: "23,380",
    publishedView: "Trend Neutral | Target 24,356-24,977 | Reversal 23,380",
    explanatoryNote: "Wave 2 of 3 is consuming more time.",
    reason: "Several independent supports clustered near the market: the 61.8% retracement " +
              "at 23,600, the 20-week average at 23,741 and the rising trendline from the " +
              "bottom. These made a bottom plausible. However, a broken head-and-shoulders " +
              "pattern still targeted about 23,500, weekly and daily RMI conflicted, and " +
              "directional volume was absent.",
    confirmation: "Neutral acknowledged a likely bottom without claiming it was complete. " +
                    "Holding 23,600 and regaining 23,827 would strengthen the bullish case; " +
                    "breaking 23,600 could extend the retracement without necessarily " +
                    "reversing the larger uptrend.",
    bankNifty: "",
    primaryReason: "The 61.8% retracement, 20-week average and rising trendline clustered " +
                     "near 23,600-23,741, but a bearish H&S pattern and conflicting RMIs " +
                     "meant a bottom was possible, not confirmed.",
  },
  {
    date: "2026-08-02",
    headline: "Up",
    phase: "Phase 5 - Resolution upward",
    midWeek: false,
    trend: "Up",
    direction: "Up",
    target: "24,515-24,977",
    reversal: "24,329",
    publishedView: "Trend Up | Target 24,515-24,977 | Reversal 24,329",
    explanatoryNote: "Wave 3 of 3 should have started; confirmation above 24,515.",
    reason: "The decline had unfolded in three waves and price then turned up, identifying " +
              "it as corrective within a larger advance. Falling volume during the decline " +
              "and higher volume during the rebound reinforced the bullish interpretation. " +
              "Three independent objectives clustered in the same broad zone: a 3=1 " +
              "projection near 25,000, a triangle objective near 25,800 and a " +
              "parallel-channel objective near 26,000.",
    confirmation: "The triangle breakout above 24,515 was the explicit confirmation. The " +
                    "40-day EMA at 24,329 became the nearest invalidation/support, followed " +
                    "by the 20-week average near 23,800 and the 20-day trailing support near " +
                    "24,131.",
    bankNifty: "Bank Nifty remained an inside-bar laggard, but the Nifty Financial Services " +
                 "index had already broken out. That intermarket leadership was used as " +
                 "evidence that Bank Nifty could follow.",
    primaryReason: "A three-wave decline followed by an advance, improving volume and a " +
                     "triangle breakout setup restored the Up view. Confirmation sat above " +
                     "24,515, with a broader objective cluster at 25,000-26,000.",
  },
];

export const DOC_TITLE = "Nifty Weekly Elliott Wave Update — Recommendation Timeline";
export const DOC_SUBTITLE = "Published medium-term trend views, levels and reasoning";
export const DOC_RANGE = "3 May to 2 August 2026";

export const HOW_TO_READ =
  "Here, \"recommendation\" means the published medium-term Trend and level view. Target is a " +
    "projection from the active wave count; Reversal is the level that invalidates that " +
    "reading, not automatically a personal stop-loss.";

export const DISCLAIMER =
  "Educational use only. This document summarizes the supplied Indiacharts casebook. It is " +
    "not personalised investment advice. Targets, trend labels and invalidation levels are " +
    "historical published views and should not be treated as current trading instructions.";

/** First and last day the document has anything to say about. */
export const COVERAGE_START = RECOMMENDATIONS[0].date;
export const COVERAGE_END = RECOMMENDATIONS[RECOMMENDATIONS.length - 1].date;

/**
 * The recommendation in force on `date`: the most recent one published on or
 * before it. Returns null for days before the timeline opens, which the panel
 * reports rather than silently back-filling with the first entry.
 */
export function recommendationForDate(date: string): Recommendation | null {
  let found: Recommendation | null = null;
  for (const rec of RECOMMENDATIONS) {
    if (rec.date > date) break;
    found = rec;
  }
  return found;
}

/** How many days a bar sits after its recommendation, for the "day N" caption. */
export function daysSince(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
