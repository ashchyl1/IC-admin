/**
 * Turning open positions into the price lines a chart draws.
 *
 * Separate from `paper.ts` so the engine stays free of presentation, and from
 * the chart so the colours are stated once rather than inline in an effect.
 */

import type { PaperPosition } from "./paper";

export interface PositionLevels {
  id: string;
  levels: { price: number; title: string; color: string; kind: "entry" | "stop" | "target" }[];
}

const ENTRY = "rgba(56,189,248,0.9)";
const STOP = "rgba(248,113,113,0.9)";
const TARGET = "rgba(52,211,153,0.9)";

export function levelsForPositions(positions: PaperPosition[], symbol: string): PositionLevels[] {
  return positions
    .filter((position) => position.status === "OPEN" && position.symbol === symbol)
    .map((position) => {
      const tag = `${position.side} ${position.quantity}`;
      const levels: PositionLevels["levels"] = [
        { price: position.entryPrice, title: tag, color: ENTRY, kind: "entry" },
      ];
      if (position.stopLoss !== null) {
        levels.push({ price: position.stopLoss, title: "SL", color: STOP, kind: "stop" });
      }
      if (position.target !== null) {
        levels.push({ price: position.target, title: "TGT", color: TARGET, kind: "target" });
      }
      return { id: position.id, levels };
    });
}
