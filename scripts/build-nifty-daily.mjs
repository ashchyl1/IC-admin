#!/usr/bin/env node
/**
 * Builds src/lib/nifty-timeline/nifty-daily.json -- the daily Nifty 50 series
 * the recommendation timeline plots.
 *
 *   node scripts/build-nifty-daily.mjs             # fetch real bars, fall back offline
 *   node scripts/build-nifty-daily.mjs --offline   # skip the network entirely
 *   node scripts/build-nifty-daily.mjs --months 12
 *
 * Two sources, and the JSON records which one produced it so the UI can say so
 * rather than presenting a reconstruction as market data:
 *
 *   "yahoo"         real ^NSEI daily bars.
 *   "reconstructed" a deterministic series built from WEEKS below. Every swing
 *                   in it is a level the Indiacharts casebook actually names --
 *                   the 22,183 April low, the 24,602 April high that the May
 *                   notes keep measuring against, the 23,344 May low "a little
 *                   more than 50%" down, the 23,178 June low that undercut it,
 *                   the 23,400-24,600 July range, the late-July retest of the
 *                   61.8% at 23,600 and the rebound that stalls under the
 *                   24,515 confirmation. It is a faithful *shape*, not a price
 *                   record: intra-week paths are synthesised and NSE trading
 *                   holidays are not modelled. Re-run without --offline on a
 *                   machine with network access to replace it with real data.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/lib/nifty-timeline/nifty-daily.json");

const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");
const MONTHS = Number(args[args.indexOf("--months") + 1]) || 6;

// ---------------------------------------------------------------------------
// Weekly skeleton for the reconstruction
// ---------------------------------------------------------------------------
// One row per Friday: the week's open, high, low and close. The daily
// generator only fills in the path between them, so editing a number here is
// how you correct the series -- the dailies follow.
const WEEKS = [
  // friday        open    high    low     close   volume (index turnover, arbitrary units)
  ["2026-02-13", 25790, 25905, 25240, 25378, 262],
  ["2026-02-20", 25410, 25760, 25290, 25562, 241],
  ["2026-02-27", 25540, 25620, 25050, 25184, 268],
  ["2026-03-06", 25150, 25210, 24330, 24418, 331], // closes below the H&S neckline
  ["2026-03-13", 24390, 24505, 23880, 23962, 318],
  ["2026-03-20", 23930, 24020, 23330, 23414, 344],
  ["2026-03-27", 23380, 23470, 22960, 23048, 336],
  ["2026-04-03", 23010, 23090, 22610, 22694, 352], // "still falling"
  ["2026-04-10", 22650, 23120, 22183, 23046, 398], // 22,183 April low
  ["2026-04-17", 23090, 23860, 23010, 23784, 349], // first of two up weeks
  ["2026-04-24", 23830, 24602, 23780, 24381, 341], // 24,602 high, neckline resistance
  ["2026-05-01", 24400, 24588, 24190, 24506, 296],
  ["2026-05-08", 24470, 24596, 24280, 24558, 281], // positive again, limited progress
  ["2026-05-15", 24480, 24680, 23545, 23618, 412], // free fall; bounce fails at 24,680
  ["2026-05-22", 23570, 23760, 23344, 23692, 358], // 23,344 low, just past the 50%
  ["2026-05-29", 23700, 23978, 23420, 23512, 302], // three-wave bounce, negative close
  ["2026-06-05", 23480, 23560, 23178, 23294, 288], // 23,178: the lower June low
  ["2026-06-12", 23180, 23812, 23090, 23762, 327], // Monday gap-down holds 23,077
  ["2026-06-19", 23905, 24189, 23742, 23952, 274], // weekly doji under the 20wma
  ["2026-06-26", 24000, 24240, 23880, 24062, 259], // second doji, closes above it
  ["2026-07-03", 24080, 24352, 23829, 24301, 288], // above the prior week's high
  ["2026-07-10", 24290, 24356, 23905, 23982, 305], // fails at the 40wema, closes down
  ["2026-07-17", 23960, 24378, 23806, 24318, 292], // Friday close above 24,300
  ["2026-07-24", 24300, 24340, 23612, 23745, 279], // back to the 61.8% / 20wma cluster
  ["2026-07-31", 23760, 24468, 23701, 24412, 361], // rebound on better volume
  ["2026-08-07", 24430, 24529, 24352, 24498, 318], // partial: probing 24,515
];

/** The last row is the in-progress week; only these days of it have printed. */
const LAST_WEEK_DAYS = 3;

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------
// Seeded so two runs of this script produce byte-identical JSON; a fresh random
// series on every build would make the committed data file churn.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Expands one weekly bar into `count` daily bars.
 *
 * The constraints that matter: the first open and the last close are the
 * week's, and the week's high and low are each touched exactly once. Without
 * that last part the daily series would quietly clip the swings the casebook
 * argues from -- a 23,344 low that never prints is not the same chart.
 */
