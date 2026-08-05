# Scalper Window

A single-screen paper-trading workspace for fast NIFTY and BANKNIFTY options
scalping, at `/scalper`. Three synchronised charts, a compact option chain, a
keyboard-driven order pad and a realistic fill simulator.

**This build cannot place a real order.** There is no broker credential, no
order endpoint and no code path from a button to an exchange. Execution happens
entirely in `src/lib/scalper/engine/`, in the browser.

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:3040/scalper>. No sign-in, no database, no seeding — the
mock feed builds a session from your clock and the dashboard is usable
immediately.

Production build:

```bash
npm run build && npm start
```

Tests — 67 of them, covering the engine, the risk gate, the indicators and the
mock feed:

```bash
npm test
```

> **Do not run `npm run build` while `npm run dev` is running.** Both write to
> `.next`, and a production build will replace the chunks the dev server is
> serving, leaving a page that loads its HTML but never hydrates. `next.config.mjs`
> honours `NEXT_DIST_DIR` so a build can be sent somewhere else:
>
> ```bash
> NEXT_DIST_DIR=.next-build npm run build
> ```
>
> If it has already happened, restart the dev server — `next dev` rebuilds
> `.next` from scratch.

---

## What you see on load

If the exchange is open, the feed tracks the real clock. Outside market hours it
**replays the most recent session at 60×**, starting 40% of the way in — so
there is already an opening range, a meaningful VWAP and support/resistance to
read, and roughly four minutes of replay left before 15:30. A ribbon says so;
the workspace never pretends simulated data is live.

The journal starts with six sample completed trades so the win rate, the charges
line and the daily-loss gauge have something in them. They are built through the
same cost model as a real fill, so the arithmetic in the drawer adds up.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ header — status · IST clock · feed · P&L · paper badge · kill switch │
│ ticker — NIFTY 50 · BANKNIFTY · SENSEX · INDIA VIX                   │
│ controls — underlying · expiry · strike · timeframe · sync · instant │
│ ribbon — MARKET CLOSED / PRICES MAY BE STALE (only when true)        │
│ trend — 5m · 15m · 1h · daily traffic lights                         │
├────────────┬─────────────────────────┬────────────┬──────────────────┤
│ CALL chart │   INDEX chart (widest)  │ PUT chart  │  option chain    │
├────────────┴──────────┬──────────────┴────┬───────┴──────────────────┤
│ Call order card       │ Risk & P&L        │ Put order card           │
├───────────────────────┴───────────────────┴──────────────────────────┤
│ keyboard shortcuts                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

Built for a 1440p desktop and comfortable from about 1280px wide. The layout is
a fixed-height flex column: only the option chain and the position list scroll.

---

## Folder structure

```
src/lib/scalper/
  types.ts              Domain types — the contract between every module below
  config.ts             Contract specs, lot sizes, session hours, cost model,
                        risk limits, execution assumptions. Every tunable number.
  time.ts               Asia/Kolkata clock: phase, session bounds, chart-time
                        conversion, expiry maths
  format.ts             Display formatting (₹, lakh/crore, signed P&L)
  pricing.ts            Black-Scholes + a volatility smile, for the mock feed
  indicators.ts         EMA, VWAP, timeframe aggregation, previous-day range,
                        opening range, swing S/R, volume profile, MTF bias
  chartSync.ts          Imperative registry that shares zoom + crosshair
  store.ts              Zustand store — orchestration only
  hooks.ts              React bindings and per-tick derivations

  adapters/
    types.ts            MarketDataAdapter interface  ← the broker seam
    mock.ts             Mock feed (owns the tick timer)
    kite.ts             Kite Connect stub, with the five wiring points marked
    index.ts            createAdapter() — the one line to change to go live

  engine/
    charges.ts          Brokerage, STT, exchange, SEBI, stamp duty, IPFT, GST
    execution.ts        Fill price, slippage, mark price
    portfolio.ts        Signed positions, realised P&L, journal, SL/target
    risk.ts             Pre-trade gate: blocks and warnings

  mock/
    random.ts           Seeded PRNG (mulberry32 + Box-Muller)
    generator.ts        Spot walk, option chain, bid/ask, replay clock
    seedTrades.ts       Sample completed trades for the demo journal

src/components/scalper/
  ScalperWorkspace.tsx  Root — composes everything, owns the grid
  Header.tsx  TickerStrip.tsx  ControlBar.tsx  MtfStrip.tsx  StatusRibbon.tsx
  ScalpChart.tsx        The one chart component all three panes use
  SpotChartCard.tsx  OptionChartCard.tsx  OptionChainPanel.tsx
  OrderCard.tsx  RiskCard.tsx
  ConfirmDialog.tsx  JournalDrawer.tsx  SettingsDrawer.tsx
  ShortcutBar.tsx  NoticeStack.tsx  ui.tsx

src/app/scalper/        Route (layout + page)
tests/scalper-engine.test.ts   36 unit tests over the engine and indicators
```

