# IndiaCharts Admin — UI/UX Audit Report

**Date:** 2026-07-18
**Scope:** Complete `indiacharts-admin` application (Next.js 14 App Router, Tailwind CSS, Prisma/SQLite)
**Method:** Full source review of every page, component, API route and style file, plus live inspection of the running app (desktop 1280×720 and mobile 375×812) with seeded data (338 recommendations, 146 stocks).

Findings are labelled **[Verified]** (observed in code or in the running app) or **[Suggestion]** (optional design improvement).

---

## A. Executive Summary

The application is a compact, well-engineered single-purpose admin: manage stock recommendations, the stock master list, and Excel/JSON import-export. For an MVP the foundations are unusually good — a token-based design system (shadcn-style HSL CSS variables), a small set of shared primitives (`Card`, `Button`, `Input`, `Select`, `Badge`, `Modal`, toast), request-race guards on list fetching, dry-run import previews, and a genuinely capable markdown editor with Word/Docs paste conversion.

**Strengths**

- Consistent visual language: one card style, one button system, one badge system, tokenised colours (`src/app/globals.css`, `tailwind.config.ts`).
- Sensible information architecture: 4 top-level sections, shallow routes, list → view/edit flows.
- Real workflow features many admin MVPs miss: bulk actions, dry-run import, stock merge, paste-with-formatting, zoomable chart images.

**Key weaknesses (highest impact first)**

1. **Accessibility gaps** — icon-only actions with no accessible names on the Stocks page, unlabeled table checkboxes, toasts that screen readers never announce, no focus trap in modals, colour-only "S/C" field indicators, 16×16px click targets in table rows. [Verified]
2. **Data-loss risk** — the recommendation form has no unsaved-changes guard; one accidental back/refresh silently discards a long editorial summary. [Verified]
3. **The stock filter is unusable at current data scale** — a native `<select>` with 146 options polluted by non-stock entries ("N/A (39)", "Trade Setup (21)", "Rich Test (0)", "BPCL and Kotak Bank SL update") and duplicate pairs (INFY/Infosys, OBEROIRLTY/Oberoi Realty, 4 Tata Motors PV variants). Partly a data-quality issue the existing merge tool can fix, partly a component problem. [Verified]
4. **Filters are not shareable/persistent** — the list reads filters from the URL on load but never writes them back, so refresh or back-navigation loses state. [Verified]
5. **Inconsistent action patterns** — Edit is a text link while View/Delete are icons; the dashboard offers only "Edit"; nested `<Link><Button>` produces invalid interactive-inside-interactive HTML. [Verified]
6. **Mobile tables** — 993px-wide table in a 375px viewport puts Actions ~600px off-screen with no sticky header and no visual affordance that scrolling is possible. [Verified]
7. **Dead/incomplete features** — dark-mode tokens fully defined but no toggle anywhere; the import page `Stat` component accepts an `icon` prop and never renders it; unused imports. [Verified]

The right strategy is **not** a redesign. The design system is sound; the work is (1) fix accessibility and data-loss issues, (2) standardise the action/row patterns that already exist, (3) fix the stock-picker scale problem, (4) polish states (loading, empty, confirmation).

---

## B. Existing Design System

Defined in [globals.css](src/app/globals.css) + [tailwind.config.ts](tailwind.config.ts), consumed via [primitives.tsx](src/components/ui/primitives.tsx).

