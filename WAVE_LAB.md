# Wave Lab

Two chart terminals with the full Elliott Wave toolset, fed from Zerodha, with
every count rule-checked and exportable to Claude.

**Route:** `/wave-lab` · **Analysis only** — nothing in this module can place an
order, and the Kite MCP provider refuses to call any tool whose name looks like
an order path.

---

## One chart or two

Elliott work is comparative. A count that only survives on one timeframe is not
a count, and Phase 6 of the analysis SOP — multi-timeframe confirmation — is a
glance rather than a task when the higher degree and the trading timeframe are
side by side. The panes open on NIFTY daily and NIFTY hourly; each carries its
own instrument, interval, chart type, indicators and wave count. **Sync charts**
ties their pan, zoom and crosshair together.

The layout control in the header offers **one chart**, **two side by side**, or
**two stacked**. In single view a chip row names the two terminals so you can
swap between them; both keep loading and keep their counts either way, so
switching back is instant and nothing is lost. Narrow screens start in single
view with the inspector folded away.

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
  paper.ts               simulated positions, costs, R multiples, exits
  paper-levels.ts        open positions as chart price lines
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

## Deploying it

The Wave Lab itself is host-agnostic: the page is client-rendered and its only
server dependency is `/api/market/*`, which is stateless. It runs on Vercel,
Netlify, Cloud Run or any Node host with no changes.

Two caveats about deploying **the wider app**, neither specific to this module:

- **The recommendations admin uses Prisma against SQLite** (`DATABASE_URL=file:./dev.db`).
  Serverless filesystems are read-only and ephemeral, so those pages need a
  hosted Postgres and a `provider` change in `prisma/schema.prisma` before the
  app as a whole works on Vercel. `/wave-lab` does not touch Prisma and is
  unaffected.
- **Saving analyses into the repository is a local-development affordance.** On a
  read-only host `POST /api/wave/analysis` returns 501 with an explanation and
  `GET` returns an empty list; Copy JSON and the `.json` download carry the
  identical document and work everywhere.

## Paper trading

**Simulated only** — no broker is connected and nothing in this module can place
an order.

The **Paper** tab beside the inspector turns a count into a trade. The ticket is
prefilled from the selected count rather than from nothing:

- **Stop** — the count's own invalidation level, with the reason shown ("End of
  wave 1 — wave 4 entering this level invalidates the impulse").
- **Target** — a 1.618 projection of the pattern's first leg from its last pivot.
- **Side** — the direction the count runs.
- **Quantity** — from a risk budget: type what you are willing to lose and the
  ticket sizes the position off the distance to the stop.

The ticket refuses an incoherent order. A long whose stop sits above its entry
is not a risky trade but an impossible one, and the prefill can suggest exactly
that when the count sits well away from spot — so the levels are checked against
the side and the submit button stays disabled until they agree.

Open positions draw their entry, stop and target on the chart as solid lines
(analysis stays dashed), and are settled from the same 15-second quote poll that
moves the chart: when a bar trades through a level the position closes itself.
**A bar spanning both the stop and the target is resolved as the stop** — OHLC
cannot say which came first, and a paper engine that guesses in its own favour
teaches the wrong lesson.

The journal keeps entry, exit, reason, P&L after costs, R multiple, and the wave
count each trade was taken on. Costs default to ₹20 a side plus 0.06% of
turnover — adjust `DEFAULT_COSTS` in `src/lib/wave/paper.ts`; the point is that a
paper P&L ignoring costs flatters every strategy.

Trades ride along in the Claude export, so a review can ask both whether the
count was right *and* whether it was traded well.

---

### Connecting to Zerodha MCP

**Connecting is two stages, and the badge in the header shows which one you are
on.** There is no sign-in button until an endpoint is configured, because until
then there is nothing to sign in to.

| Badge | Meaning | Next step |
|---|---|---|
| **Connect data** (amber) | No broker configured; charts are simulated | Open it — the panel lists the two env lines to add |
| **Sign in to Kite** (amber) | Endpoint configured, session not authorised | Click it; a Kite tab opens, then choose Reload data |
| **Zerodha** (green) | Authorised and serving data | Nothing |
| **Data status** (red) | The status check itself failed | Open it for the error |

Stage one is `.env` plus a restart:

```bash
MARKET_PROVIDER=kite-mcp
KITE_MCP_URL=https://mcp.kite.trade/mcp   # or your own bridge
```

Env vars are read once at boot, so the dev server has to be restarted — a
running one will keep reporting "Connect data" no matter what you put in the
file.

