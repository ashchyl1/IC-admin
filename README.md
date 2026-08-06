# IndiaCharts Recommendations Admin

Admin portal for stock-market recommendation records — replaces spreadsheet editing with a CRUD web app, keeps Excel import/export, and accepts JSON feeds from a website/CMS.

Built per the product brief (Option A stack): **Next.js 14 (App Router) + TypeScript + Tailwind + Prisma/SQLite**. Route Handlers under `/api/*` are the backend; the same shapes work for external Excel-integration scripts.

## Quick start

```bash
npm install
npx prisma generate
npx prisma db push        # creates prisma/dev.db (SQLite)
npm run seed              # loads data/source.xlsx -> 336 recs, 145 stocks
npm run dev               # http://localhost:3040
```

Handy scripts: `npm run db:reset` (force-reset schema + reseed).

## Environment (`.env`)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | `file:./dev.db` locally. For prod, set a `postgresql://` URL and change `provider` in `prisma/schema.prisma` to `postgresql`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | MVP single-admin placeholders. Wire real auth before any shared deployment. |

## Pages

- **/** Dashboard — KPI cards (total, unique stocks, this-month, % summary/chart filled) + recent activity + quick actions.
- **/recommendations** — filterable/sortable/searchable table; date range, stock, status, source, "missing summary/chart"; row + bulk actions (export selected, mark closed, delete). Deep-linkable via `?stock=slug&status=…`.
- **/recommendations/[id]** & **/new** — editor: stock autocomplete, date, subject (required), validated link, **markdown summary with preview**, **chart image URL + drag-drop upload**, status, source.
- **/stocks** — master list with counts, inline edit of display name/symbol, and **alias merge** (select 2+, merges into the one with the most recs).
- **/import-export** — upload `.xlsx` with a **dry-run preview** (new / update / invalid) before commit; multi-sheet export; JSON-feed docs.
- **/nifty-weekly** — feed of weekly Nifty calls (Supabase-backed): add/edit/delete, chart screenshot, levels, wheel-navigable full view.
- **/nifty-timeline** — six months of Nifty daily bars wired to the Indiacharts recommendation casebook. **Click any bar** (or focus the chart and use ←/→) and the panel shows the call that was live when that bar printed, in the document's own words: published view, target, reversal, reasoning, and what would have confirmed or invalidated it. Regime bands tint the chart by published trend, and the active call's levels are drawn across the plot. See [Nifty timeline data](#nifty-timeline-data).

## API

| Method | Route | Notes |
|--------|-------|-------|
| GET/POST | `/api/recommendations` | list (filters, search, sort, paging) / create |
| GET/PUT/DELETE | `/api/recommendations/[id]` | single record |
| POST | `/api/recommendations/bulk` | `{ids, action: "delete"\|"setStatus", status?}` |
| GET | `/api/stocks` · PUT `/api/stocks/[id]` · POST `/api/stocks/merge` | stock master |
| GET | `/api/stats` | dashboard KPIs |
| POST | `/api/import[?dryRun=1]` | `.xlsx` (multipart) **or** JSON `{rows:[…]}` feed |
| GET | `/api/export` | multi-sheet `.xlsx` (honors `?ids=` or list filters) |
| POST | `/api/upload` | chart image → `/public/uploads`, returns `{url}` |

### JSON feed example

```bash
curl -X POST http://localhost:3040/api/import \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"stock_name":"Infosys","date":"2026-07-15",
       "subject":"Infosys breakout","link":"https://articles.indiacharts.com/…",
       "summary":"Thesis…","source":"website","status":"active"}]}'
```

Rows are matched to existing records by **subject + date**; matches update (filling summary/chart/link), the rest are created. Every import writes an `ImportLog` row (visible in the exported `Import_Log` sheet).

## Multi-sheet export

`Recommendations` (normalized w/ ids) · `Consolidated` (original 6-col schema) · `Stocks` (master + counts) · `Sources` (registry + counts) · `Import_Log` (audit) · `Lookups` (allowed status/source values).

## Nifty timeline data

`/nifty-timeline` reads two committed files — there is nothing to fetch at runtime:

| File | What it is |
|------|-----------|
| `src/lib/nifty-timeline/recommendations.ts` | The fifteen dated entries (fourteen Sunday updates + the 12 May mid-week note), parsed out of `Indiacharts_Nifty_Recommendation_Timeline.docx` rather than retyped, so the panel quotes the document verbatim. |
| `src/lib/nifty-timeline/nifty-daily.json` | The daily bar series, with a `source` field the page prints on screen. |

```bash
node scripts/build-nifty-daily.mjs             # fetch real ^NSEI bars; falls back offline
node scripts/build-nifty-daily.mjs --offline    # skip the network
node scripts/build-nifty-daily.mjs --months 12  # wider window
```

The committed series is **`"reconstructed"`**, not market data — the machine that
generated it had no egress to a market-data host. Its swings are the levels the
casebook actually names (the 22,183 April low, the 24,602 April high the May notes
keep measuring against, the 23,344 May low, the lower 23,178 June low, the
23,400–24,600 July range, the late-July retest of the 61.8% at 23,600, and the
rebound that stalls under the 24,515 confirmation), but intra-week paths are
synthesised and NSE trading holidays are not modelled. The page labels it as such.
Re-run the script with network access to overwrite it with real bars; nothing else
has to change.

Edit `WEEKS` in the script to correct the reconstruction — the daily path follows
from it, and the generator is seeded, so a re-run is byte-identical.

## Other modules in this app

Two trading modules live alongside the recommendations admin. Both are **paper
trading only** — no broker is connected and no real order can be placed.

| Route | Module | Docs |
|-------|--------|------|
| `/paper-trading` | Historical bar-by-bar replay with a Supabase-backed ledger | [PAPER_TRADING.md](PAPER_TRADING.md) |
| `/scalper` | Scalper Window — single-screen NIFTY/BANKNIFTY options scalping pad, mock feed, no sign-in | [SCALPER_WINDOW.md](SCALPER_WINDOW.md) |

## Not in this MVP (scoped out; extend later)

Auth/roles (viewer/editor/admin) are stubbed to a single env-based admin. Settings/Sources registry, webhook secret, and the optional future fields (`bias`, `entry`, `stop_loss`, `target`, `tags[]`) are deferred — the schema and API are shaped so they can be added without a redesign.

## Notes

- Source data quality: some "stock names" are actually note headlines (e.g. "Trade Setup", "BPCL and Kotak Bank SL update"). Use the Stocks **merge** tool to clean these.
- Deleting a recommendation leaves its Stock master row in place (stocks are managed independently on the Stocks page).