function expandWeek([friday, wOpen, wHigh, wLow, wClose, wVol], count, rand) {
  const days = [];
  for (let i = 0; i < count; i++) days.push(addDays(friday, -(4 - i)));

  const clamp = (v) => Math.min(Math.max(v, wLow), wHigh);

  // A random walk from open to close, then rescaled so it lands exactly on it.
  // Interior points are clamped into the week's range: a close outside it would
  // force that day's high above the weekly high to stay a valid bar.
  const raw = [wOpen];
  for (let i = 1; i < count; i++) {
    raw.push(raw[i - 1] + (rand() - 0.5) * (wHigh - wLow) * 0.55);
  }
  const drift = (wClose - raw[count - 1]) / (count - 1 || 1);
  const closes = raw.map((v, i) => (i === 0 ? wOpen : clamp(v + drift * i)));
  closes[count - 1] = wClose;

  // An up week bottoms early and peaks late; a down week does the reverse.
  const up = wClose >= wOpen;
  const lowDay = up ? Math.min(1, count - 1) : count - 1;
  const highDay = up ? count - 1 : Math.min(1, count - 1);

  const bars = [];
  let prevClose = wOpen;
  for (let i = 0; i < count; i++) {
    const close = closes[i];
    // Monday opens at the week's open; later days gap slightly off the
    // previous close, which is what makes the bars look like bars.
    const open =
      i === 0 ? wOpen : clamp(prevClose + (rand() - 0.5) * (wHigh - wLow) * 0.08);
    const body = [open, close];
    const wick = (rand() * 0.35 + 0.1) * (wHigh - wLow) * 0.4;

    let high = Math.max(...body) + wick * (0.4 + rand() * 0.6);
    let low = Math.min(...body) - wick * (0.4 + rand() * 0.6);

    if (i === highDay) high = wHigh;
    if (i === lowDay) low = wLow;
    high = Math.min(Math.max(high, ...body), wHigh);
    low = Math.max(Math.min(low, ...body), wLow);

    bars.push({
      date: days[i],
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: Math.round((wVol / count) * (0.75 + rand() * 0.5) * 1e5),
    });
    prevClose = close;
  }

  // The forced extremes can land on a day whose body already sat outside them;
  // widen that day rather than moving the extreme, so the week still prints its
  // true high and low.
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  if (hi < wHigh) bars[highDay].high = wHigh;
  if (lo > wLow) bars[lowDay].low = wLow;
  return bars;
}

function reconstruct() {
  const rand = mulberry32(20260802);
  const bars = [];
  WEEKS.forEach((week, i) => {
    const last = i === WEEKS.length - 1;
    bars.push(...expandWeek(week, last ? LAST_WEEK_DAYS : 5, rand));
  });
  return bars;
}

// ---------------------------------------------------------------------------
// Real bars
// ---------------------------------------------------------------------------
async function fetchYahoo() {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI" +
    `?range=${MONTHS}mo&interval=1d`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const q = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !q) throw new Error("unexpected Yahoo payload shape");

  const bars = [];
  result.timestamp.forEach((ts, i) => {
    if (q.close[i] == null) return; // Yahoo pads holidays with nulls
    bars.push({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: round2(q.open[i]),
      high: round2(q.high[i]),
      low: round2(q.low[i]),
      close: round2(q.close[i]),
      volume: q.volume[i] ?? 0,
    });
  });
  if (!bars.length) throw new Error("Yahoo returned no usable bars");
  return bars;
}

// ---------------------------------------------------------------------------

async function main() {
  let bars;
  let source = "reconstructed";

  if (!OFFLINE) {
    try {
      bars = await fetchYahoo();
      source = "yahoo";
    } catch (err) {
      console.warn(`! live fetch failed (${err.message}); using the reconstruction`);
    }
  }
  if (!bars) bars = reconstruct();

  const payload = {
    symbol: "NIFTY 50",
    source,
    generatedAt: new Date().toISOString(),
    note:
      source === "yahoo"
        ? "Daily bars from Yahoo Finance (^NSEI)."
        : "Reconstructed daily bars: the swings match the levels the casebook cites, " +
          "but intra-week paths are synthesised and trading holidays are not modelled. " +
          "Run `node scripts/build-nifty-daily.mjs` with network access for real data.",
    bars,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `wrote ${bars.length} bars (${bars[0].date} to ${bars[bars.length - 1].date}) ` +
      `from "${source}" to ${OUT.replace(`${ROOT}/`, "")}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
