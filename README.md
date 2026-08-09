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
| GET | `/api/market/candles` · `/api/market/quote` · `/api/market/search` | Zerodha-backed market data for Wave Lab |
| GET/POST | `/api/wave/analysis` | save and list Elliott Wave analyses under `data/wave-analyses/` |

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

## Other modules in this app

Three trading modules live alongside the recommendations admin. None of them can
place an order — the trading pads are simulated by construction, and Wave Lab is
read-only analysis.

| Route | Module | Docs |
|-------|--------|------|
| `/wave-lab` | Wave Lab — two chart terminals with the full Elliott Wave toolset, Fibonacci/Lucas rule checking, Bollinger Bands and EMAs, fed from Zerodha and exportable to Claude | [WAVE_LAB.md](WAVE_LAB.md) |
| `/paper-trading` | Historical bar-by-bar replay with a Supabase-backed ledger | [PAPER_TRADING.md](PAPER_TRADING.md) |
| `/scalper` | Scalper Window — single-screen NIFTY/BANKNIFTY options scalping pad, mock feed, no sign-in | [SCALPER_WINDOW.md](SCALPER_WINDOW.md) |

## Not in this MVP (scoped out; extend later)

Auth/roles (viewer/editor/admin) are stubbed to a single env-based admin. Settings/Sources registry, webhook secret, and the optional future fields (`bias`, `entry`, `stop_loss`, `target`, `tags[]`) are deferred — the schema and API are shaped so they can be added without a redesign.

## Notes

- Source data quality: some "stock names" are actually note headlines (e.g. "Trade Setup", "BPCL and Kotak Bank SL update"). Use the Stocks **merge** tool to clean these.
- Deleting a recommendation leaves its Stock master row in place (stocks are managed independently on the Stocks page).