Market data, execution, risk, charts and UI state are separate modules. The
store imports the engine; the engine imports nothing from React.

---

## Paper-trading engine

**Fills** are priced from the **mid**, not the touch:

```
mid   = (bid + ask) / 2
edge  = halfSpread × (1 + slippageSpreadFraction) + slippageTicks
BUY   = mid + edge          SELL = mid − edge
```

Slippage therefore reports everything you gave up versus fair value, including
the half-spread you crossed, instead of hiding it inside the fill price. It
always works against you, on both sides.

**Charges** are applied to every fill: ₹20 brokerage, STT on the sell side,
exchange transaction, SEBI turnover fee, stamp duty on the buy side, IPFT, and
GST on the service components only (never on STT or stamp duty). Rates live in
`config.ts` and are editable in Settings.

**Positions** are signed — positive long, negative short. Adding to a side
re-averages; reducing realises P&L on the closed slice and writes a journal row;
an order that crosses zero closes the old position and opens the remainder at
the fill price. Partial and complete exits are both supported. Entry charges are
allocated pro-rata to the slice being closed, so a partial exit does not book
the whole entry cost.

**Marks** use the price you could actually exit into: a long marks at the bid, a
short at the ask. Stops and targets are evaluated against that mark, not the LTP
print.

**Journal** rows carry entry and exit time, instrument, direction, quantity,
entry and exit price, stop-loss, target, charges, gross and net P&L, duration
and exit reason (manual, stop-loss, target, exit-all, kill switch). Open it from
the header; it is a drawer so it never crowds the pad.

---

## Risk controls

| Control | Behaviour |
| --- | --- |
| Max loss per trade | **Blocks.** Risk to the attached stop, in rupees |
| Max daily loss | **Blocks** new orders; exits still allowed; trips the kill switch |
| Max lots per order / max open lots | **Blocks** |
| Confirm before selling | Dialog on every sell — instant mode does **not** override it |
| Duplicate-order protection | **Blocks** the same contract + side inside 1.2s |
| Cooldown | More than 4 orders in 3s locks the pad for 5s |
| Stale price | **Warns** when the last tick is older than 6s |
| Market closed | **Warns** |
| Bid–ask spread | **Warns** above 1.5% of mid |
| Kill switch | Exits everything and blocks new orders until reset |

Blocked orders are recorded as rejected in the order log with the reason, rather
than silently resized or dropped.

Instant Order is off by default and requires accepting an explicit warning.

---

## Keyboard

| Key | Action |
| --- | --- |
| `↑` | Buy Call |
| `←` | Sell Call |
| `↓` | Buy Put |
| `→` | Sell Put |
| `Enter` | Confirm the open order dialog |
| `Esc` | Close any dialog or drawer |
| `Shift` + `X` | Exit all positions |

Shortcuts are ignored while the cursor is in a text field, so typing a lot count
never fires an order. With Instant Order off, an arrow key opens the
confirmation dialog rather than filling.

---

## Connecting a real broker

Everything the workspace needs from a feed is the `MarketDataAdapter` interface
in `src/lib/scalper/adapters/types.ts`. Implement it once and nothing in the UI,
the indicators or the engine changes.

