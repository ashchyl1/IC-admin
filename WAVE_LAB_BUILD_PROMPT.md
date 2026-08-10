# Build prompt — Elliott Wave analysis terminal on Kite Connect MCP

Copy everything below the rule into Claude (Claude Code works best — it can run the
app and see its own bugs). It is written to be pasted whole; the numbered sections
are independent enough that you can delete any you don't want.

Two things to fill in before you send it: your broker credentials go in `.env`, not
in the prompt, and the **Recommended additions** in §11 are opinions — cut the ones
you disagree with rather than letting the model decide.

---

## Role

You are a senior frontend engineer with a trading background. You have used
TradingView's Elliott Wave tools professionally and know exactly where they stop
being useful: they draw and label, they do not check the count. Build the thing that
checks the count.

Work in small, verifiable steps. After each feature, **launch the app in a real
browser and drive it** — click the tools, place the pivots, read the panel. A
TypeScript build that passes proves nothing about a charting UI; every serious bug
in this class of app is invisible to the compiler and obvious within ten seconds of
clicking.

## Mission

A two-terminal Elliott Wave workstation for Indian equities and indices. It pulls
live and historical candles from **Zerodha Kite Connect via MCP**, gives the analyst
the full TradingView-equivalent wave toolkit, and then does the part TradingView
refuses to do: validates every count against Elliott's hard rules and soft
guidelines, measures the Fibonacci and Lucas relationships in both price and time,
and hands the whole structure to Claude as a machine-readable bundle for a second
opinion.

The visual language is **Kite's**: white, flat, dense, blue. See §10.

---

## 1. Stack

- Next.js (App Router) + TypeScript in `strict` mode. No `any` in committed code.
- `lightweight-charts` v5 for the price canvas. Overlays that the library cannot
  draw (wave labels, connecting legs, Fibonacci grids, channels) go in an **SVG
  layer positioned over the canvas**, redrawn from the chart's coordinate
  converters on every `subscribeVisibleLogicalRangeChange` and resize.
- `zustand` for chart state, persisted to `localStorage`.
- Tailwind with the Kite tokens from §10 defined as CSS variables. No component
  library — Kite's look is 1px borders and restraint, and every UI kit fights that.
- `vitest` for the rule engine and the data layer. The geometry and the Elliott
  rules are pure functions; test them exhaustively, they are where correctness
  actually lives.
- Playwright (Chromium) for driving the real page.

---

## 2. Market data — Kite Connect MCP is the primary path

This is the headline feature. Build it first and build it properly.

### 2.1 The MCP transport

Zerodha exposes an MCP server at `https://mcp.kite.trade/mcp` speaking **streamable
HTTP**. Implement the client yourself against the spec:

1. `POST` a JSON-RPC `initialize` request. The response carries an **`Mcp-Session-Id`
   header** — capture it.
2. Echo that header on every subsequent request. Send `notifications/initialized`.
3. `tools/list` to discover what the server actually offers.
4. `tools/call` for the real work.

Three details that will otherwise cost you a day each:

- **Responses come back as either `application/json` or `text/event-stream`.**
  Branch on the content type and parse SSE framing (`event: message\ndata: {…}\n\n`,
  possibly multiple frames, possibly with `id:` lines) when you get the latter. A
  client that only handles JSON works in testing and dies in production.
- **Cache the session id across HTTP requests**, keyed on
  `` `${serverUrl}|${token}` ``. Next.js compiles routes per-request; a session id
  held in a naive module-level variable is re-initialized constantly, and the user is
  asked to log in on every single chart pan.
- **Discover tool names, don't hardcode them.** Match `tools/list` results by
  pattern (`/histor/`, `/quote|ltp/`, `/search|instrument/`, `/login|auth/`) so a
  server-side rename doesn't take the app down.

### 2.2 Authentication through MCP

The MCP server authenticates per session via a `login`-style tool that returns a
URL. The user opens it, completes Zerodha's flow, and the server binds the
authorisation to the `Mcp-Session-Id` you are already carrying.