| Token group | Values | Notes |
|---|---|---|
| Background/surface | `--background` 210 20% 98%, `--card` white, `--muted` 210 20% 96%, `--accent` 210 20% 94% | Clean slate/blue-grey ramp. Dark values exist under `.dark` but **no toggle exists anywhere** [Verified] |
| Primary | `--primary` 221 83% 53% (blue-600-ish) | Used for nav active, links, primary buttons, focus ring |
| Destructive | `--destructive` 0 72% 51% | Used consistently |
| Status colours | `Badge` tones: green=active, slate=closed, amber=draft (`statusTone`); source colours blue/green/amber/red/slate (`sourceTone`) | Centralised — good. But meaning is conveyed by colour + lowercase word only |
| Typography | System font stack; page `h1` = `text-2xl font-bold` (but `text-xl` on form/view pages — inconsistent [Verified]); table body `text-sm`; captions `text-xs` | No type-scale tokens; sizes hand-picked per page |
| Spacing | Tailwind default scale; page padding `p-4 sm:p-6 lg:p-8`; cards `p-4`–`p-6` (varies) | Mostly consistent; card padding drifts between 4/5/6 |
| Radius | `--radius: 0.6rem` with md/sm derivatives | Consistent |
| Buttons | 5 variants (primary/outline/ghost/subtle/destructive), 3 sizes (sm/md/icon) | `subtle` variant appears unused [Verified] |
| Inputs | Single `Input`/`Textarea`/`Select` primitives with focus ring | Native checkboxes are unstyled 13px and don't use theme accent colour [Verified] |
| Icons | lucide-react, `h-4 w-4` in-line, `h-5 w-5` headers | Consistent library |
| Shadows | `shadow-sm` on cards, `shadow-lg` toasts, `shadow-2xl` modals | Consistent depth ramp |

**Inconsistencies found [Verified]**

- Page titles: `text-2xl` (Dashboard, list pages) vs `text-xl` (form, view pages).
- Header action buttons: the Dashboard hand-rolls link-button classes ([page.tsx:57–65](src/app/page.tsx)) while other pages nest `<Link><Button>` ([recommendations/page.tsx:164](src/app/recommendations/page.tsx), [import-export/page.tsx:130](src/app/import-export/page.tsx), [view/page.tsx:35](src/app/recommendations/[id]/view/page.tsx)) — the latter is invalid HTML (button inside anchor).
- Row actions: text "Edit" + icon View/Delete on the recommendations list; icon-only pencil on Stocks; text+icon in StockDetailModal — three different patterns for the same concept.
- Card interior padding varies `p-2`…`p-6` without rule.
- Date format is ISO `2026-07-17` everywhere; fine for scanning but not localised (an Indian finance audience typically reads `17 Jul 2026` faster).

---

## C. Page-by-Page Review

### 1. Dashboard — `/` ([src/app/page.tsx](src/app/page.tsx))

**Purpose:** KPI overview + recent activity.

| # | Issue | Type | Priority |
|---|---|---|---|
| 1.1 | KPI cards are static; "Summary filled 13%" begs to be clicked to see the 87% missing, but nothing is clickable | Verified | Medium |
| 1.2 | Recent-activity rows offer only "Edit" — no View, breaking the View→Edit convention used elsewhere | Verified | Medium |
| 1.3 | `ExternalLink` imported but unused ([page.tsx:5](src/app/page.tsx)) | Verified | Low |
| 1.4 | "This month" frequently shows 0 with no explanation of what counts (uses `date`, not `createdAt`) — sub-label helps but only partially | Verified (live: value renders small/ambiguous) | Low |
| 1.5 | No per-page `<title>` — every route shows "IndiaCharts Recommendations Admin" in the tab | Verified | Low |

**Recommendation:** Link each KPI to its filtered list (`/recommendations?missingSummary=1`, `/stocks`, date-ranged list). Add View before Edit in recent activity. Both are small, no-logic-change edits.

### 2. Recommendations list — `/recommendations` ([src/app/recommendations/page.tsx](src/app/recommendations/page.tsx))

**Purpose:** The primary working screen — search, filter, sort, bulk act, navigate to view/edit.

