import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseWorkbook, type ParsedRow } from "@/lib/excel";
import { isValidUrl, slugify, symbolGuess } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Classified {
  row: ParsedRow;
  kind: "new" | "update" | "invalid";
  matchId?: string;
  reason?: string;
}

// A recommendation is considered a duplicate (update) if an existing row shares
// the same subject + date (link is often the generic listing URL, so not keyed on).
async function classify(rows: ParsedRow[]): Promise<Classified[]> {
  const existing = await prisma.recommendation.findMany({
    select: { id: true, subject: true, date: true },
  });
  const keyOf = (subject: string, date: string | null) =>
    `${subject.trim().toLowerCase()}|${date ?? ""}`;
  const index = new Map<string, string>();
  for (const e of existing) {
    index.set(keyOf(e.subject, e.date ? e.date.toISOString().slice(0, 10) : null), e.id);
  }

  return rows.map((row) => {
    if (!row.subject?.trim()) return { row, kind: "invalid", reason: "missing subject" };
    if (row.link && !isValidUrl(row.link)) return { row, kind: "invalid", reason: "invalid link" };
    const matchId = index.get(keyOf(row.subject, row.date));
    return matchId ? { row, kind: "update", matchId } : { row, kind: "new" };
  });
}

async function readRows(req: NextRequest): Promise<{ rows: ParsedRow[]; sourceLabel: string } | { error: string }> {
  const contentType = req.headers.get("content-type") || "";

  // JSON feed: { rows: [...] } or a bare array — the website CMS/scraper path.
  if (contentType.includes("application/json")) {
    const body = await req.json();
    const arr: any[] = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : [];
    const rows: ParsedRow[] = arr.map((r, i) => ({
      stockName: r.stock_name ?? r.stockName ?? null,
      date: r.date ?? null,
      subject: r.subject ?? r.stock_name ?? r.stockName ?? "",
      link: r.link ?? r.url ?? null,
      summary: r.summary ?? null,
      chartImage: r.chart_image ?? r.chartImage ?? null,
      source: r.source ?? "api",
      status: r.status ?? "active",
      _rowNum: i + 2,
    }));
    return { rows, sourceLabel: `json:feed (${rows.length})` };
  }

  // multipart file upload (.xlsx) — the offline/backup path.
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return { error: "No file uploaded" };
  const buffer = Buffer.from(await (file as File).arrayBuffer());
  const rows = await parseWorkbook(buffer);
  return { rows, sourceLabel: `excel:${(file as File).name}` };
}

export async function POST(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  let read;
  try {
    read = await readRows(req);
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to parse: ${e.message}` }, { status: 400 });
  }
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

  const { rows, sourceLabel } = read;
  const classified = await classify(rows);
  const counts = {
    total: rows.length,
    new: classified.filter((c) => c.kind === "new").length,
    update: classified.filter((c) => c.kind === "update").length,
    invalid: classified.filter((c) => c.kind === "invalid").length,
  };

  const preview = classified.slice(0, 20).map((c) => ({
    kind: c.kind,
    reason: c.reason,
    stockName: c.row.stockName,
    date: c.row.date,
    subject: c.row.subject,
    link: c.row.link,
  }));

  if (dryRun) {
    return NextResponse.json({ dryRun: true, counts, preview, source: sourceLabel });
  }

  // Commit: create new, update matched (fills summary/chart/link where provided).
  let applied = 0;
  for (const c of classified) {
    if (c.kind === "invalid") continue;

    // Ensure stock exists if stockName is provided
    let stockSlug: string | null = null;
    if (c.row.stockName && c.row.stockName.trim()) {
      stockSlug = slugify(c.row.stockName);
      if (stockSlug) {
        await prisma.stock.upsert({
          where: { stockId: stockSlug },
          create: { stockId: stockSlug, displayName: c.row.stockName.trim(), symbolGuess: symbolGuess(c.row.stockName) },
          update: {},
        });
      }
    }

    const date = c.row.date ? new Date(c.row.date) : null;
    if (c.kind === "new") {
      const rec = await prisma.recommendation.create({
        data: {
          date,
          subject: c.row.subject,
          link: c.row.link,
          summary: c.row.summary,
          chartImage: c.row.chartImage,
          source: (c.row.source as string) || "excel",
          status: (c.row.status as string) || "active",
          recommendationType: "Enter",
          stocks: stockSlug ? { create: [{ stockId: stockSlug }] } : undefined,
        },
      });
      applied++;
    } else if (c.kind === "update" && c.matchId) {
      await prisma.recommendation.update({
        where: { id: c.matchId },
        data: {
          link: c.row.link ?? undefined,
          summary: c.row.summary ?? undefined,
          chartImage: c.row.chartImage ?? undefined,
          stocks: stockSlug
            ? {
                deleteMany: {},
                create: [{ stockId: stockSlug }],
              }
            : undefined,
        },
      });
      applied++;
    }
  }

  await prisma.importLog.create({
    data: {
      sources: sourceLabel,
      rowsNew: counts.new,
      rowsMerged: counts.update,
      rowsTotal: counts.total,
      notes: `Applied ${applied} of ${counts.total} (invalid: ${counts.invalid})`,
    },
  });

  return NextResponse.json({ dryRun: false, counts, applied, source: sourceLabel });
}
