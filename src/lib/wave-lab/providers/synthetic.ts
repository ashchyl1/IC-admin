/**
 * Synthetic provider. §2.4.
 *
 * Generates plausible bars so the chart, the wave tools and the rule engine are
 * all developable without Kite credentials. Two non-negotiables, both enforced
 * elsewhere too: `info.live` is false so every surface can label it, and
 * `CandleStore.put` throws if this provider's id ever reaches the cache.
 *
 * The walk is seeded from the symbol, so the same symbol always produces the
 * same series. That matters more than it sounds: a wave count drawn on random
 * data that reshuffles on reload is untestable, and the §13 checklist needs a
 * chart that holds still.
 */

import { aggregateDaily, makeCandle } from "../candles";
import { INTERVAL_SECONDS, isIntraday, type Interval } from "../types";
import type { CandleRequest, Instrument, MarketCandle, MarketProvider, Quote } from "../types";
import { IST_OFFSET_MINUTES, NSE_SESSION, istDayOfWeek } from "../time";

/** Deterministic PRNG (mulberry32) — same seed, same series, every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A plausible opening level, so NIFTY looks like NIFTY and not like a penny stock. */
function basePrice(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("NIFTY BANK") || s.includes("BANKNIFTY")) return 52000;
  if (s.includes("NIFTY")) return 24500;
  if (s.includes("SENSEX")) return 81000;
  return 500 + (seedFrom(s) % 3000);
}

export class SyntheticProvider implements MarketProvider {
  readonly info = {
    id: "synthetic" as const,
    label: "Synthetic (no broker)",
    live: false,
  };

  async candles(req: CandleRequest): Promise<MarketCandle[]> {
    // 1W and 1M are derived, exactly as they are for the real provider: walking
    // the day grid for them would emit one bar per weekday and label it weekly.
    if (req.interval === "1W" || req.interval === "1M") {
      const daily = await this.candles({ ...req, interval: "1D" });
      return aggregateDaily(daily, req.interval);
    }

    const fromSec = Math.floor(req.from.getTime() / 1000);
    const toSec = Math.floor(req.to.getTime() / 1000);
    const random = rng(seedFrom(`${req.symbol}|${req.interval}`));
    const intraday = isIntraday(req.interval);
    const step = INTERVAL_SECONDS[req.interval];

    let price = basePrice(req.symbol);
    // Volatility per bar, scaled so a daily bar moves more than a minute bar.
    const vol = price * (intraday ? 0.0015 : 0.011);
    const out: MarketCandle[] = [];
    const maxBars = 5000; // a decade of 1-minute bars is neither useful nor fast

    // Walk the IST calendar day by day rather than stepping raw epoch seconds.
    // Stepping the epoch aligns bars to UTC midnight, which puts a "daily"
    // candle at 05:30 IST and drifts hourly bars off the session grid — the
    // exact failure §2.5 is about.
    for (
      let day = istMidnight(fromSec);
      day <= toSec && out.length < maxBars;
      day = istMidnight(day + 36 * 3600) // +36h then re-floor: DST-proof, though IST has none
    ) {
      const dow = istDayOfWeek(day);
      if (dow === 0 || dow === 6) continue;

      // Daily and above get one bar dated at IST midnight; intraday walks the
      // session grid from 09:15 so bars read 09:15, 09:30, … as they should.
      const slots: number[] = [];
      if (!intraday) {
        slots.push(day);
      } else {
        for (let s = NSE_SESSION.openSeconds; s <= NSE_SESSION.closeSeconds; s += step) {
          slots.push(day + s);
        }
      }

      for (const t of slots) {
        if (t < fromSec || t > toSec || out.length >= maxBars) continue;

        // Gentle mean reversion keeps the series in a believable band instead
        // of wandering to zero or the moon over a long window.
        const drift = (basePrice(req.symbol) - price) * 0.002;
        const open = price;
        const close = open + drift + (random() - 0.5) * 2 * vol;
        const high = Math.max(open, close) + random() * vol * 0.6;
        const low = Math.min(open, close) - random() * vol * 0.6;

        out.push(
          makeCandle(
            t,
            round2(open),
            round2(high),
            round2(low),
            round2(close),
            Math.round(50_000 + random() * 450_000)
          )
        );
        price = close;
      }
    }
    return out;
  }

  async quote(symbols: string[]): Promise<Record<string, Quote>> {
    const at = Math.floor(Date.now() / 1000);
    const result: Record<string, Quote> = {};
    for (const symbol of symbols) {
      const random = rng(seedFrom(symbol) ^ Math.floor(at / 15));
      const base = basePrice(symbol);
      const last = round2(base * (1 + (random() - 0.5) * 0.02));
      const change = round2(last - base);
      result[symbol] = {
        symbol,
        last,
        change,
        changePercent: round2((change / base) * 100),
        at,
      };
    }
    return result;
  }

  async search(query: string): Promise<Instrument[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const catalogue: Instrument[] = [
      inst("NSE", "NIFTY 50", "NIFTY 50 Index"),
      inst("NSE", "NIFTY BANK", "NIFTY BANK Index"),
      inst("NSE", "RELIANCE", "Reliance Industries"),
      inst("NSE", "HDFCBANK", "HDFC Bank"),
      inst("NSE", "INFY", "Infosys"),
      inst("NSE", "TCS", "Tata Consultancy Services"),
      inst("NSE", "SBIN", "State Bank of India"),
      inst("NSE", "ICICIBANK", "ICICI Bank"),
    ];
    return catalogue.filter(
      (i) => i.tradingSymbol.includes(q) || i.name.toUpperCase().includes(q)
    );
  }
}

function inst(exchange: string, tradingSymbol: string, name: string): Instrument {
  return { key: `${exchange}:${tradingSymbol}`, exchange, tradingSymbol, name };
}

/**
 * The instant of IST midnight on the day containing `epochSeconds`.
 *
 * Floors in shifted space and shifts back, so the result is a real epoch that
 * happens to be 00:00 by the IST clock — never 00:00 UTC.
 */
function istMidnight(epochSeconds: number): number {
  const shifted = epochSeconds + IST_OFFSET_MINUTES * 60;
  return Math.floor(shifted / 86400) * 86400 - IST_OFFSET_MINUTES * 60;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