Surface this properly, because getting it wrong is the single most common complaint:

- A **persistent connection badge** in the chart header showing one of: not
  configured / signed out / signed in as `<name>` / token expiring at `<time>`.
- Clicking it opens a panel. **The panel must render something useful in every
  state, including the unconfigured one** — if nothing is set up, it shows the setup
  checklist, not an empty box. A sign-in button that only appears once you're
  already configured is a sign-in button nobody can find.
- When a tool call comes back `isError: true` with text matching
  `/login|authenticat|session expired|unauthor/i`, map it to **HTTP 401** and let the
  UI prompt for sign-in. Do not report it as a 502.
  **Exempt the login tool's own response** — its reply naturally contains the word
  "login" and will otherwise trip your own detector.

### 2.3 REST fallback (Kite Connect v3)

MCP can be down, and some accounts are provisioned for REST only. Implement the
classic flow as a second provider behind the same interface:

```
GET  https://kite.zerodha.com/connect/login?v=3&api_key=…
  → redirects to your KITE_REDIRECT_URL with ?request_token=…
POST https://api.kite.trade/session/token
     api_key, request_token, checksum = sha256(api_key + request_token + api_secret)
  → { access_token, user_id, user_name }
```

- The redirect URL must match the Kite developer console **character for
  character**. Zerodha ignores any redirect passed at login time, so a mismatch
  presents as a login that lands somewhere strange rather than as an error. Make it
  a config value and validate its path at startup.
- Access tokens die at the next pre-open, **≈06:00 IST**. Compute and display the
  real expiry; don't pretend it lasts 24h.
- Historical candles require Zerodha's **historical-data subscription** on the API
  key. Being signed in is not the same thing — quotes will work while historical
  returns nothing. Detect this and say so in words, because the raw failure is
  indistinguishable from "no data for this symbol".

### 2.4 Provider interface

One interface, several implementations, selected by `MARKET_PROVIDER`
(`auto | kite-mcp | kite-rest | synthetic`):

```ts
interface MarketProvider {
  info: { id: string; label: string; live: boolean };
  candles(req: { symbol: string; interval: Interval; from: Date; to: Date }): Promise<MarketCandle[]>;
  quote(symbols: string[]): Promise<Record<string, Quote>>;
  search(query: string): Promise<Instrument[]>;
}
```

`synthetic` generates plausible bars so the UI is developable without credentials.
It must be **loudly labelled as synthetic everywhere it appears**, and it must never
be written into any shared cache. A synthetic bar that leaks into a real dataset is
a bug you will find months later, on a chart you trusted.

### 2.5 Timezone — get this right on day one

NSE trades 09:15–15:30 IST. Kite returns timestamps with a `+0530` offset.
`lightweight-charts` plots UTC. If you pass epoch seconds straight through, every
chart reads 03:45 and every intraday wave count is five and a half hours wrong.

Write `toChartTime()` / `fromChartTime()` that shift by the exchange offset, use
them at **every** boundary (fetch, render, export, import), and test them against a
`+0530` fixture. Never do this arithmetic inline.

### 2.6 Caching and rate limits

Kite's historical endpoint is rate-limited and every pan would otherwise burn a
request. Resolve `/api/market/candles` in this order:

1. **Fresh cache** → serve immediately.
   Freshness: daily allows ~4 days' slack (weekends, holidays); intraday allows
   `max(2 intervals, 15 min)`.
2. **Broker** → fetch, merge with cache, write back.
3. **Broker unreachable** → serve stale cache **with an explicit warning banner**.
   A stale chart with a warning beats a blank one; a stale chart without a warning
   is worse than either.

Merging rule: on a timestamp collision the **broker's bar wins** — its copy of a
forming candle is newer than anything stored.

Live quotes poll every 15s and extend the last bar in place. Pause polling when the
tab is hidden and outside market hours.

---

## 3. Chart surface

