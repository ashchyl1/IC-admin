# Wave Lab

Two chart terminals with the full Elliott Wave toolset, fed from Zerodha, with
every count rule-checked and exportable to Claude.

**Route:** `/wave-lab` · **Analysis only** — nothing in this module can place an
order, and the Kite MCP provider refuses to call any tool whose name looks like
an order path.

---

## Why two terminals

Elliott work is comparative. A count that only survives on one timeframe is not
a count, and Phase 6 of the analysis SOP — multi-timeframe confirmation — is a
glance rather than a task when the higher degree and the trading timeframe are
side by side. The panes open on NIFTY daily and NIFTY hourly; each carries its
own instrument, interval, chart type, indicators and wave count. **Sync charts**
ties their pan, zoom and crosshair together.

---

## Drawing tools

The five Elliott tools match the TradingView set. Each is defined by the labels
it stamps: the **first click is the pattern's origin and is not labelled** — it
is how you tell the tool where wave 1 (or A, or W) began — and every later click
takes the next label.

| Tool | Clicks | Labels | Shortcut |
|---|---|---|---|
| Elliott Impulse Wave (12345) | 6 | 1 2 3 4 5 | `1` |
| Elliott Correction Wave (ABC) | 4 | A B C | `2` |
| Elliott Triangle Wave (ABCDE) | 6 | A B C D E | `3` |
| Elliott Double Combo Wave (WXY) | 4 | W X Y | `4` |
| Elliott Triple Combo Wave (WXYXZ) | 6 | W X Y X Z | `5` |
| Fibonacci retracement | 2 | 0–100% levels | `F` |
| Fibonacci extension | 3 | 0.618–4.236 projections | `E` |
| Trend line | 2 | — | `T` |
| Horizontal level | 1 | — | `H` |

`Esc` cancels a part-placed pattern; `Delete` removes the selected drawing.
Shortcuts act on the terminal you last clicked in.

**Magnet** (on by default) snaps each click to the nearest bar's high or low.
Wave pivots are extremes — one placed a few pixels off the wick quietly corrupts
every ratio measured from it. Turn it off to place a projected pivot beyond the
last bar.

Click a drawing to select it, drag any handle to move a pivot. Selecting a
count draws its **invalidation level** and, for an impulse, its **2–4 channel**
with the parallel through wave 3.

### Degrees

Nine degrees, with the label decoration that separates a Primary count from its
Minute subdivisions. Colour and type size carry the same information redundantly,
because on a busy chart the wrapper alone is hard to read.

| Degree | Motive | Corrective |
|---|---|---|
| Grand Supercycle | `[I] [II] [III] [IV] [V]` | `[A] [B] [C]` |
| Supercycle | `(I) (II) (III) (IV) (V)` | `(A) (B) (C)` |
| Cycle | `I II III IV V` | `A B C` |
| Primary | `① ② ③ ④ ⑤` | `Ⓐ Ⓑ Ⓒ` |
| Intermediate | `(1) (2) (3) (4) (5)` | `(A) (B) (C)` |
| Minor | `1 2 3 4 5` | `A B C` |
| Minute | `[i] [ii] [iii] [iv] [v]` | `[a] [b] [c]` |
| Minuette | `(i) (ii) (iii) (iv) (v)` | `(a) (b) (c)` |
| Subminuette | `i ii iii iv v` | `a b c` |

Changing the degree while a count is selected **retags that count**; with nothing
selected it sets the default for the next one.

### Variants

Each Elliott tool carries a variant, and the variant decides which rules apply:

- **Impulse** — impulse · leading diagonal · ending diagonal · extended third ·
  truncated fifth. The diagonals are the reason wave 1/4 overlap is a hard
  failure on one and an expectation on another.
- **Correction** — zigzag · flat · expanded flat · running flat.
- **Triangle** — contracting · barrier · expanding · running.
- **Combinations** — double zigzag · double flat · combination.

---

## What the rule engine checks

TradingView's wave tools label and stop there. This module runs the checks, and
shows the number that produced each verdict so a "fail" can be argued with.

**Hard rules** (breaking one invalidates the count):

