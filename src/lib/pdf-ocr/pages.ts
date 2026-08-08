/**
 * Page-selection syntax: "1-3, 7, 10-" -- ranges, single pages, and an
 * open-ended tail meaning "to the end".
 *
 * This is the browser-side half: it catches typos before a multi-megabyte
 * upload and lets the form say how many pages a selection covers. The sidecar
 * (ocr-service/pdf.py) parses the same string again and is the authority --
 * only it knows the real page count, which is what "10-" needs to resolve.
 */

export type PageRange = {
  start: number;
  /** null means "through the last page". */
  end: number | null;
};

export type PageSelection =
  | { ok: true; ranges: PageRange[]; canonical: string; openEnded: boolean }
  | { ok: false; error: string };

/** An empty selection is valid and means every page. */
export function parsePageSelection(input: string): PageSelection {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, ranges: [], canonical: "", openEnded: false };

  const parsed: PageRange[] = [];
  for (const chunk of trimmed.split(",")) {
    const part = chunk.trim();
    if (!part) continue;

    const dash = part.indexOf("-");
    if (dash === -1) {
      const page = toPageNumber(part);
      if (page === null) return { ok: false, error: `"${part}" is not a page number.` };
      parsed.push({ start: page, end: page });
      continue;
    }

    const startRaw = part.slice(0, dash).trim();
    const endRaw = part.slice(dash + 1).trim();
    const start = toPageNumber(startRaw);
    if (start === null) return { ok: false, error: `"${part}" needs a page number before the dash.` };
    if (!endRaw) {
      parsed.push({ start, end: null });
      continue;
    }
    const end = toPageNumber(endRaw);
    if (end === null) return { ok: false, error: `"${part}" is not a page range.` };
    if (end < start) return { ok: false, error: `"${part}" ends before it starts.` };
    parsed.push({ start, end });
  }

  if (!parsed.length) return { ok: true, ranges: [], canonical: "", openEnded: false };

  const ranges = mergeRanges(parsed);
  return {
    ok: true,
    ranges,
    canonical: ranges.map(formatRange).join(","),
    openEnded: ranges.some((r) => r.end === null),
  };
}

function toPageNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 ? value : null;
}

/** Sort and coalesce, so "3,1-2,2" becomes "1-3" and overlaps only count once. */
function mergeRanges(ranges: PageRange[]): PageRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || endValue(a) - endValue(b));
  const merged: PageRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    // Adjacent ranges (3-4 and 5-6) merge too: they describe the same pages.
    if (last && range.start <= endValue(last) + 1) {
      if (endValue(range) > endValue(last)) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function endValue(range: PageRange): number {
  return range.end === null ? Number.POSITIVE_INFINITY : range.end;
}

function formatRange(range: PageRange): string {
  if (range.end === null) return `${range.start}-`;
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}