- **Candlestick** as the default, with Heikin-Ashi, line and area available. Elliott
  work needs real highs and lows for pivots, so candlestick is the honest default —
  but expose **log scale**, which genuinely matters for multi-year counts, and make
  the setting per-terminal.
- **Terminal layout switch: 1 chart or 2 charts.** Two is the default because
  Elliott is a multi-timeframe discipline. Each terminal owns its symbol, interval,
  drawings and indicators independently.
- Optional **link toggle** so terminal B follows terminal A's symbol at a lower
  degree — the standard "weekly next to daily" workflow, one click instead of two
  searches.
- Intervals: 1m, 3m, 5m, 15m, 30m, 1h, 1D, 1W, 1M.
- Crosshair readout showing OHLC, volume, change %, and **bar index** — Elliott time
  analysis counts bars, so the index must be visible, not inferred.
- Symbol search backed by the provider's instrument list, with exchange-qualified
  keys (`NSE:INFY`, `NSE:NIFTY 50`).

---

## 4. Elliott Wave drawing tools

Implement all five structure tools plus supporting geometry. In each, the **first
click sets an unlabelled origin** and subsequent clicks take the labels — this
matches TradingView and matches how counts are actually drawn.

| Tool | Clicks | Labels |
|---|---|---|
| Elliott Impulse Wave | 6 | 1 2 3 4 5 |
| Elliott Correction Wave | 4 | A B C |
| Elliott Triangle Wave | 6 | A B C D E |
| Elliott Double Combo Wave | 4 | W X Y |
| Elliott Triple Combo Wave | 6 | W X Y X Z |

Plus: trendline, horizontal line, **Fibonacci retracement**, **Fibonacci
extension**, and **parallel channel** (see §11).

### 4.1 Degrees

Nine degrees, each with its own notation and font size, applied to every drawing:

| Degree | Motive | Corrective |
|---|---|---|
| Grand Supercycle | `[I] [II] …` | `[Ⓐ] [Ⓑ] [Ⓒ]` |
| Supercycle | `(I) (II) …` | `(Ⓐ) (Ⓑ) (Ⓒ)` |
| Cycle | `I II III …` | `Ⓐ Ⓑ Ⓒ` |
| Primary | `① ② ③ …` | `Ⓐ Ⓑ Ⓒ` |
| Intermediate | `(1) (2) …` | `(A) (B) (C)` |
| Minor | `1 2 3 …` | `A B C` |
| Minute | `[i] [ii] …` | `[a] [b] [c]` |
| Minuette | `(i) (ii) …` | `(a) (b) (c)` |
| Subminuette | `i ii iii …` | `a b c` |

Degree is a property of the drawing, changeable after the fact — the label text and
size must re-derive from it, never be baked in at creation. Provide
`childDegree()` / `parentDegree()` so drilling into a subwave picks the right degree
automatically.

### 4.2 Variants

Each structure tool carries a variant that changes which rules apply:

- **Impulse**: standard impulse, leading diagonal, ending diagonal, extended third,
  extended fifth, truncated fifth.
- **Correction**: zigzag, regular flat, expanded flat, running flat.
- **Triangle**: contracting, barrier, expanding, running.

Diagonals permit wave-4/wave-1 overlap. Everything else does not. **This is the
single most consequential switch in the app** — surface it prominently in the
drawing's inspector, not buried in a menu.

### 4.3 Interaction

Selectable, draggable per-handle, deletable, with undo/redo and a drawings list
panel showing type, degree, variant and validation status at a glance.

---

## 5. The rule engine — the reason this app exists

For every completed structure, compute and display a verdict. **Separate hard rules
from guidelines**: a hard-rule breach invalidates the count and must be shown in red
with the exact price that would fix it; a guideline breach is amber and advisory.

### Hard rules

- Legs alternate direction. A "wave 3" that continues in wave 2's direction is a
  mislabelled pivot, and catching it early saves the whole count.