| # | Issue | Type | Priority |
|---|---|---|---|
| 2.1 | Stock filter: native select, 146 entries, case-sensitive-ish ordering interleaves UPPERCASE/Titlecase variants; polluted with non-stocks ("N/A (39)", "Trade Setup (21)", "Rich Test (0)") | Verified live | **High** |
| 2.2 | Filter state never written back to the URL — refresh/back/share loses filters (init-only read at [lines 40–49](src/app/recommendations/page.tsx)) | Verified | **High** |
| 2.3 | Row actions inconsistent: View (icon) → link (icon) → Edit (text) → Delete (icon); 16×16px targets; `title` only, no `aria-label` | Verified live | **High** |
| 2.4 | Table checkboxes have no accessible names; select-all doesn't use `indeterminate` when partially selected | Verified live | High |
| 2.5 | "Fields" column shows letters S/C in green vs 40%-opacity grey — colour-only, cryptic, tooltip unreachable by keyboard | Verified | High |
| 2.6 | Sort header uses the same `ArrowUpDown` icon for both directions; no `aria-sort` | Verified | Medium |
| 2.7 | Empty state always says "No recommendations match these filters" — even on a genuinely empty database, and with no Add CTA | Verified | Medium |
| 2.8 | During refetch with rows on screen, no loading feedback (spinner/dim) — only the initial load shows "Loading…" | Verified | Medium |
| 2.9 | Mobile: 993px table in 375px viewport; Actions off-screen; no sticky header; no scroll affordance | Verified live | Medium |
| 2.10 | Pagination shows "Page 1 of 14" but not "Showing 1–25 of 338"; no page-size choice | Verified | Low |
| 2.11 | Bulk bar offers only "Mark closed" — no mark active/draft | Verified | Low |
| 2.12 | `useRouter` imported/initialised but never used | Verified | Low |
| 2.13 | Single-row delete confirm omits "cannot be undone" (bulk has it) | Verified | Low |

### 3. Recommendation form — `/recommendations/new`, `/recommendations/[id]` ([RecommendationForm.tsx](src/components/RecommendationForm.tsx))

**Purpose:** Create/edit a recommendation with markdown summary, chart upload, status/source.

| # | Issue | Type | Priority |
|---|---|---|---|
| 3.1 | **No unsaved-changes protection** — back/refresh/nav discards everything silently | Verified | **Critical** |
| 3.2 | Delete lives in the page header next to Save — destructive action adjacent to the most-used action, same visual weight | Verified | High |
| 3.3 | Toolbar buttons (`TB`) have `title` but no `aria-label` and no visible focus ring (`focus-visible` classes absent) at 28×28px | Verified | High |
| 3.4 | Validation is toast-only for subject (no inline error, no field highlight); link gets inline treatment — inconsistent | Verified | Medium |
| 3.5 | Edit page has no "View" action (view page has Edit — one-way navigation) | Verified | Medium |
| 3.6 | Preview toggle replaces the editor rather than side-by-side on wide screens | Suggestion | Low |
| 3.7 | Editor supports headings/bold/italic/lists/links/tables/checklists/highlight/HR + paste conversion — **underline, font size, alignment and image-insert are absent** from the toolbar (underline survives paste via `<u>`; images render if markdown is typed) | Verified | Low–Medium (only if authors need them) |
| 3.8 | No Ctrl+S / ⌘S save shortcut for a form whose main field is a long text editor | Suggestion | Low |
| 3.9 | Status/source sit in a right column on desktop but *below* the 14-row editor on mobile — long scroll to reach Save context; Save itself is at top (good) | Verified | Low |

### 4. Recommendation view — `/recommendations/[id]/view` ([view/page.tsx](src/app/recommendations/[id]/view/page.tsx))

Well-structured. Minor: back arrow has no accessible name (`aria-label`); `title` metadata is generic; date/ID card duplicates info; stock link filters the list (good pattern). Priority: Low.

### 5. Stocks — `/stocks` ([src/app/stocks/page.tsx](src/app/stocks/page.tsx))

**Purpose:** Master-list hygiene: rename, set symbol, merge duplicates.

