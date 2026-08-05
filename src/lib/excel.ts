import ExcelJS from "exceljs";
import type { RecommendationDTO } from "./types";

export interface ParsedRow {
  id?: string;
  stockName: string | null;
  date: string | null; // ISO YYYY-MM-DD
  subject: string;
  link: string | null;
  summary: string | null;
  chartImage: string | null;
  source: string | null;
  status: string | null;
  _rowNum: number;
}

/** Normalize a header cell to a lookup key. */
function key(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Maps many possible header spellings -> our canonical field.
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  id: "id",
  stockname: "stockName",
  stock: "stockName",
  date: "date",
  recommendationsubject: "subject",
  subject: "subject",
  headline: "subject",
  recommendationlink: "link",
  link: "link",
  url: "link",
  recommendationsummary: "summary",
  summary: "summary",
  chartimage: "chartImage",
  chart: "chartImage",
  image: "chartImage",
  source: "source",
  status: "status",
};

function cellToDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function cellToStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "text" in (v as any)) {
    // exceljs rich text / hyperlink cell
    const rich = v as any;
    if (rich.hyperlink) return String(rich.hyperlink);
    if (rich.text) return String(rich.text);
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Parse an uploaded workbook. Picks the sheet named "Consolidated" or
 * "Recommendations" if present, otherwise the first sheet. Maps columns by
 * header name so it tolerates both the original and normalized schemas.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const ws =
    wb.getWorksheet("Recommendations") ??
    wb.getWorksheet("Consolidated") ??
    wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const colToField: Record<number, keyof ParsedRow> = {};
  headerRow.eachCell((cell, col) => {
    const field = HEADER_MAP[key(cell.value)];
    if (field) colToField[col] = field;
  });

  const rows: ParsedRow[] = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const rec: ParsedRow = {
      stockName: null,
      date: null,
      subject: "",
      link: null,
      summary: null,
      chartImage: null,
      source: null,
      status: null,
      _rowNum: rowNum,
    };
    let hasAny = false;
    for (const [colStr, field] of Object.entries(colToField)) {
      const col = Number(colStr);
      const raw = row.getCell(col).value;
      if (raw == null || raw === "") continue;
      hasAny = true;
      if (field === "date") rec.date = cellToDate(raw);
      else if (field === "subject") rec.subject = cellToStr(raw) ?? "";
      else (rec[field] as string | null) = cellToStr(raw);
    }
    if (!hasAny) return;
    // Fall back: use stock name as subject if subject missing.
    if (!rec.subject && rec.stockName) rec.subject = rec.stockName;
    if (!rec.subject) return; // skip fully-empty rows
    rows.push(rec);
  });

  return rows;
}

const RECS_COLUMNS = [
  { header: "id", key: "id", width: 26 },
  { header: "stocks", key: "stocks", width: 50 },
  { header: "recommendation_type", key: "recommendationType", width: 16 },
  { header: "date", key: "date", width: 12 },
  { header: "subject", key: "subject", width: 40 },
  { header: "link", key: "link", width: 50 },
  { header: "summary", key: "summary", width: 50 },
  { header: "chart_image", key: "chartImage", width: 40 },
  { header: "source", key: "source", width: 12 },
  { header: "status", key: "status", width: 10 },
  { header: "created_at", key: "createdAt", width: 22 },
  { header: "updated_at", key: "updatedAt", width: 22 },
];

const CONSOLIDATED_COLUMNS = [
  { header: "Stock Name", key: "stockName", width: 26 },
  { header: "Date", key: "date", width: 12 },
  { header: "Recommendation Type", key: "recommendationType", width: 16 },
  { header: "Recommendation Subject", key: "subject", width: 40 },
  { header: "Recommendation Link", key: "link", width: 50 },
  { header: "Recommendation Summary", key: "summary", width: 50 },
  { header: "chart image", key: "chartImage", width: 40 },
];

export interface ExportData {
  recommendations: RecommendationDTO[];
  stocks: { stockId: string; displayName: string; symbolGuess: string | null; count: number }[];
  sources: { name: string; count: number }[];
  importLog: { timestamp: string; sources: string; rowsNew: number; rowsMerged: number; rowsTotal: number; notes: string | null }[];
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  h.alignment = { vertical: "middle" };
  h.height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** Build the six-sheet workbook described in the brief. Returns an xlsx buffer. */
export async function buildExportWorkbook(data: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "IndiaCharts Admin";
  wb.created = new Date();

  // 1. Recommendations (normalized with many-to-many stocks)
  const recs = wb.addWorksheet("Recommendations");
  recs.columns = RECS_COLUMNS as any;
  data.recommendations.forEach((r) => {
    const stocksStr = r.stocks.map((s) => s.displayName).join("; ");
    recs.addRow({ ...r, stocks: stocksStr });
  });
  styleHeader(recs);

  // 2. Consolidated (flat original schema - one row per stock)
  const cons = wb.addWorksheet("Consolidated");
  cons.columns = CONSOLIDATED_COLUMNS as any;
  data.recommendations.forEach((r) => {
    if (r.stocks.length === 0) {
      cons.addRow({
        date: r.date,
        recommendationType: r.recommendationType,
        subject: r.subject,
        link: r.link,
        summary: r.summary,
        chartImage: r.chartImage,
      });
    } else {
      r.stocks.forEach((stock) => {
        cons.addRow({
          stockName: stock.displayName,
          date: r.date,
          recommendationType: r.recommendationType,
          subject: r.subject,
          link: r.link,
          summary: r.summary,
          chartImage: r.chartImage,
        });
      });
    }
  });
  styleHeader(cons);

  // 3. Stocks (master + counts)
  const stocks = wb.addWorksheet("Stocks");
  stocks.columns = [
    { header: "stock_id", key: "stockId", width: 24 },
    { header: "display_name", key: "displayName", width: 30 },
    { header: "symbol_guess", key: "symbolGuess", width: 16 },
    { header: "recommendation_count", key: "count", width: 20 },
  ] as any;
  data.stocks.forEach((s) => stocks.addRow(s));
  styleHeader(stocks);

  // 4. Sources (feed registry)
  const sources = wb.addWorksheet("Sources");
  sources.columns = [
    { header: "source", key: "name", width: 18 },
    { header: "recommendation_count", key: "count", width: 20 },
  ] as any;
  data.sources.forEach((s) => sources.addRow(s));
  styleHeader(sources);

  // 5. Import_Log (audit)
  const log = wb.addWorksheet("Import_Log");
  log.columns = [
    { header: "timestamp", key: "timestamp", width: 22 },
    { header: "sources", key: "sources", width: 30 },
    { header: "rows_new", key: "rowsNew", width: 12 },
    { header: "rows_merged", key: "rowsMerged", width: 12 },
    { header: "rows_total", key: "rowsTotal", width: 12 },
    { header: "notes", key: "notes", width: 40 },
  ] as any;
  data.importLog.forEach((l) => log.addRow(l));
  styleHeader(log);

  // 6. Lookups (config)
  const lookups = wb.addWorksheet("Lookups");
  lookups.columns = [
    { header: "field", key: "field", width: 16 },
    { header: "allowed_values", key: "values", width: 50 },
  ] as any;
  lookups.addRow({ field: "recommendation_type", values: "Enter, Update, Exit" });
  lookups.addRow({ field: "status", values: "active, closed, draft" });
  lookups.addRow({ field: "source", values: "manual, website, excel, scrape, api" });
  styleHeader(lookups);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