- **Wave 2 never retraces more than 100% of wave 1.**
- **Wave 3 is never the shortest** of waves 1, 3 and 5.
- **Wave 4 never enters wave 1's price territory** — *skipped for diagonals.*
- Zigzag: B does not retrace beyond A's origin.
- Contracting triangle: each leg is shorter than the one two before it; E stays
  inside C.
- ABC: three legs, correct alternation.

### Guidelines

- Wave 2 typically retraces 50–61.8% of wave 1; wave 4 typically 38.2%.
- Wave 3 is most often 1.618× wave 1; when it extends, 2.618×.
- Wave 5 ≈ wave 1, or 0.618× the span of waves 1–3.
- **Alternation**: if wave 2 is sharp, wave 4 is usually flat, and vice versa.
- **Channeling**: 2–4 trendline with a parallel from 3 projects wave 5's terminus.
- Volume typically peaks in wave 3 and diverges in wave 5.
- Post-triangle **thrust** ≈ the widest leg of the triangle, measured from the
  breakout point.

### Verdict

Roll the results into `High / Medium / Low / Invalid`, driven by hard-rule
compliance first, then by how many Fibonacci price *and time* relationships land.
Show the reasoning as a list of sentences, not a score — an analyst needs to know
*which* guideline failed, and a number tells them nothing.

Always display the **invalidation price**: the single level at which this count is
dead. Draw it as a labelled line on the chart. It is the most actionable output the
app produces.

---

## 6. Fibonacci and Lucas, in price and in time

Price ratios: 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.618, 4.236.

Time analysis is what separates a real Elliott tool from a drawing app:

- Count the **bar span** of every leg.
- Match those counts against the Fibonacci series (1, 2, 3, 5, 8, 13, 21, 34, 55,
  89, 144, 233…) and the **Lucas series** (2, 1, 3, 4, 7, 11, 18, 29, 47, 76, 123,
  199…), with a **±1 bar tolerance**.
- Project forward from each significant pivot and find **time clusters** — dates
  where projections from several pivots coincide. Rank by how many independent
  projections converge.
- Show "bars since last pivot" and the next few key bar counts, so the analyst knows
  a turn window is approaching before it arrives.

One caution learned the hard way: a dense "master" list of every number from both
series matches almost any bar count below ~60 and is therefore worthless as
confirmation. Only count a **clean Fibonacci or Lucas hit** toward confidence.

---

## 7. Indicators

- **Bollinger Bands** — period and standard-deviation configurable, drawn as upper,
  middle and lower lines with a shaded band between.
- **EMA** — multiple instances, configurable period and colour. Ship 20/50/200 as
  presets.

Both per-terminal, both toggleable, both included in the export bundle.

---

## 8. Claude hand-off

An export dialog producing a bundle containing:

- Symbol, exchange, interval, provider, generated-at, and whether the data is live.
- Every drawing: type, variant, degree, pivots (time + price), leg lengths in points
  and percent, bar spans, retracement and extension ratios.
- Rule results — pass/fail per rule with the numbers that produced them.
- Time counts, Fibonacci/Lucas matches, and clusters.
- Indicator settings and their latest values.
- Open paper positions.
- **Candles, with a policy switch**: around the labelled pivots (default), recent
  only, all bars, or none. Default to the narrow window — it is the honest one, and
  a full year of 1-minute bars will blow any context budget.

Four outputs — Markdown to clipboard, JSON to clipboard, download, or write to a
file in the repo — and a matching **import** so a count Claude proposes can be
loaded straight back onto the chart. Include a suggested prompt in the Markdown
form so the round trip needs no explaining.

---

## 9. Paper trading

Simulated only. **Nothing in this application may place a real order.**

- Ticket prefilled from the selected wave: entry at the current price, stop at the
  count's invalidation level, target at the projected Fibonacci extension.
- **Validate the ticket before it can be submitted.** A long with its stop above
  entry is not a trade, and an auto-prefill will produce exactly that whenever the
  wave direction is misread. Refuse it with a clear message.