Stage two is the sign-in. Kite MCP binds an authorised Kite session to the MCP
session id, so connecting is a browser round trip: the provider calls the
endpoint's `login` tool, you open the URL it returns, sign in, and come back.

Because the session lives on the provider instance, providers are **cached per
endpoint** — a fresh one per request would sign in on one session and then query
on another, forever.

`GET /api/market/status` is the diagnostic. It reports the provider chain, the
tools discovered on the endpoint, which tool was picked for each job, and
whether the session needs a login — so pointing the app at a different MCP
endpoint is a glance rather than a debugging session:

```json
{
  "mode": "kite-mcp",
  "active": { "label": "Zerodha Kite MCP", "live": true },
  "diagnostics": {
    "ready": true,
    "discovered": ["login", "get_historical_data", "get_quotes", "search_instruments"],
    "resolved": { "historical": "get_historical_data", "quotes": "get_quotes", "search": "search_instruments" }
  }
}
```

**Testing without a broker.** `node scripts/mock-kite-mcp.mjs 4111` starts a
stand-in that speaks the real transport — session ids, SSE framing, Kite's tool
names and schemas, Kite's response shapes, and the signed-out refusal. Point
`KITE_MCP_URL` at it to exercise the whole path, including the login flow.
`tests/kite-mcp.test.ts` drives the provider against it on every test run.

---

## Kite Connect sign-in and the Supabase store

Two things that make the live data path actually usable day to day: a real
Zerodha login, and somewhere for the bars to live.

### Signing in with Kite Connect

`kite-mcp` is one route in; this is the other, and it is the one that works with
a plain Kite Connect app. Set the key **and secret**:

```bash
MARKET_PROVIDER=kite-rest
KITE_API_KEY=your_api_key
KITE_API_SECRET=your_api_secret
KITE_REDIRECT_URL=http://localhost:3040/api/kite/callback
```

`KITE_REDIRECT_URL` has to match the redirect URL registered on your Kite
developer console character for character — Zerodha ignores any redirect passed
at login time, so a mismatch shows up as a login that lands somewhere odd rather
than as an error.

Check it before you start — the sign-in fails in a handful of predictable ways,
and most of them look like a redirect that went nowhere rather than an error:

```bash
npm run kite:doctor
```

It verifies the key and secret are both set, that the redirect URL is
well-formed, that `api.kite.trade` and `kite.zerodha.com` are actually
reachable from this machine (a sandboxed or corporate network can deny egress
with a 403 that looks like a response), and whether a stored token is still
alive. It exits non-zero when something would block the login.

Then open the connection badge and choose **Sign in with Kite Connect**. The app
sends you to Zerodha, Zerodha returns a one-time `request_token`, and the app
exchanges it for an access token by proving it holds the secret
(`sha256(api_key + request_token + api_secret)`). Zerodha invalidates tokens at
the next pre-open, about 06:00 IST, so this is a once-a-day step; the panel shows
when the current one dies.

| Route | Purpose |
|---|---|
| `GET /api/kite/login` | Start the sign-in (redirects to Zerodha) |
| `GET /api/kite/callback` | Zerodha returns here; swaps the token and stores it |
| `GET /api/kite/session` | Is there a live token, whose is it, when does it die |
| `DELETE /api/kite/session` | Forget it |

**Where the token lives.** It is a credential — it can place orders — so it never
reaches the browser and `/api/kite/session` never returns it. In order of
preference it comes from `KITE_ACCESS_TOKEN` (an explicit override), the process
cache, Supabase, then a local `.kite-session.json` written `0600` and
git-ignored. That file is not belt-and-braces: module state does not survive
between requests under Next's per-route compilation, so an in-memory-only token
makes the login appear to succeed and then vanish on the very next request.

### Storing candles in Supabase

Set `SUPABASE_BRIDGE_KEY` alongside the existing `NEXT_PUBLIC_SUPABASE_*` vars
and the chart starts caching what it fetches.

It reuses the paper-trading module's `instruments` and `market_candles` tables
and its established write path: the bridge-key-gated `import_market_candles`
RPC from migration 0007, which exists precisely so a console can move candles
without being handed the service-role key. Migration 0012 adds the symmetric
`read_market_candles`, plus `bridge.kite_sessions` for the access token.

Apply them with `npm run paper:migrate`, then create the bridge key once:

```sql
insert into bridge.api_keys (name, key_hash)
values ('kite-console', extensions.crypt('<your key>', extensions.gen_salt('bf')))
on conflict (name) do update set key_hash = excluded.key_hash;
```

`/api/market/candles` then resolves in this order:

