# Paper trading & historical replay

A second module inside this Next.js app, at `/paper-trading`. It replays stored
OHLCV history bar by bar and lets you trade against it with simulated orders.

**This is paper trading only.** No broker is connected and no real order is ever
placed.

---

## Quick start

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(Project Settings → API Keys), then:

```bash
npm run dev
```

Open <http://localhost:3040/paper-trading>, create an account, and start a
session. A demo instrument (`TEST:DEMO`, 60 daily candles) is already seeded, so
you can trade immediately without importing anything.

Production build:

```bash
npm run build && npm start
```

---

## Database

Migrations live in `supabase/migrations/` and are already applied to the linked
project. To apply them elsewhere:

```bash
supabase db push
```

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Reset (destructive — drops all paper-trading data):

```bash
supabase db reset && psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Regenerate types after any schema change:

```bash
supabase gen types typescript --project-id <project-ref> > src/lib/supabase/types.ts
```

### Tables

`profiles`, `instruments`, `market_candles`, `replay_sessions`, `paper_orders`,
`paper_fills`, `paper_positions`, `trade_journal`, `equity_snapshots`.

All money, price, quantity and fee columns are `numeric`, never float. All
timestamps are stored UTC and rendered in the instrument's market timezone.

One deliberate rename: the brief's `replay_sessions.current_timestamp` is
`current_simulated_at`, because `CURRENT_TIMESTAMP` is a reserved SQL keyword.

### RPCs

| Function | Purpose |
| --- | --- |
| `create_replay_session(...)` | Validates the window, counts bars, opens the position row, releases warmup |
| `submit_paper_order(...)` | Validates and queues a market order (or records the rejection) |
| `cancel_paper_order(id)` | Cancels a pending order |
| `advance_replay(id, bars, request_id)` | Atomically releases 1–3 bars: fills, position, cash, journal, equity |
| `set_session_status(id, status)` | running / paused / ended |
| `set_session_speed(id, speed)` | 1, 2 or 3 bars per second |
| `restart_replay_session(id)` | Wipes results and rewinds to the warmup point |
| `get_session_state(id, since_bar?)` | Everything the UI needs, in one round trip |
| `session_performance(id)` | Metrics derived from persisted fills and snapshots |

---

## Security model

- RLS is enabled on every table. Every policy is `TO authenticated` plus an
  ownership test on `auth.uid()`; `anon` gets nothing anywhere.
- **The ledger is read-only to the browser.** `paper_orders`, `paper_fills`,
  `paper_positions` and `equity_snapshots` have SELECT policies and no
  INSERT/UPDATE/DELETE policy, and those privileges are revoked outright. Only
  the `SECURITY DEFINER` engine writes them, and it re-checks `auth.uid()`.
- `trade_journal` is updatable, but a trigger rejects any change to an
  engine-owned column. The boundary is the database **role** (`authenticated`
  can never be the definer), not a session variable — an earlier GUC-based guard
  was replaced because `set_config(..., true)` lasts the whole transaction and a
  client write could have ridden along inside an engine transaction.
- Engine internals live in the `engine` schema, which is not exposed to the Data
  API, with EXECUTE revoked from `public`, `anon` and `authenticated`.
- Only the publishable key reaches the browser. `SUPABASE_SERVICE_ROLE_KEY` is
  used by one server route (CSV import) via `src/lib/supabase/admin.ts`, which
  imports `server-only` so the build fails if it is ever pulled client-side.

`get_advisors(security)` reports the nine paper-trading RPCs as callable by
`authenticated`. That is intentional — they are the application's only write
path and each verifies ownership before touching a row.

---

## Execution rules

**Fill policy.** An order submitted while viewing bar *N* is `pending` and fills
at bar *N+1*'s **open**, once that bar is released. Slippage always works
against you: buys fill at `open + slippage`, sells at `open − slippage`. If the
replay reaches the last candle with an order still pending, the order is
cancelled with a stated reason. No order ever fills against a bar that has not
been released.

**Positions** are signed: positive is long, negative is short. Buys reduce
shorts and extend longs; sells do the reverse. Partial exits and partial covers
are supported. Crossing zero in one order (reversal) is **blocked by default** —
enable "Allow position reversal" per session.

**Cash and margin.**

```
BUY  ->  cash -= qty × fill_price ;  cash -= fees
SELL ->  cash += qty × fill_price ;  cash -= fees
Equity = cash + signed_quantity × price
```

Shorts credit cash on entry and debit on cover. Opening or increasing a short
requires cash ≥ notional — a flat 100% margin requirement, chosen so one
arithmetic path serves both directions and this identity holds at every bar:

```
equity = starting_capital + net_realized_pnl + unrealized_pnl
```

That identity is asserted by the test suite on every snapshot.

**Costs** are per-session configuration, never hard-coded. Presets live in
`src/lib/paper/types.ts`; the exact model used is recorded on the session and
shown under *Session details*.

**Look-ahead safety.** The chart, the price scale and every metric are fed only
from candles the engine has released. `get_session_state` filters candles to
`bar_index <= current_bar_index` in SQL, so a future bar cannot reach the client
even in principle.

---

## Importing history

`/paper-trading/import` takes any OHLCV CSV: pick the file, map the columns
(auto-detected for common exports), choose the timezone for naive timestamps and
the timeframe, review the validation preview, then import.

Rows are rejected — with line numbers and reasons — when a price is
non-positive, the high is below open/low/close, the low is above open/high/close,
volume is negative, or the timestamp is unparseable. Duplicate timestamps within
the file collapse to the last occurrence; duplicates against the database upsert
in place. Out-of-order files are sorted, and the preview says so.

Import needs `SUPABASE_SERVICE_ROLE_KEY` set server-side, because market data is
deliberately not writable by browser clients.

---

## Testing

```bash
npm test
```

21 unit tests covering CSV parsing, header detection, timezone conversion
(including a DST boundary and epoch forms) and every OHLC validation rule.

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/engine_tests.sql
```

The engine suite, which runs inside a transaction and rolls back. It asserts:
long round trip, short round trip, average entry across multiple entries,
partial exit, slippage and fee arithmetic to the paisa, reversal blocked,
long-only enforced, insufficient buying power, duplicate `client_order_id`
idempotency, replayed `advance_replay` not double-advancing, MFE/MAE, both
equity identities on every snapshot, RLS isolation between two users, and four
ledger-tampering attempts from the `authenticated` role.

---

## Keyboard

`Space` play/pause · `→` step one bar · `1`/`2`/`3` speed · `B`/`S` open the
order dialog · `Esc` close it. No single keypress ever sends an order — `B` and
`S` open the confirmation dialog.

---

## Known limitations

- **Market orders only.** Limit, stop and bracket orders are not implemented.
- **Session-level intraday gaps are not detected.** The engine replays whatever
  candles exist in the window; a missing bar is simply absent rather than
  flagged.
- **`market_open` / `market_close` are stored and displayed but not enforced** —
  they do not currently reject orders outside session hours.
- **No integration or end-to-end browser test.** Engine behaviour is covered by
  the SQL suite and the CSV layer by unit tests, but the React flow
  (sign in → create → play → trade → refresh) has not been automated.
- **Chart screenshots** for journal entries are modelled (`screenshot_path`) but
  no upload UI exists yet.