- Position sizing from account size and risk percentage.
- Bar-by-bar resolution against subsequent candles. **When a single bar spans both
  the stop and the target, resolve it as the stop** — assuming the good fill makes
  every backtest a fantasy.
- Costs: brokerage per side plus a turnover rate, configurable, defaulted to
  Zerodha's equity intraday schedule.
- P&L, win rate, average R, and a trade log tied back to the originating wave count.

---

## 10. Theme — Kite

Kite's design is worth copying because it is disciplined: white ground, 1px grey
rules, one blue, generous whitespace, and no ornament whatsoever. Numbers carry the
colour; the chrome does not.

```css
:root {
  --bg:            #ffffff;
  --bg-subtle:     #f9f9f9;   /* table stripes, panel headers */
  --bg-hover:      #f4f4f4;
  --border:        #e5e5e5;   /* every divider, 1px, never a shadow */
  --border-strong: #d8d8d8;

  --text:          #444444;   /* Kite's body text is grey, not black */
  --text-strong:   #222222;
  --text-muted:    #9b9b9b;

  --blue:          #387ed1;   /* brand: nav, links, active states */
  --buy:           #4184f3;
  --sell:          #ff5722;
  --profit:        #00b386;   /* also the up candle */
  --loss:          #eb5b3c;   /* also the down candle */
  --amber:         #f6a821;   /* guideline warnings */

  --radius:        3px;       /* Kite is almost square */
  --font:          "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-num:      "Inter", monospace;  /* tabular-nums on every price */
}
```

Rules to hold to:

- **Flat.** Borders separate things, not shadows. At most one subtle shadow, on
  modals.
- **Dense.** 13–14px body, 12px labels, ~28px table rows. Kite fits a lot on screen
  and never feels cramped, because the whitespace is in the margins, not the rows.
- **Tabular numerals everywhere** a price or quantity appears. Digits that shift
  width while streaming are the fastest way to look amateur.
- Buttons: solid blue for primary, plain bordered white for secondary, uppercase
  12px with letter-spacing for small actions.
- Top nav: white, 1px bottom border, brand blue for the active item — never a
  coloured bar.
- Chart: `#e5e5e5` grid, no background fill, candles in `--profit` / `--loss`,
  crosshair a thin grey dash.
- **Dark mode** matching Kite's: `#1a1a1a` ground, `#2a2a2a` panels, `#333` borders,
  `#c9c9c9` text, the same accents. Drive it from a `data-theme` attribute so the
  toggle wins over the system preference in both directions.

---

## 11. Recommended additions

Beyond the brief, and worth the effort:

1. **Alternate counts.** Let the analyst store a primary count and named
   alternates, each with a confidence and its own invalidation level, and switch
   between them. Real Elliott work is always two or three competing counts; an app
   that only holds one forces the analyst to lie to themselves.
2. **Auto-count proposal.** Detect swing pivots (ZigZag with a configurable
   threshold), enumerate candidate labellings, score them against §5, and present
   the top three as *drafts the analyst accepts or rejects*. Never auto-apply.
3. **Parallel channel tool**, with a one-click "channel from 2–4" that draws the
   base channel and its parallel through wave 3 — the guideline in §5 made
   operational.
4. **Invalidation alerts.** Browser notification when price comes within a
   configurable distance of an active count's invalidation level, or enters a time
   cluster window.
5. **Bar-replay mode.** Hide bars after a chosen date and step forward one at a
   time. The only honest way to practise counting, and it costs almost nothing once
   the data layer exists.
6. **Measure tool** — drag any two points for points, percent, bars, and elapsed
   time.
7. **PNG export** of the annotated chart, for sharing a count without sharing a
   file.
8. **Keyboard shortcuts** for tool selection, degree cycling, undo/redo, delete and
   layout switching. Charting is a keyboard discipline; a mouse-only tool is slow to
   use even when it is fast to build.
9. **Auto-save with named layouts** per symbol, so returning to a chart returns to
   the count.

---

## 12. Engineering notes

