/**
 * Sample completed trades for the demo journal.
 *
 * The workspace is more useful on first open if the journal, the win rate and
 * the daily-loss gauge already have something in them. These are built the same
 * way a real trade is — gross from the fills, charges from the same cost model
 * the engine uses — so the arithmetic in the drawer adds up rather than being
 * plausible-looking noise.
 *
 * Mock feeds only. A live adapter must never be handed fabricated history.
 */

import type { CostModel } from "../config";
import { computeCharges } from "../engine/charges";
import { emptyPortfolio, type PortfolioState } from "../engine/portfolio";
import type { ExitReason, JournalTrade, OptionContract, Underlying } from "../types";

interface Template {
  /** Strike offset from ATM, in strike steps. */
  offset: number;
  optionType: "CE" | "PE";
  direction: "LONG" | "SHORT";
  lots: number;
  entryPrice: number;
  exitPrice: number;
  /** Minutes before "now" the trade was entered. */
  minutesAgo: number;
  holdSeconds: number;
  exitReason: ExitReason;
}

/** Six trades: four winners, two losers, one of them short. */
const TEMPLATES: Template[] = [
  { offset: 0, optionType: "CE", direction: "LONG", lots: 1, entryPrice: 128.4, exitPrice: 149.2, minutesAgo: 96, holdSeconds: 214, exitReason: "TARGET" },
  { offset: 1, optionType: "PE", direction: "LONG", lots: 2, entryPrice: 96.75, exitPrice: 82.3, minutesAgo: 78, holdSeconds: 141, exitReason: "STOP_LOSS" },
  { offset: 1, optionType: "CE", direction: "LONG", lots: 1, entryPrice: 74.1, exitPrice: 88.65, minutesAgo: 61, holdSeconds: 328, exitReason: "MANUAL" },
  { offset: -1, optionType: "CE", direction: "SHORT", lots: 1, entryPrice: 163.5, exitPrice: 151.25, minutesAgo: 44, holdSeconds: 402, exitReason: "MANUAL" },
  { offset: 0, optionType: "CE", direction: "LONG", lots: 1, entryPrice: 141.05, exitPrice: 133.5, minutesAgo: 27, holdSeconds: 96, exitReason: "MANUAL" },
  { offset: -1, optionType: "PE", direction: "LONG", lots: 1, entryPrice: 118.2, exitPrice: 140.9, minutesAgo: 12, holdSeconds: 268, exitReason: "TARGET" },
];

export interface SeedInput {
  underlying: Underlying;
  expiry: string;
  atmStrike: number;
  strikeStep: number;
  lotSize: number;
  /** The adapter clock, so the entries land inside the simulated session. */
  now: number;
  /** 09:15 of the current session — nothing may be timestamped before it. */
  sessionOpenMs: number;
  costs: CostModel;
  /** Builds the contract descriptor, so symbols match the live pad exactly. */
  contractFor: (strike: number, optionType: "CE" | "PE") => OptionContract;
}

export function seedPortfolio(input: SeedInput): PortfolioState {
  const journal: JournalTrade[] = [];
  let realized = 0;
  let gross = 0;
  let charges = 0;

  // Compress the templates into whatever session time has actually elapsed, so
  // no seeded trade is ever stamped before the opening bell. Normally the
  // window is wider than the templates need and this is a no-op.
  const available = Math.max(60_000, input.now - (input.sessionOpenMs + 2 * 60_000));
  const span = Math.max(...TEMPLATES.map((t) => t.minutesAgo)) * 60_000;
  const scale = Math.min(1, available / span);

  TEMPLATES.forEach((template, index) => {
    const strike = input.atmStrike + template.offset * input.strikeStep;
    const contract = input.contractFor(strike, template.optionType);
    const quantity = template.lots * input.lotSize;

    const long = template.direction === "LONG";
    const entrySide = long ? "BUY" : "SELL";
    const exitSide = long ? "SELL" : "BUY";

    const tradeGross = long
      ? (template.exitPrice - template.entryPrice) * quantity
      : (template.entryPrice - template.exitPrice) * quantity;

    const tradeCharges =
      computeCharges(entrySide, template.entryPrice, quantity, input.costs).total +
      computeCharges(exitSide, template.exitPrice, quantity, input.costs).total;

    const net = tradeGross - tradeCharges;
    const entryTs = Math.round(input.now - template.minutesAgo * 60_000 * scale);
    const holdMs = Math.max(20_000, Math.round(template.holdSeconds * 1000 * scale));

    journal.push({
      id: `seed-${index}`,
      entryTs,
      exitTs: entryTs + holdMs,
      contract,
      direction: template.direction,
      quantity,
      entryPrice: template.entryPrice,
      exitPrice: template.exitPrice,
      // Reconstruct the levels the trade would have carried, so the drawer's
      // SL and target columns are not blank on the seeded rows.
      stopLoss: round2(long ? template.entryPrice * 0.75 : template.entryPrice * 1.25),
      target: round2(long ? template.entryPrice * 1.4 : template.entryPrice * 0.6),
      charges: round2(tradeCharges),
      grossPnl: round2(tradeGross),
      netPnl: round2(net),
      durationMs: holdMs,
      exitReason: template.exitReason,
    });

    realized += net;
    gross += tradeGross;
    charges += tradeCharges;
  });

  return {
    ...emptyPortfolio(),
    journal,
    realizedPnl: round2(realized),
    grossRealizedPnl: round2(gross),
    totalCharges: round2(charges),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