1. **Cache**, when the stored series is current for its interval — one interval
   of slack intraday, a long weekend for daily and above. Kite's historical
   endpoint is rate-limited and every pan would otherwise spend a request.
2. **Broker**, for anything missing, written straight back so the next request
   is cheap.
3. **Stale cache**, if the broker is unreachable — an expired token, an outage.
   The response says plainly that the bars are stored and why they may be
   behind, which beats a blank chart.

Only live prices are ever written. The synthetic fallback is never persisted,
and `/api/market/sync` refuses outright rather than poisoning shared reference
data with invented bars.

**Back-filling.** The connection panel's *Back-fill* button pulls ten years for
the focused chart in one go, so a Primary-degree count is not waiting on a
rate-limited broker. The same thing over HTTP:

```bash
curl -X POST http://localhost:3040/api/market/sync \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"NSE:NIFTY 50","interval":"day","days":3650}'
```

**Testing without a broker.** `node scripts/mock-kite-rest.mjs 4222` stands in
for Kite Connect: it verifies the login checksum the way Zerodha does (a wrong
secret gets ``Invalid `checksum` ``), serves historical candles with `+0530`
timestamps, quotes and the instrument CSV. Point `KITE_API_URL` at it to
exercise the whole sign-in without an account.

---

### Deploying to Vercel

The repository needs no Vercel-specific config — Next.js is detected, and
`prisma generate` runs from `postinstall` so a cached `node_modules` cannot
leave a stale client behind.

1. **vercel.com → Add New → Project → Import** `ashchyl1/IC-admin`.
2. Leave the framework preset (Next.js), build command and output directory
   alone.
3. Add environment variables before the first deploy:
   - `MARKET_PROVIDER` — `kite-mcp`, `bridge`, `kite-rest`, or leave unset for
     `auto`.
   - the credentials for whichever provider you picked (see the table above).
   - `MARKET_ALLOW_SYNTHETIC=0` so a misconfigured provider fails loudly rather
     than drawing invented prices.
   - `DATABASE_URL` — only if you want the recommendations pages too; it must be
     a `postgresql://` URL, with `provider` in `prisma/schema.prisma` changed to
     match. `/wave-lab` does not read it.
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` —
     only if you want `/paper-trading`; its middleware needs them.
4. Deploy, then open `/wave-lab` on the generated URL.

A local bridge on `localhost:8000` is not reachable from Vercel's servers. With
`MARKET_PROVIDER=bridge` the bridge has to be on a public hostname, which is a
good reason to prefer `kite-mcp` or `kite-rest` for a hosted deployment and keep
the bridge for local work.

### Standalone build (no server)

`npm run build:artifact` bundles the workspace into a single self-contained HTML
file at `artifact/wave-lab.html` — React, Lightweight Charts and every
application module inlined, with the market client swapped for the in-browser
generator in `src/lib/market/offline-client.ts`. Roughly 450 KB, no network
required at any point.

Every drawing tool, the degree notation, the rule engine, the Fibonacci and
Lucas checks, the indicators and the Claude export work unchanged. What it
cannot do is reach Zerodha, so it runs on generated data and says so in a banner
across the top. Useful for sharing the tooling with someone who should not be
handed broker credentials, and for reviewing a build without running the app.

The build output is git-ignored; the source is `artifact/entry.tsx` and
`scripts/build-artifact.mjs`.

### Before putting it on a public URL

This app has no authentication — `ADMIN_EMAIL`/`ADMIN_PASSWORD` are placeholders
and nothing enforces them. A public deployment with `KITE_ACCESS_TOKEN` or
`KITE_MCP_URL` set turns `/api/market/*` into an open proxy onto your broker
session: anyone with the URL can pull instrument data against your Zerodha
account, and rate limits are charged to you. Put it behind access control
(Vercel password protection, Cloudflare Access, or real auth) before sharing the
link, or deploy without broker credentials and let it serve simulated data.

---

## Tests

`npx vitest run` — 191 cases, of which this module owns:

- `tests/wave-rules.test.ts` — the rule engine (every hard rule, both
  directions, each variant), metrics, the Fibonacci/Lucas tables, indicators,
  degree notation and hit-testing.
- `tests/wave-paper.test.ts` — the paper engine: P&L both ways, costs, R
  multiples, position sizing, exit triggers (including the stop-wins rule for a
  bar that spans both levels), the portfolio summary and ticket validation.
- `tests/kite-mcp.test.ts` — the MCP provider against the mock server:
  handshake, tool discovery, the signed-out path, login, candles, quotes,
  search, `+0530` timestamps, and the read-only guard.