These are the failures this class of app produces reliably. Read them before you
start; each one costs hours to rediscover.

1. **Do not use the charting library's click subscription to place pivots.**
   `lightweight-charts` discriminates double-clicks by swallowing alternate single
   clicks — placing six pivots in a row silently loses three of them. Handle
   `pointerdown`/`pointerup` on the container yourself and treat movement under ~5px
   as a click.
2. **Do not rely on the browser to hit-test your SVG overlay.** With the overlay at
   `pointer-events: none` (which it must be, or the chart cannot pan),
   `elementFromPoint` returns the canvas beneath and every attempt to select or drag
   a drawing pans the chart instead. Write your own hit-test in JS: handles first at
   ~10px, then line segments at ~7px, topmost drawing first.
3. **Do not draw a filled band with an area series.** Area series fill to the
   baseline, so a Bollinger band floods the whole lower chart. Draw the band as an
   SVG polygon, sampling ≲400 points across the visible range.
4. **A wave label's decoration must be applied at render, from the drawing's current
   degree.** Rendering the bare label and decorating at creation time are both
   wrong; the second breaks the moment someone changes a degree.
5. **Do not export helpers from a Next.js route file.** Route modules only permit
   the known exports; a shared helper there fails the production build while passing
   `next dev`. Put them in `lib/`.
6. **Broker credentials never reach the browser.** The session endpoint reports
   *that* you are signed in and until when — never the token. Store it server-side;
   if you must use a file, write it `0600` and add it to `.gitignore` in the same
   commit that creates it. An access token can place orders.
7. **Module-level state does not survive request boundaries** under per-route
   compilation. A token or MCP session held only in memory appears to work, then
   vanishes on the very next request. Back it with something durable.
8. **Refuse order-shaped tools structurally.** Maintain a pattern that rejects
   `place_order`, `modify_order`, `cancel_order` and friends *in the MCP client
   itself*. Not a code review convention — a check in the call path, with a test.
9. **Make your own diagnostics honest.** A pre-flight that treats "fetch resolved"
   as "host reachable" will certify a machine behind an egress proxy that returns
   403 for everything. Check the body, not just the status.
10. **Test the parts that carry the risk**: rule evaluation across every variant,
    Fibonacci and Lucas matching at tolerance boundaries, timezone conversion,
    cache-freshness edges, candle merging, ticket validation, and stop-versus-target
    resolution on a bar that spans both.

---

## 13. Definition of done

Not "it compiles" — these, verified in a browser:

- [ ] A symbol search finds a real NSE instrument through the Kite MCP server.
- [ ] Historical candles for that symbol load onto both terminals, and **the time
      axis reads 09:15 for the opening bar**, not 03:45.
- [ ] Live quotes extend the last bar during market hours.
- [ ] The connection panel is discoverable and readable in all four auth states,
      including the unconfigured one.
- [ ] All five wave tools place their full point count without dropping a click.
- [ ] Drawings select and drag without panning the chart.
- [ ] A deliberately invalid count — wave 4 overlapping wave 1 — shows a red
      hard-rule failure naming wave 4 and the price that would fix it, and the same
      count marked as a diagonal shows no such failure.
- [ ] The layout switch moves between one and two terminals with no state loss.
- [ ] Bollinger Bands and EMA render correctly, and the band does not flood the
      pane.
- [ ] The export bundle round-trips: export, re-import, identical chart.
- [ ] A paper trade opens from a wave, resolves against later bars, and cannot be
      submitted with an impossible stop.
- [ ] Light and dark both look like Kite.
- [ ] Full test suite green.

## 14. Hard constraints

- **Never place a real order.** Not behind a flag, not in a test path, not "just
  for one call".
- **Never commit a credential** — API keys, secrets, access tokens, session files.
  Gitignore them as you create them.
- **Never write synthetic prices into a shared datastore.**
- Never disable TLS verification to work around a network problem.
- Every failure the user can hit must produce a sentence they can act on. "Request
  failed" is not an error message.