- Legs alternate direction correctly for the pattern.
- Wave 2 never retraces 100% of wave 1.
- Wave 3 is never the shortest of waves 1, 3 and 5.
- Wave 4 does not enter wave 1's price territory — *unless* the variant is a
  diagonal, where overlap is expected instead.
- Zigzag wave B holds inside wave A.
- Contracting-triangle wave E stays inside wave C.
- An ABC's C resumes A's direction.

**Guidelines** (tendencies — missing several weakens a count without killing it):
wave 2 and wave 4 retracement depth, alternation between them, wave 3 extension,
wave 5 projections (equality with 1, or against 1+3), diagonal contraction,
flat B-wave depth, expanded vs running flat, triangle contraction and the
0.618/1.618 leg relationship, the Lucas 29% triangle time share, W/X/Y equality,
channelling against the 2–4 parallel, and completion on a Fibonacci or Lucas bar.

**Fibonacci and Lucas.** Every wave-to-wave price *and* time ratio is measured
and matched against the standard tables, with a proportional tolerance — tight
on 0.236, wider on 2.618. Time counts use the ±1 bar tolerance throughout.

**Time clusters.** Leg durations, same-direction pivot counts (1→3, 3→5, A→C),
origin-to-pivot counts and the whole-pattern count are all measured. Two or more
landing within ±1 bar of each other is a cluster, and clusters are the point of
the time layer.

**Confidence tier**, following the SOP's trade-thesis table:

| Tier | Meaning |
|---|---|
| **High** | Pattern legal + a key Fibonacci price ratio + a time cluster |
| **Medium** | Pattern legal + either a price ratio or a Fibonacci/Lucas bar |
| **Low** | Legal but unconfirmed, or unfinished |
| **Pass** | A hard rule is broken — re-label, do not trade |

A generic "key bar" hit does not count towards Medium. The master bar list is
dense below ~60 bars, so only a named Fibonacci or Lucas number is treated as
evidence.

---

## Indicators

- **Bollinger Bands** — period, standard deviation, close or HLC/3 source, basis
  line, and a shaded band. `%B` and bandwidth are computed and exported, with a
  squeeze/expansion read against the recent range.
- **Exponential moving averages** — three configurable lines (20/50/200 by
  default), each with its own period and colour.
- **VWAP** (session-anchored) and **volume**.

## Chart types

Candles (default), OHLC bars, line on close, area, and Heikin-Ashi — with a
**log/linear** toggle. Log is the default: Elliott proportion is a ratio
argument, and on a linear axis a 1.618 extension drawn over years is simply the
wrong shape. Heikin-Ashi is offered for reading trend persistence but is never
used as a source for pivots — its opens and closes are averages that never
traded, so the real candles are always what the magnet and the measurements use.

---

## Market data

`/api/market/*` resolves one of four providers. `MARKET_PROVIDER=auto` (the
default) takes the first that is configured and falls back on failure, reporting
in the UI which one answered.

| Provider | Env | Notes |
|---|---|---|
| `kite-mcp` | `KITE_MCP_URL`, `KITE_MCP_TOKEN` | Zerodha Kite MCP over the streamable-HTTP transport. Tools are **discovered** via `tools/list` and their argument names read off each tool's own schema, so an upstream rename is not an outage. Read-only by construction. |
| `bridge` | `ZERODHA_BRIDGE_URL` | A small service in front of Kite — keeps the API secret out of this app. Contract documented in `src/lib/market/providers/bridge.ts`. |
| `kite-rest` | `KITE_API_KEY`, `KITE_ACCESS_TOKEN` | Kite Connect REST. Requests are chunked to Kite's per-interval history caps. Access tokens are day-scoped; a 403 surfaces as "re-run the login flow". |
| `synthetic` | — | Offline fallback. Lays down a real Elliott fractal so the tools have structure to bite on, and is **always flagged as simulated** in the UI. Set `MARKET_ALLOW_SYNTHETIC=0` in production to remove it. |

Week and month bars are aggregated locally from daily, because Kite does not
serve them and Elliott work at Primary degree and above needs them.

**Live tail.** `/api/market/quote` is polled every 15 seconds and extends the
last bar with the traded price, the same thing a broker feed does to the forming
candle. Polling rather than a socket: a wave analyst is looking at structure, not
the tape, and a WebSocket per open tab costs a broker connection each.

