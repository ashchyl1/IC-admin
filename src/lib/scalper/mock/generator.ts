/**
 * Mock market generator.
 *
 * Produces a plausible NSE session: a spot random walk with intraday drift and
 * a lunchtime volume lull, an option chain priced off it with Black-Scholes and
 * a volatility smile, and bid/ask quotes that widen as the premium thins.
 *
 * Two clocks matter here:
 *   - the real wall clock, which decides the *reported* market phase; and
 *   - `virtualNow`, which drives the data.
 * When the exchange is actually open the two are the same. Outside market hours
 * the generator replays the most recent session at 60x so the dashboard is
 * alive on a Sunday evening â€” while the UI keeps telling the truth about the
 * real session being closed.
 */

import { CHAIN_DEPTH, HISTORY_SESSIONS, SESSION, TICKER_SYMBOLS, UNDERLYINGS } from "../config";
import { RISK_FREE_RATE, blackScholes, impliedVol } from "../pricing";
import {
  fromChartTime,
  isWeekend,
  marketPhase,
  minutesOfDay,
  nextWeekday,
  previousTradingDay,
  sessionCloseMs,
  sessionOpenMs,
  toChartTime,
  yearsToExpiry,
} from "../time";
import type { UnderlyingSpec } from "../config";
import type {
  Candle,
  ChainRow,
  IndexQuote,
  MarketPhase,
  OptionContract,
  OptionQuote,
  OptionType,
  Quote,
  Underlying,
} from "../types";
import { gaussian, hashSeed, mulberry32, type Rng } from "./random";

const MINUTE_MS = 60_000;
const SESSION_MINUTES = SESSION.close - SESSION.open;
const DAILY_HISTORY = 60;
/** How many 1-minute bars of an option series stay derived for charting. */
const OPTION_WINDOW = 420;

interface SpotState {
  spec: UnderlyingSpec;
  /** 1-minute candles for the last `HISTORY_SESSIONS` sessions, oldest first. */
  intraday: Candle[];
  /** Daily candles up to yesterday â€” the 1D multi-timeframe cell reads these. */
  daily: Candle[];
  /** Close of the previous session, the reference for "change today". */
  prevClose: number;
  sessionOpenMs: number;
  last: number;
  dayVolume: number;
  rng: Rng;
}

interface OptionCache {
  candles: Candle[];
  /** Length of the spot array the cache was derived from. */
  derivedTo: number;
  spotStart: number;
}

export interface GeneratorOptions {
  seed?: number;
  /** Replay speed applied only when the real market is closed. */
  closedReplayMultiplier?: number;
}

export class MockMarketGenerator {
  private readonly seed: number;
  private readonly replayMultiplier: number;
  private readonly states = new Map<Underlying, SpotState>();
  private readonly optionCache = new Map<string, OptionCache>();
  private auxRng: Rng;

  /** Ticker members that are not tradable underlyings (SENSEX, INDIA VIX). */
  private aux: Record<string, { last: number; prevClose: number }> = {};

  private virtualNow: number;
  private readonly realOpenAtStart: boolean;
  private replayComplete = false;

  constructor(options: GeneratorOptions = {}) {
    this.seed = options.seed ?? 0x5ca19e;
    this.replayMultiplier = options.closedReplayMultiplier ?? 60;
    this.auxRng = mulberry32(this.seed ^ 0x9e37);

    const realNow = Date.now();
    this.realOpenAtStart = marketPhase(realNow) === "OPEN";
    this.virtualNow = this.realOpenAtStart ? realNow : replayStartMs(realNow);

    this.seedAll();
  }

  // ------------------------------------------------------------- clock ---

  get now(): number {
    return this.virtualNow;
  }

  /** The phase the *user* is in, which is what the warnings must reflect. */
  get realPhase(): MarketPhase {
    return marketPhase(Date.now());
  }

  get isReplaying(): boolean {
    return !this.realOpenAtStart;
  }

  get isReplayComplete(): boolean {
    return this.replayComplete;
  }

  /** Advance the simulation. `elapsedMs` is real time since the previous tick. */
  advance(elapsedMs: number): void {
    if (this.realOpenAtStart) {
      this.virtualNow = Math.min(Date.now(), sessionCloseMs(this.virtualNow));
    } else if (!this.replayComplete) {
      const close = sessionCloseMs(this.virtualNow);
      const next = this.virtualNow + elapsedMs * this.replayMultiplier;
      if (next >= close) {
        this.virtualNow = close;
        this.replayComplete = true;
      } else {
        this.virtualNow = next;
      }
    }

    for (const state of this.states.values()) this.step(state);
    this.stepAux();
  }