| # | Issue | Type | Priority |
|---|---|---|---|
| 5.1 | Edit/Save/Cancel are icon-only `Button size="icon" variant="ghost"` with **no title and no aria-label at all** — invisible to screen readers, unclear to sighted users | Verified | **High** |
| 5.2 | Inline edit: Enter doesn't save, Esc doesn't cancel; no loading state on save | Verified | Medium |
| 5.3 | The merge feature — the fix for the duplicate-stock mess — is explained only in a tiny tip *below* the table; target selection is implicit (highest count wins) with no way to choose | Verified | Medium |
| 5.4 | All 146 rows render with no pagination/virtualisation and no column sorting; fine at 146, degrades from ~1k | Verified | Low |
| 5.5 | "Recs" count badge is not a link to the filtered recommendations list (the modal offers it; the table doesn't) | Suggestion | Low |
| 5.6 | Checkbox column has no header and no accessible names | Verified | High (same fix as 2.4) |

### 6. Import / Export — `/import-export` ([src/app/import-export/page.tsx](src/app/import-export/page.tsx))

**Purpose:** Excel import with dry-run, workbook export, JSON feed documentation.

| # | Issue | Type | Priority |
|---|---|---|---|
| 6.1 | Drop zone accepts click only — no drag-and-drop, although the chart-upload zone in the form has it (inconsistent affordance, same visual style implies same behaviour) | Verified | Medium |
| 6.2 | `Stat` accepts an `icon` prop that is never rendered ([lines 147–154](src/app/import-export/page.tsx)) | Verified | Low |
| 6.3 | "Commit import" applies immediately with no confirmation; the dry-run preview *is* the confirmation but invalid rows are silently skipped without saying so on the button ("Commit import" vs "Import 45 valid rows") | Verified | Medium |
| 6.4 | After commit, no link to see what was imported | Suggestion | Low |
| 6.5 | Dry-run preview table: no indication which sheet was matched (`dry.source` is fetched but never displayed) | Verified | Low |

### 7. Shared chrome — [Sidebar.tsx](src/components/Sidebar.tsx), [MobileNav.tsx](src/components/MobileNav.tsx), [layout.tsx](src/app/layout.tsx)

- Active nav item lacks `aria-current="page"` (both navs). [Verified]
- MobileNav abbreviates "Recs" — inconsistent terminology; no app identity (logo) on mobile. [Verified]
- No `error.tsx`/`not-found.tsx` — a bad recommendation ID gives the unstyled default Next 404. [Verified]
- No favicon asset. [Verified]

---

## D. Component-Level Review

| Component | File | Verdict |
|---|---|---|
| `Button` | [primitives.tsx:13–47](src/components/ui/primitives.tsx) | **Improve**: export a `buttonClasses(variant,size)` helper so links can be styled as buttons without `<Link><Button>` nesting. Remove or keep `subtle` (currently unused). |
| `Badge` + `statusTone`/`sourceTone` | [primitives.tsx:100–133](src/components/ui/primitives.tsx) | **Reuse — model component.** Optionally add a leading status dot for non-colour redundancy. |
| `Modal` | [ui/Modal.tsx](src/components/ui/Modal.tsx) | **Improve**: add initial focus, focus trap, and focus-restore on close. Esc/backdrop/scroll-lock already correct. |
| Toast system | [ui/toast.tsx](src/components/ui/toast.tsx) | **Improve**: `role="status"` + `aria-live="polite"` on the region; optional dismiss button. |
| `ZoomableImage` | [ui/ZoomableImage.tsx](src/components/ui/ZoomableImage.tsx) | Reuse. Minor: overlay lacks `role="dialog"`/`aria-modal`. |
| `RecommendationForm` | [RecommendationForm.tsx](src/components/RecommendationForm.tsx) | **Improve** (dirty-guard, toolbar a11y, inline subject error). Do **not** split — cohesive. |
| `StockDetailModal` | [StockDetailModal.tsx](src/components/StockDetailModal.tsx) | Reuse — best action pattern in the app (View → link → Edit with labels). Standardise other tables to match it. Minor: fetches the whole `/api/stocks` list to find one stock. |
| Confirm dialogs | *(missing)* | **Create** a small `ConfirmDialog` on top of `Modal` to replace 5 scattered `window.confirm()` calls (list delete ×2, bulk delete, form delete, stock merge, template insert). Native confirms can't show what's being deleted, are inconsistent with the design language, and can be suppressed by the browser. |
| Table pattern | inline ×5 (dashboard, list, stocks, modal, import preview) | **Standardise, don't necessarily extract**: same thead classes exist in 5 places. Minimum: a shared `EmptyRow`/`LoadingRow` and one action-cell convention. A full `DataTable` extraction is optional (Large effort). |
| `Stat` (import) | [import-export/page.tsx:147](src/app/import-export/page.tsx) | Fix icon prop or drop it. |
| Markdown pipeline | [markdown.ts](src/lib/markdown.ts) | Works well. **Security note [Verified]:** `renderMarkdown` output is injected via `dangerouslySetInnerHTML` with raw HTML passthrough and no sanitisation, in 4 places. Content arriving via the JSON feed (`source: website/scrape/api`) could carry `<script>`/event handlers. Single-admin tool = low exposure, but sanitising (or at least stripping `<script on*>` server-side in `validateRecommendation`) is cheap insurance. |

---

## E. Prioritised Recommendations

| Priority | Page/Component | Issue | Recommended improvement | File | Effort |
|---|---|---|---|---|---|
| **Critical** | Recommendation form | Silent data loss on nav/refresh | Dirty-state tracking + `beforeunload` guard | src/components/RecommendationForm.tsx | Small |
| **Critical** | All tables/toolbar/stocks | Icon controls without accessible names; unlabeled checkboxes; unannounced toasts | `aria-label`s, labelled checkboxes, `aria-live` toast region | recommendations/page.tsx, stocks/page.tsx, RecommendationForm.tsx, ui/toast.tsx | Small |
| **High** | Recommendations list | Stock filter unusable at 146 polluted entries | Short-term: sort case-insensitively, hide 0-count entries; run merges. Medium-term: searchable combobox (datalist already used in the form — same pattern) | recommendations/page.tsx (+ data hygiene via /stocks merge) | Small→Medium |
| **High** | Recommendations list | Filters lost on refresh/back | Mirror filter state to URL via `history.replaceState` | recommendations/page.tsx | Small |
| **High** | All row actions | Three competing action patterns; 16px targets | One convention: View → Edit → Delete, icon buttons ≥32px hit area, tooltip + aria-label | recommendations/page.tsx, stocks/page.tsx, app/page.tsx | Small |
| **High** | Modal | Focus escapes dialog; focus not restored | Focus trap + restore | src/components/ui/Modal.tsx | Small |
| **High** | Stocks | Icon-only edit/save/cancel unnamed | titles + aria-labels; Enter/Esc keyboard handling | src/app/stocks/page.tsx | Small |
| Medium | Recommendations list | S/C colour-only field indicators | Replace with mini-badges or checkmark icons + sr text | recommendations/page.tsx | Small |
| Medium | Recommendations list | Same sort icon both directions | ArrowUp/ArrowDown when active + `aria-sort` | recommendations/page.tsx | Small |
| Medium | Recommendations list | Misleading empty state | Distinguish "no data" (with Add CTA) from "no matches" (with Clear-filters CTA) | recommendations/page.tsx | Small |
| Medium | Import | No drag-drop on drop zone; icon prop dead | Add drag handlers (copy from form) + render icon | import-export/page.tsx | Small |
| Medium | All destructive actions | Native `confirm()` | `ConfirmDialog` component on existing Modal | new file + 4 call sites | Medium |
| Medium | Dashboard | KPIs not actionable; Edit-only rows | Link KPIs to filtered views; add View action | src/app/page.tsx | Small |
| Medium | Form | Toast-only subject validation | Inline error + red border on blur/submit | RecommendationForm.tsx | Small |
| Medium | Mobile tables | Sticky header absent; actions off-screen | `thead sticky top-0 bg-card`; keep horizontal scroll (acceptable pattern) | list pages | Small |
| Medium | Markdown render | Unsanitised HTML from external feed | Sanitise on render or validate on ingest | lib/markdown.ts or lib/validate.ts | Medium |
| Low | Global | Dark tokens without a toggle | Add a theme toggle (all components already have dark styles) or delete the dead CSS | Sidebar.tsx + small script | Small |
| Low | Global | Generic tab titles; default 404 | Per-page `metadata`; `not-found.tsx` | app/* | Small |
| Low | Dates | ISO dates everywhere | `17 Jul 2026` via existing `formatDate` (UTC-safe) | src/lib/utils.ts | Small |
| Low | Pagination | No "Showing X–Y of Z" | Add range text | recommendations/page.tsx | Small |
| Low | Stocks | No link from count badge to list | Wrap badge in link `/recommendations?stock=slug` | stocks/page.tsx | Small |
| Low | Code hygiene | Unused imports/props (`ExternalLink`, `router`, `Stat.icon`) | Remove/fix | page.tsx, recommendations/page.tsx, import-export/page.tsx | Small |

---

## F. Quick Wins

All implementable in minutes, no architecture or business-logic change:

1. `beforeunload` dirty guard on the form (single biggest risk eliminated).
2. `aria-label` on every icon-only control + checkbox; `aria-current` on nav; `aria-live` toast.
3. Focus trap + restore in `Modal`.
4. View action before Edit on dashboard + consistent icon action row everywhere.
5. Directional sort icons + `aria-sort`.
6. True empty state vs filtered-empty state, each with a CTA.
7. Sticky table headers — note: the modal and import-preview tables already have them; the main list tables sit inside `overflow-x-auto` wrappers, which blocks page-level `position: sticky`, so they need a bounded-height vertical scroller first (Phase 2, not a pure quick win).
8. Drag-and-drop on the import drop zone (pattern already exists in the form).
9. Case-insensitive sort + hide-zero-count in the stock filter options.
10. URL-synced filters via `history.replaceState`.
11. Checkbox `accent-color` + slightly larger checkboxes via one CSS rule.
12. Human date format (`17 Jul 2026`) in `formatDate` (UTC-parts-based, no TZ shift).
13. "This cannot be undone." on all delete confirms.
14. Remove dead code (`ExternalLink`, `router`, render `Stat` icon).
15. `not-found.tsx` + per-page titles.

---

## G. Suggested Design System (consolidating what exists)

Keep the current token architecture — it is already right. Codify these rules:

- **Colours** — as today: primary `hsl(221 83% 53%)`, destructive `hsl(0 72% 51%)`; add semantic aliases `success = emerald-600`, `warning = amber-600`, `info = blue-600` (currently reached ad hoc via Tailwind classes in toasts/stats — alias them in `tailwind.config.ts` for consistency).
- **Status mapping (already implemented, keep single-source in `statusTone`/`sourceTone`):** active=green, closed=slate, draft=amber; add a leading dot (`●`) so state isn't colour-only.
- **Typography scale:** page title `text-2xl font-bold` (everywhere — fix the two `text-xl` pages), section/card heading `font-semibold text-base`, body `text-sm`, caption/meta `text-xs text-muted-foreground`, table header `text-xs uppercase tracking-wide`.
- **Spacing:** page container `space-y-6`; card padding `p-5` standard, `p-4` dense (tables/filters); form field gap `space-y-1.5`; keep `p-4 sm:p-6 lg:p-8` shell.
- **Radius:** keep `--radius 0.6rem`; pills only for badges.
- **Buttons:** primary (one per view), outline (secondary), ghost (tertiary/table), destructive (always paired with confirm). Icon buttons: minimum 32×32 hit area, always `aria-label` + `title`.
- **Inputs:** current primitives; every input gets a `<Label htmlFor>` or `aria-label`; required = red asterisk + inline error text under field.
- **Tables:** `thead` = `sticky top-0 bg-card text-xs uppercase`; row hover `bg-accent/40`; actions right-aligned in order **View → Edit → Delete**, delete visually last and red-on-hover; empty and loading rows via shared helpers; horizontal scroll wrapper `overflow-x-auto scroll-thin` (keep).
- **Modals:** existing `Modal` + focus trap; destructive confirms through `ConfirmDialog` with the item's name in the body and a red primary action.
- **Toasts:** bottom-right, `aria-live="polite"`, auto-dismiss 3.5s, success/error/info tones (as today).
- **States:** disabled = `opacity-50 pointer-events-none` (as today); loading buttons keep width and swap label ("Saving…" pattern — keep); focus = 2px ring `--ring` (already on primitives; extend to toolbar buttons and nav links).

---

## H. Implementation Roadmap

**Phase 1 — Critical safety & accessibility (hours):** F.1–F.5 above + stocks-page labels. No visual redesign, no logic change.

**Phase 2 — Consistency (1–2 days):** unify action rows and header buttons (`buttonClasses` helper, kill `<Link><Button>` nesting), `ConfirmDialog`, empty/loading states, sticky headers, URL-synced filters, page titles/404.

**Phase 3 — Stock-picker & data hygiene (1–2 days):** searchable stock combobox; merge-dialog with explicit target choice; hide zero-count stocks; sort fix. (Data cleanup itself is an operator task using the existing merge tool.)

**Phase 4 — Responsive & mobile polish (1 day):** mobile card-style row alternative for the recommendations list (optional), larger touch targets, scroll-shadow affordance on table wrappers.

**Phase 5 — Enhancements (optional):** dark-mode toggle, side-by-side markdown preview, Ctrl+S, sanitised markdown rendering, import result deep-link, dashboard KPI links (if not done in Phase 1), page-size selector.

---

*Assumptions stated:* the app is single-admin (per `.env` and sidebar label), so multi-user concerns (roles, audit trails, concurrent-edit locking) were excluded. "Publishing" in this system maps to the `status` field (active/closed/draft) — there is no separate publish pipeline. The JSON feed (`/api/import`) is assumed to be called by a trusted internal CMS/scraper; the sanitisation note in D assumes that trust may weaken later.

---

## Appendix — Implemented in this session (2026-07-18)

All changes below were applied, type-checked, verified in the running app, and pass `next build`. No business logic, API, or schema was touched.

**Critical / High**
- Unsaved-changes protection on the recommendation form: dirty tracking, `beforeunload` guard, discard-confirm on the in-app Back and View links, and a visible "Unsaved changes" indicator ([RecommendationForm.tsx](src/components/RecommendationForm.tsx)). Sidebar navigation is still unguarded (App Router has no supported route-change interception) — noted for Phase 2.
- Accessible names everywhere: row action icons, table checkboxes (+ `indeterminate` select-all), filter selects, search inputs, editor toolbar buttons, stocks-page edit/save/cancel, nav `aria-current`, back arrows.
- Toasts announce via `role="status"`/`aria-live="polite"` and are dismissible ([toast.tsx](src/components/ui/toast.tsx)).
- Focus trap, initial focus, and focus-restore in [Modal.tsx](src/components/ui/Modal.tsx).
- Standardised row actions View → Edit → link → Delete as 32×32px icon buttons with tooltips ([recommendations/page.tsx](src/app/recommendations/page.tsx)); dashboard rows gained View before Edit.
- Stock filter: case-insensitive sort + zero-count entries hidden.
- Filters mirrored to the URL via `history.replaceState` (refresh/back/share-safe).
- Invalid `<Link><Button>` nesting replaced by a shared `buttonClasses()` helper ([primitives.tsx](src/components/ui/primitives.tsx)) at all call sites.

**Medium**
- "Fields S/C" column replaced with check/dash icons + labels + screen-reader text ("Content" column).
- Directional sort icons (`ArrowUp`/`ArrowDown`) with `aria-sort`.
- Distinct empty states: no-data (Add CTA) vs no-matches (Clear-filters CTA); refetch now dims the stale table (`aria-busy`).
- Import: drag-and-drop on the drop zone, `Stat` icons rendered, commit button shows the real row count ("Import 45 rows") and is disabled at zero, invalid-rows-skipped notice.
- Inline subject validation with `aria-invalid` + red border; all form fields got `<Label htmlFor>` associations.
- Stocks: Enter saves / Esc cancels inline edit; count badge links to the filtered list.
- Bulk bar: "Mark closed" replaced with a full status select (Active/Closed/Draft).

**Low / polish**
- Dark-mode toggle (sidebar + mobile nav) with pre-paint inline script — the `.dark` token set was already fully defined ([ThemeToggle.tsx](src/components/ThemeToggle.tsx), [layout.tsx](src/app/layout.tsx)).
- Human date format "17 Jul 2026" (UTC-safe) in [utils.ts](src/lib/utils.ts).
- Checkboxes use the theme accent colour at 15px ([globals.css](src/app/globals.css)).
- Styled [not-found.tsx](src/app/not-found.tsx); per-page `<title>`s via route metadata/layouts.
- Pagination shows "Showing 1–25 of 338"; delete confirms say "This cannot be undone."; Ctrl+S saves the form; "Recs" → "Recommendations" in mobile nav; dead code removed (`ExternalLink`, `useRouter`).

**Deliberately not implemented (needs a product decision or more design):** ConfirmDialog replacing native `confirm()`, searchable stock combobox, bounded-height scroller for sticky list headers, markdown sanitisation, merge-target selection UI, mobile card-row layout.
