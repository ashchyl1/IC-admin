/**
 * Transaction costs for NSE index options.
 *
 * Costs are the difference between a scalping strategy that looks profitable in
 * a backtest and one that is profitable. A ₹20 brokerage on each leg of a
 * one-lot NIFTY trade is already ~0.5 points of premium before STT — so the
 * engine charges every fill, and the journal shows the number.
 */

import type { CostModel } from "../config";
import type { ChargeBreakdown, Side } from "../types";

/**
 * @param side       BUY or SELL — STT and stamp duty are one-sided.
 * @param premium    Fill price per unit.
 * @param quantity   Units, not lots.
 */
export function computeCharges(
  side: Side,
  premium: number,
  quantity: number,
  model: CostModel
): ChargeBreakdown {
  const turnover = premium * quantity;

  const brokerage = model.brokeragePerOrder;
  const stt = side === "SELL" ? turnover * model.sttSellRate : 0;
  const exchangeTxn = turnover * model.exchangeTxnRate;
  const sebi = turnover * model.sebiRate;
  const stampDuty = side === "BUY" ? turnover * model.stampDutyBuyRate : 0;
  const ipft = turnover * model.ipftRate;

  // GST applies to the service components only — never to STT or stamp duty.
  const gst = (brokerage + exchangeTxn + sebi + ipft) * model.gstRate;

  const round = (v: number) => Math.round(v * 100) / 100;
  const parts = {
    brokerage: round(brokerage),
    stt: round(stt),
    exchangeTxn: round(exchangeTxn),
    sebi: round(sebi),
    stampDuty: round(stampDuty),
    ipft: round(ipft),
    gst: round(gst),
  };

  return {
    ...parts,
    total: round(
      parts.brokerage + parts.stt + parts.exchangeTxn + parts.sebi + parts.stampDuty + parts.ipft + parts.gst
    ),
  };
}

export function emptyCharges(): ChargeBreakdown {
  return {
    brokerage: 0,
    stt: 0,
    exchangeTxn: 0,
    sebi: 0,
    stampDuty: 0,
    ipft: 0,
    gst: 0,
    total: 0,
  };
}

/** A round-trip estimate, shown on the order card before you commit. */
export function estimateRoundTrip(premium: number, quantity: number, model: CostModel): number {
  const inCost = computeCharges("BUY", premium, quantity, model).total;
  const outCost = computeCharges("SELL", premium, quantity, model).total;
  return Math.round((inCost + outCost) * 100) / 100;
}