  /** Wipe the simulation and run the session again from 09:15. */
  restart(): void {
    this.optionCache.clear();
    this.replayComplete = false;
    this.auxRng = mulberry32((this.seed ^ 0x9e37) + Math.floor(Date.now() / 1000));
    this.virtualNow = this.realOpenAtStart ? Date.now() : replayStartMs(Date.now());
    this.seedAll();
  }

  // ------------------------------------------------------------ series ---

  intraday1m(underlying: Underlying): Candle[] {
    return this.state(underlying).intraday;
  }

  /** Daily bars with the live session folded in as the last, forming bar. */
  daily(underlying: Underlying): Candle[] {
    const state = this.state(underlying);
    const start = toChartTime(state.sessionOpenMs);
    const today = state.intraday.filter((c) => c.time >= start);
    if (today.length === 0) return state.daily;

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const c of today) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    return [
      ...state.daily,
      {
        time: Math.floor(today[0].time / 86_400) * 86_400,
        open: today[0].open,
        high,
        low,
        close: today[today.length - 1].close,
        volume,
      },
    ];
  }

  /** Chart-time seconds of 09:15 for the current session. */
  sessionOpenSeconds(underlying: Underlying): number {
    return toChartTime(this.state(underlying).sessionOpenMs);
  }

  // ------------------------------------------------------------ quotes ---

  spotQuote(underlying: Underlying): Quote {
    const s = this.state(underlying);
    const change = s.last - s.prevClose;
    // An index has no real book; a token spread keeps the UI shape uniform.
    const tick = s.spec.strikeStep / 100;
    return {
      ltp: round2(s.last),
      bid: round2(s.last - tick),
      ask: round2(s.last + tick),
      change: round2(change),
      changePct: round2((change / s.prevClose) * 100),
      volume: Math.round(s.dayVolume),
      openInterest: 0,
      prevClose: round2(s.prevClose),
      ts: this.virtualNow,
    };
  }

  indexQuotes(): IndexQuote[] {
    return TICKER_SYMBOLS.map((t) => {
      if (t.label === "NIFTY 50" || t.label === "BANKNIFTY") {
        const key: Underlying = t.label === "NIFTY 50" ? "NIFTY" : "BANKNIFTY";
        return { ...this.spotQuote(key), symbol: t.symbol, label: t.label };
      }
      const a = this.aux[t.symbol];
      const change = a.last - a.prevClose;
      return {
        symbol: t.symbol,
        label: t.label,
        ltp: round2(a.last),
        bid: round2(a.last * 0.9999),
        ask: round2(a.last * 1.0001),
        change: round2(change),
        changePct: round2((change / a.prevClose) * 100),
        volume: 0,
        openInterest: 0,
        prevClose: round2(a.prevClose),
        ts: this.virtualNow,
      };
    });
  }

  // ------------------------------------------------------------- chain ---

  expiries(underlying: Underlying): string[] {
    const spec = this.state(underlying).spec;
    const out: string[] = [];
    let cursor = this.virtualNow;
    for (let i = 0; i < 4; i += 1) {
      const iso = nextWeekday(cursor, spec.expiryWeekday);
      if (!out.includes(iso)) out.push(iso);
      const [y, m, d] = iso.split("-").map(Number);
      cursor = Date.UTC(y, m - 1, d, 6, 0, 0) + 86_400_000;
    }
    return out;
  }

  atmStrike(underlying: Underlying): number {
    const { spec, last } = this.state(underlying);
    return Math.round(last / spec.strikeStep) * spec.strikeStep;
  }

  contract(
    underlying: Underlying,
    strike: number,
    optionType: OptionType,
    expiry: string
  ): OptionContract {
    return {
      symbol: `${underlying}${expiryCode(expiry)}${strike}${optionType}`,
      underlying,
      expiry,
      strike,
      optionType,
      lotSize: UNDERLYINGS[underlying].lotSize,
    };
  }

  optionQuote(contract: OptionContract): OptionQuote {
    const state = this.state(contract.underlying);
    const spot = state.last;
    const t = yearsToExpiry(this.virtualNow, contract.expiry);
    const iv = impliedVol(spot, contract.strike, state.spec.mockVol * 1.35, contract.optionType);

    const ltp = blackScholes({
      s: spot,
      k: contract.strike,
      t,
      r: RISK_FREE_RATE,
      sigma: iv,
      type: contract.optionType,
    });
    // Yesterday's close: same strike, one more day of time value, prior spot.
    const prevClose = blackScholes({
      s: state.prevClose,
      k: contract.strike,
      t: t + 1 / 365,
      r: RISK_FREE_RATE,
      sigma: iv,
      type: contract.optionType,
    });

    const { bid, ask } = spreadFor(ltp, this.auxRng);
    const change = ltp - prevClose;
    const distance = Math.abs(contract.strike - spot) / state.spec.strikeStep;
    const activity = Math.exp(-0.35 * distance);

    return {
      contract,
      iv,
      ltp,
      bid,
      ask,
      change: round2(change),
      changePct: prevClose > 0 ? round2((change / prevClose) * 100) : 0,
      volume: Math.round(state.dayVolume * 0.02 * activity),
      openInterest: Math.round(
        (900_000 + 2_600_000 * activity) * (contract.optionType === "PE" ? 1.08 : 1)
      ),
      prevClose: round2(prevClose),
      ts: this.virtualNow,
    };
  }

  chain(underlying: Underlying, expiry: string, centreStrike?: number): ChainRow[] {
    const spec = this.state(underlying).spec;
    const atm = this.atmStrike(underlying);
    const centre = centreStrike ?? atm;
    const rows: ChainRow[] = [];
    for (let i = -CHAIN_DEPTH; i <= CHAIN_DEPTH; i += 1) {
      const strike = centre + i * spec.strikeStep;
      rows.push({
        strike,
        call: this.optionQuote(this.contract(underlying, strike, "CE", expiry)),
        put: this.optionQuote(this.contract(underlying, strike, "PE", expiry)),
        isAtm: strike === atm,
      });
    }
    return rows;
  }

  /**
   * Option candles derived from the spot series.
   *
   * Repricing each spot bar's O/H/L/C through Black-Scholes gives an option
   * chart that actually agrees with the index chart â€” a CE breakout lines up
   * with a spot breakout, which is the whole point of the three-pane layout.
   * Puts invert, so the extremes are re-sorted rather than assumed.
   *
   * Only the forming bar is recomputed on a tick; closed bars are cached.
   */
  optionCandles(contract: OptionContract): Candle[] {
    const state = this.state(contract.underlying);
    const spot = state.intraday;
    const spotStart = Math.max(0, spot.length - OPTION_WINDOW);
    const cached = this.optionCache.get(contract.symbol);

    let out: Candle[];
    let from: number;
    if (cached && cached.spotStart === spotStart && cached.derivedTo <= spot.length) {
      // Drop the last derived bar: it was still forming when it was cached.
      out = cached.candles.slice(0, Math.max(0, cached.candles.length - 1));
      from = spotStart + out.length;
    } else {
      out = [];
      from = spotStart;
    }

    const iv = impliedVol(state.last, contract.strike, state.spec.mockVol * 1.35, contract.optionType);
    const distance = Math.abs(contract.strike - state.last) / state.spec.strikeStep;
    const activity = Math.exp(-0.35 * distance);
    const minT = yearsToExpiry(this.virtualNow, contract.expiry);

    for (let i = from; i < spot.length; i += 1) {
      const c = spot[i];
      const t = Math.max(minT, yearsToExpiry(fromChartTime(c.time), contract.expiry));
      const px = (s: number) =>
        blackScholes({ s, k: contract.strike, t, r: RISK_FREE_RATE, sigma: iv, type: contract.optionType });

      const open = px(c.open);
      const close = px(c.close);
      const atHigh = px(c.high);
      const atLow = px(c.low);
      out.push({
        time: c.time,
        open,
        high: Math.max(atHigh, atLow, open, close),
        low: Math.min(atHigh, atLow, open, close),
        close,
        volume: Math.max(1, Math.round(c.volume * 0.02 * activity)),
      });
    }

    this.optionCache.set(contract.symbol, { candles: out, derivedTo: spot.length, spotStart });
    return out;
  }

  // ------------------------------------------------------------ private ---

  private state(underlying: Underlying): SpotState {
    const s = this.states.get(underlying);
    if (!s) throw new Error(`unknown underlying ${underlying}`);
    return s;
  }

  private seedAll(): void {
    for (const key of Object.keys(UNDERLYINGS) as Underlying[]) {
      this.states.set(key, this.buildState(key));
    }
    this.aux = {};
    for (const t of TICKER_SYMBOLS) {
      if (t.label === "NIFTY 50" || t.label === "BANKNIFTY") continue;
      this.aux[t.symbol] = {
        last: t.base,
        prevClose: t.base * (1 - 0.004 + this.auxRng() * 0.008),
      };
    }
  }

  private buildState(key: Underlying): SpotState {
    const spec = UNDERLYINGS[key];
    const rng = mulberry32(this.seed ^ hashSeed(key));

    // Daily history first â€” it sets the level the intraday walk starts from.
    const daily: Candle[] = [];
    let level = spec.mockBase * (0.94 + rng() * 0.06);
    let cursor = previousTradingDay(this.virtualNow, DAILY_HISTORY);

    for (let i = 0; i < DAILY_HISTORY - 1; i += 1) {
      const sigma = (spec.mockVol / Math.sqrt(252)) * level;
      const open = level;
      const close = open + gaussian(rng) * sigma + sigma * 0.05;
      const high = Math.max(open, close) + Math.abs(gaussian(rng)) * sigma * 0.6;
      const low = Math.min(open, close) - Math.abs(gaussian(rng)) * sigma * 0.6;
      daily.push({
        time: Math.floor(toChartTime(cursor) / 86_400) * 86_400,
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume: Math.round(180_000_000 * (0.7 + rng() * 0.6)),
      });
      level = close;
      cursor = nextTradingDay(cursor);
    }

    // Intraday: `HISTORY_SESSIONS` complete sessions, then today up to virtualNow.
    const intraday: Candle[] = [];
    let last = level;
    let prevClose = level;
    let sessionOpen = sessionOpenMs(this.virtualNow);
    let dayVolume = 0;

    for (let back = HISTORY_SESSIONS; back >= 0; back -= 1) {
      const isToday = back === 0;
      const dayMs = isToday ? this.virtualNow : previousTradingDay(this.virtualNow, back);
      const open = sessionOpenMs(dayMs);
      const endMinute = isToday
        ? Math.min(SESSION_MINUTES, Math.max(1, minutesOfDay(this.virtualNow) - SESSION.open))
        : SESSION_MINUTES;

      prevClose = last;
      if (isToday) {
        sessionOpen = open;
        dayVolume = 0;
      }
      // A small overnight gap is what makes previous-day levels worth drawing.
      last = round2(last * (1 + gaussian(rng) * 0.0012));

      const drift = gaussian(rng) * 0.0009; // this session's net lean
      for (let m = 0; m < endMinute; m += 1) {
        const bar = this.minuteBar(last, spec, rng, m, drift);
        bar.time = toChartTime(open + m * MINUTE_MS);
        intraday.push(bar);
        last = bar.close;
        if (isToday) dayVolume += bar.volume;
      }
    }

    return {
      spec,
      intraday,
      daily,
      prevClose: round2(prevClose),
      sessionOpenMs: sessionOpen,
      last,
      dayVolume,
      rng,
    };
  }

  /** One 1-minute bar. Volatility and volume follow the intraday U-curve. */
  private minuteBar(
    prevClose: number,
    spec: UnderlyingSpec,
    rng: Rng,
    minuteIndex: number,
    drift: number
  ): Candle {
    const perMinuteVol = (spec.mockVol / Math.sqrt(252 * SESSION_MINUTES)) * prevClose;
    const shape = uShape(minuteIndex / SESSION_MINUTES);
    const sigma = perMinuteVol * (0.6 + shape * 1.1);

    const open = prevClose;
    const close = round2(open + gaussian(rng) * sigma + open * drift * 0.02);
    const high = round2(Math.max(open, close) + Math.abs(gaussian(rng)) * sigma * 0.7);
    const low = round2(Math.min(open, close) - Math.abs(gaussian(rng)) * sigma * 0.7);

    return {
      time: 0,
      open: round2(open),
      high,
      low,
      close,
      volume: Math.round((260_000 + rng() * 180_000) * (0.5 + shape * 1.6)),
    };
  }

  /** Advance one underlying by a tick, extending or updating the forming bar. */
  private step(state: SpotState): void {
    const { spec, rng } = state;
    const barIndex = Math.floor((this.virtualNow - state.sessionOpenMs) / MINUTE_MS);
    if (barIndex < 0 || barIndex >= SESSION_MINUTES) return;

    const perMinuteVol = (spec.mockVol / Math.sqrt(252 * SESSION_MINUTES)) * state.last;
    const shape = uShape(barIndex / SESSION_MINUTES);
    const move = gaussian(rng) * perMinuteVol * (0.6 + shape * 1.1) * 0.35;
    const next = round2(Math.max(state.last * 0.9, state.last + move));

    const barTime = toChartTime(state.sessionOpenMs) + barIndex * 60;
    const tail = state.intraday[state.intraday.length - 1];

    if (tail && tail.time === barTime) {
      tail.high = Math.max(tail.high, next);
      tail.low = Math.min(tail.low, next);
      tail.close = next;
      const added = Math.round(4_000 + rng() * 9_000);
      tail.volume += added;
      state.dayVolume += added;
    } else if (!tail || barTime > tail.time) {
      const bar: Candle = {
        time: barTime,
        open: state.last,
        high: Math.max(state.last, next),
        low: Math.min(state.last, next),
        close: next,
        volume: Math.round((26_000 + rng() * 18_000) * (0.5 + shape * 1.6)),
      };
      state.intraday.push(bar);
      state.dayVolume += bar.volume;
      // Keep memory flat over a long-running session.
      while (state.intraday.length > (HISTORY_SESSIONS + 1) * SESSION_MINUTES + 16) {
        state.intraday.shift();
      }
    }
    state.last = next;
  }

  private stepAux(): void {
    const nifty = this.state("NIFTY");
    const niftyMove = (nifty.last - nifty.prevClose) / nifty.prevClose;
    for (const t of TICKER_SYMBOLS) {
      const a = this.aux[t.symbol];
      if (!a) continue;
      if (t.label === "INDIA VIX") {
        // VIX leans against the index and mean-reverts to its own base.
        const pull = (t.base - a.last) * 0.01;
        a.last = Math.max(8, a.last + pull - niftyMove * 6 + gaussian(this.auxRng) * 0.03);
      } else {
        // SENSEX shadows NIFTY with a little idiosyncratic noise.
        a.last = a.prevClose * (1 + niftyMove * (0.94 + this.auxRng() * 0.12));
      }
    }
  }
}