### Endpoints

| Route | Purpose |
|---|---|
| `GET /api/market/candles?symbol=NSE:NIFTY 50&interval=day&days=1400` | Historical bars |
| `GET /api/market/quote?symbols=NSE:INFY,NSE:TCS` | Last price + day OHLC |
| `GET /api/market/search?q=nifty` | Instrument search |
| `GET/POST /api/wave/analysis` | Save and list wave analyses |

---

## The Claude hand-off

**Send to Claude** builds one document containing everything on screen: the
price series, every wave label with its degree and variant, every measured leg,
every price and time ratio with its nearest Fibonacci target, the time counts and
clusters, the channel projection, the indicator state, and the full rule verdict
for each count.

Four ways out:

- **Copy brief** — Markdown in the SOP's own output format. Paste straight into
  a conversation.
- **Copy JSON** / **.json** / **.md** — the versioned
  `indiacharts.wave-analysis/v1` document.
- **Save to data/wave-analyses** — writes the file into the repository, which is
  the one that matters day to day: Claude Code can open the path directly on the
  next question, with no pasting and no truncation.

Price data is included **around the labels** by default — enough context to see
what the labels sit on, without pasting six years of daily bars into a message.
`Recent`, `All bars` and `No bars` are the other options.

### Importing a count back

The **Import** tab reads the same schema, so a count Claude proposes can be put
straight onto the chart. A bare object is enough:

```json
{
  "drawings": [
    {
      "tool": "impulse",
      "degree": "Primary",
      "variant": "impulse",
      "note": "alternate count — wave 3 extended",
      "points": [
        { "iso": "2025-08-01T09:15:00+05:30", "price": 24180 },
        { "iso": "2025-09-01T09:15:00+05:30", "price": 25100 }
      ]
    }
  ]
}
```

Times may be ISO strings or chart seconds, degrees may be keys (`primary`) or
labels (`Primary`), and anything malformed is reported rather than silently
dropped — a count that loses a pivot on import is worse than one that refuses to
load.

---

## Layout of the code

```
src/lib/market/          data layer, shared with nothing else
  types.ts               candle/instrument/quote contracts, interval table
  normalize.ts           shape-tolerant parsing of broker payloads
  providers/             kite-mcp · kite-rest · bridge · synthetic
  index.ts               provider resolution + fallback chain

src/lib/wave/            the domain, all pure — no React, no chart
  degrees.ts             nine degrees and their label decoration
  patterns.ts            the tool definitions and their variants
  fib.ts                 Fibonacci/Lucas tables, ratio and time matching
  metrics.ts             legs, ratios, time counts, clusters, channels
  rules.ts               the rule and guideline engine, and the tier
  indicators.ts          Bollinger, EMA (reused from scalper), Heikin-Ashi
  hit.ts                 pointer hit-testing against projected geometry
  export.ts / serialize  the Claude hand-off, both directions
  store.ts               two terminals, persistence, data loading

src/components/wave/     WaveLabWorkspace → ChartTerminal → WaveChart/WaveOverlay
```

Drawings are stored as a tool id, a degree, a variant and a list of
`(time, price)` points. Everything else — labels, leg lengths, ratios, verdicts —
is derived, so a saved analysis stays valid when the maths improves and there is
exactly one source of truth to export.

Counts persist to `localStorage` on every change and are restored on load.

### Two things worth knowing before editing the chart

- **Click handling does not use `chart.subscribeClick`.** Lightweight Charts
  discriminates clicks from double-clicks, so two pivots placed within half a
  second collapse into one event — exactly the rhythm of laying down a five-wave
  count. `WaveChart` watches pointerdown/pointerup itself.
- **Hit-testing does not use the SVG.** The overlay root must be
  `pointer-events: none` so clicks reach the chart, and Chromium will not
  hit-test into such a subtree even where a child sets `pointer-events: auto`.
  `lib/wave/hit.ts` tests the projected coordinates directly.

Both were found by driving the real page in a browser; neither shows up in a
type check.

---

## Tests

`npx vitest run tests/wave-rules.test.ts` — 51 cases over the rule engine
(every hard rule, both directions, each variant), the metrics, the
Fibonacci/Lucas tables, the indicators, the degree notation and the hit-testing.
