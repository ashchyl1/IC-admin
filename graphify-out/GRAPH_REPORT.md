# Graph Report - indiacharts-admin  (2026-07-29)

## Corpus Check
- 127 files · ~431,332 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 553 nodes · 850 edges · 17 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 125 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]

## God Nodes (most connected - your core abstractions)
1. `h()` - 29 edges
2. `MockMarketGenerator` - 25 edges
3. `MockAdapter` - 16 edges
4. `join()` - 16 edges
5. `supabase()` - 14 edges
6. `KiteAdapter` - 14 edges
7. `pagePlaybook()` - 13 edges
8. `pageQuality()` - 12 edges
9. `POST()` - 11 edges
10. `GET()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `upload()` --calls--> `listInstruments()`  [INFERRED]
  src\app\paper-trading\import\page.tsx → src\lib\paper\api.ts
- `router()` --calls--> `error()`  [INFERRED]
  trading-dashboard\app.js → src\components\paper\SessionLauncher.tsx
- `main()` --calls--> `create()`  [INFERRED]
  prisma\seed.mjs → src\components\paper\SessionLauncher.tsx
- `exportSelected()` --calls--> `join()`  [INFERRED]
  src\app\(admin)\recommendations\page.tsx → trading-dashboard\app.js
- `clearFilters()` --calls--> `setStatus()`  [INFERRED]
  src\app\(admin)\recommendations\page.tsx → src\lib\paper\api.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (34): MockAdapter, onWheel(), expiryCode(), MockMarketGenerator, nextTradingDay(), replayStartMs(), round2(), spreadFor() (+26 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (57): remove(), toggle(), badge(), badgeFor(), buildNav(), chartCard(), chartDonut(), chartHBar() (+49 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (24): GET(), GET(), PUT(), classify(), POST(), readRows(), buildExportWorkbook(), parseWorkbook() (+16 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (18): applyFormat(), insertAtCaret(), insertTemplate(), onKey(), onSummaryPaste(), save(), cellText(), htmlToMarkdown() (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (25): black76Greeks(), black76Price(), dTerms(), erf(), impliedVolatility(), intrinsic(), normCdf(), normPdf() (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.1
Nodes (8): KiteAdapter, aggregate(), biasFor(), cluster(), ema(), indicatorsFor(), supportResistance(), vwap()

### Community 6 - "Community 6"
Cohesion: 0.17
Nodes (19): NotFound(), EditRecommendationPage(), advanceReplay(), cancelOrder(), cleanMessage(), createSession(), getPerformance(), getSessionState() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (15): markPrice(), roundToTick(), simulateFill(), applyFill(), emptyPortfolio(), journalStats(), openExposure(), round2() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (5): cn(), clsx(), step(), onChange(), buttonClasses()

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (6): duplicateKey(), emptyGuard(), evaluateOrder(), registerAccepted(), riskAtStop(), context()

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (3): useLegContract(), useLegQuote(), useOrderPreview()

### Community 11 - "Community 11"
Cohesion: 0.27
Nodes (8): money(), n(), num(), pct(), pnlTone(), signed(), toNumber(), PaperTradingWorkspace()

### Community 13 - "Community 13"
Cohesion: 0.27
Nodes (7): onFile(), upload(), guessColumns(), parseCsv(), splitNaive(), toUtcIso(), zoneOffsetMs()

### Community 15 - "Community 15"
Cohesion: 0.7
Nodes (3): toTime(), zoneOffsetSeconds(), zoneParts()

### Community 17 - "Community 17"
Cohesion: 0.4
Nodes (2): defaultInput(), silverCall()

### Community 18 - "Community 18"
Cohesion: 0.67
Nodes (2): onPick(), runDry()

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (2): computeCharges(), estimateRoundTrip()

## Knowledge Gaps
- **Thin community `Community 17`** (5 nodes): `presets.ts`, `defaultInput()`, `presetById()`, `silverCall()`, `strike-selector.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (4 nodes): `commit()`, `onPick()`, `runDry()`, `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (4 nodes): `computeCharges()`, `emptyCharges()`, `estimateRoundTrip()`, `charges.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `Community 0` to `Community 1`, `Community 2`, `Community 5`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `join()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 8`?**
  _High betweenness centrality (0.125) - this node is a cross-community bridge._
- **Why does `POST()` connect `Community 2` to `Community 0`, `Community 6`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `join()` (e.g. with `symbolGuess()` and `main()`) actually correct?**
  _`join()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._