// --------------------------------------------------------------- helpers ---

/**
 * Where a replay picks the most recent session up.
 *
 * Not 09:15: starting at the bell would mean one candle, no opening range and a
 * VWAP with nothing to average. Starting 40% in gives the workspace a session
 * worth reading on the very first paint, and still leaves ~3.7 minutes of
 * replay at 60x before the close.
 */
function replayStartMs(realNow: number): number {
  if (marketPhase(realNow) === "OPEN") return realNow;
  // Before the open, or on a weekend, the last real session is an earlier day.
  const beforeOpen = minutesOfDay(realNow) < SESSION.open;
  let cursor = beforeOpen || isWeekend(realNow) ? previousTradingDay(realNow) : realNow;
  while (isWeekend(cursor)) cursor = previousTradingDay(cursor);
  return sessionOpenMs(cursor) + Math.floor(SESSION_MINUTES * 0.4) * MINUTE_MS;
}

function nextTradingDay(epochMs: number): number {
  let cursor = epochMs + 86_400_000;
  while (isWeekend(cursor)) cursor += 86_400_000;
  return cursor;
}

/** Volume and volatility are high at the open and close, thin around lunch. */
function uShape(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 0.35 + 0.65 * (Math.cos(2 * Math.PI * p) * 0.5 + 0.5);
}

/**
 * Quoted spread. Cheap options quote wider in percentage terms, which is what
 * punishes a scalper who chases a four-rupee far-OTM strike.
 */
function spreadFor(ltp: number, rng: Rng): { bid: number; ask: number } {
  const pctSpread = ltp < 10 ? 0.035 : ltp < 40 ? 0.018 : ltp < 120 ? 0.008 : 0.004;
  const raw = Math.max(0.05, (ltp * pctSpread) / 2) * (0.8 + rng() * 0.5);
  const half = Math.max(0.05, Math.round(raw * 20) / 20);
  return { bid: Math.max(0.05, round2(ltp - half)), ask: round2(ltp + half) };
}

function expiryCode(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${d}${months[Number(m) - 1]}`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

