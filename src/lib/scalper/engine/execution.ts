/**
 * Fill simulation.
 *
 * The reference price is always the **mid**, not the touch. That makes
 * "slippage" mean what a trader means by it — everything you gave up versus
 * fair value — instead of hiding half the spread inside the fill and reporting
 * a flatteringly small number.
 *
 *   edge      = halfSpread × (1 + slippageSpreadFraction) + slippageTicks
 *   BUY fill  = mid + edge
 *   SELL fill = mid − edge
 *
 * Slippage therefore always works against you, on both sides, exactly as it
 * does when you cross a real book with a market order.
 */

import type { ExecutionSettings } from "../config";
import type { Quote, Side } from "../types";

export interface FillMath {
  referencePrice: number;
  fillPrice: number;
  /** Always positive: rupees per unit given up versus the mid. */
  slippage: number;
  spread: number;
  spreadPct: number;
}

export function simulateFill(side: Side, quote: Quote, execution: ExecutionSettings): FillMath {
  const bid = Math.max(execution.tickSize, quote.bid);
  const ask = Math.max(bid + execution.tickSize, quote.ask);

  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const halfSpread = spread / 2;

  const edge = halfSpread * (1 + execution.slippageSpreadFraction) + execution.slippageTicks;
  const raw = side === "BUY" ? mid + edge : mid - edge;
  const fillPrice = Math.max(execution.tickSize, roundToTick(raw, execution.tickSize));

  return {
    referencePrice: roundToTick(mid, execution.tickSize),
    fillPrice,
    slippage: Math.abs(fillPrice - mid),
    spread,
    spreadPct: mid > 0 ? (spread / mid) * 100 : 0,
  };
}

export function roundToTick(value: number, tickSize: number): number {
  const ticks = Math.round(value / tickSize);
  return Math.round(ticks * tickSize * 100) / 100;
}

/** The price a held position should be marked at — what you could exit into. */
export function markPrice(quote: Quote, signedQuantity: number): number {
  if (signedQuantity > 0) return quote.bid; // a long exits by selling into the bid
  if (signedQuantity < 0) return quote.ask; // a short exits by buying at the ask
  return quote.ltp;
}