`src/lib/scalper/adapters/kite.ts` is a stub with five marked sections:

1. **Instrument master** — `GET /instruments/NFO` returns every F&O contract
   (`instrument_token`, `tradingsymbol`, `expiry`, `strike`, `instrument_type`,
   `lot_size`). Parse once per session to build the token map.
2. **Historical seed** — `GET /instruments/historical/:token/minute` for the
   index and both selected legs. The socket only sends what happens from now on,
   so charts need bars that predate the connection.
3. **Streaming** — subscribe in `full` mode (`ltp` mode omits depth, and the
   order cards need bid/ask). A `full` tick carries `last_price`,
   `volume_traded`, `oi` and a five-level book: `depth.buy[0].price` is the bid,
   `depth.sell[0].price` the ask — exactly what `OptionQuote` wants.
4. **Resubscription** — `select()` fires when the user changes underlying,
   expiry or strike. Unsubscribe the old tokens, subscribe the new, keep the
   index subscribed throughout.
5. **Liveness** — set the state to `stale` when no tick arrives within
   `RiskSettings.staleAfterMs`; the header badge and the order guard both read
   `connectionState()`. Reconnect with backoff and re-seed history afterwards
   rather than assuming the gap was empty.

Then switch the factory:

```bash
NEXT_PUBLIC_SCALPER_FEED=kite
NEXT_PUBLIC_KITE_SOCKET_URL=ws://localhost:4010
NEXT_PUBLIC_KITE_REST_URL=https://api.kite.trade
```

It defaults to the mock feed, so a stray env var cannot silently point a paper
UI at a live subscription.

**Hold the broker session server-side.** The recommended shape is a small Node
process that owns the Kite `KiteTicker` connection and rebroadcasts ticks over a
local WebSocket. The API secret and access token never reach the browser, and
one connection serves every open tab. The same seam accepts a Kite MCP bridge if
you are already driving quotes through the MCP session in
`.kite-mcp-session.json`.

**Keep execution simulated.** `kite.ts` must never call `placeOrder`. Every
arrow key in this app is wired to the paper engine; pointing that at a live
order API would make an accidental keypress a real position. If you do add live
execution later, it belongs behind its own adapter, its own confirmation path
and its own kill switch — not inside the market-data adapter.

---

## Mock data

`mock/generator.ts` produces a plausible NSE session:

- A geometric random walk per underlying with per-session drift and a U-shaped
  intraday volatility and volume curve (busy at the open and close, thin at
  lunch), seeded so a refresh does not redraw a different past.
- Six sessions of 1-minute history plus 60 daily bars, aggregated on demand into
  3m / 5m / 15m / 1h.
- Option premiums priced through Black-Scholes with a volatility smile and a put
  skew. **Option candles are derived from the spot candles** — each bar's O/H/L/C
  is repriced — so a CE breakout lines up with a spot breakout, which is the
  whole point of the three-pane layout. Only the forming bar is recomputed per
  tick; closed bars are cached.
- Bid/ask spreads that widen as the premium thins, which is what punishes a
  scalper chasing a four-rupee far-OTM strike.
- SENSEX shadows NIFTY; INDIA VIX leans against it and mean-reverts.

Restart the replay from Settings → Session.

---

## Known limitations

- **Market orders only.** No limit or stop orders reach the book; stop-loss and
  target are engine-side triggers that fire a market exit at the current mark.
- **No margin model for short options.** Selling is allowed and warns clearly,
  but no SPAN/exposure margin is blocked or checked.
- **State is in memory.** A refresh clears positions, orders and the journal and
  re-seeds the demo trades. Nothing is persisted.
- **Support/resistance is swing-pivot only** — clustered highs and lows on the
  visible series, not volume- or session-weighted.
- **The volume profile is an even distribution** of each candle's volume across
  the bins it spans, not a tick-level profile.
- **Greeks are not surfaced.** IV is shown; delta is computed in `pricing.ts` but
  not displayed.
- **No end-to-end browser test.** The engine, risk gate and indicators have 36
  unit tests; the React flow has been verified manually, not automated.
