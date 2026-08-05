// Seeds SQLite from data/source.xlsx (the original Consolidated workbook).
// Idempotent: re-running clears and reloads the Recommendation + Stock tables.
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function symbolGuess(name) {
  const cleaned = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].toUpperCase().slice(0, 12);
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 12);
}
function cellStr(v) {
  if (v == null) return null;
  if (typeof v === "object" && v.text) return String(v.text).trim() || null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function main() {
  const file = path.join(__dirname, "..", "data", "source.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Consolidated") ?? wb.worksheets[0];

  const recs = [];
  const recStocks = []; // { recIndex, stockSlug }
  const stockMap = new Map(); // slug -> { displayName, count }

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const stockName = cellStr(row.getCell(1).value);
    const dateVal = row.getCell(2).value;
    const subject = cellStr(row.getCell(3).value) ?? stockName;
    const link = cellStr(row.getCell(4).value);
    const summary = cellStr(row.getCell(5).value);
    const chartImage = cellStr(row.getCell(6).value);
    if (!subject) return;

    let date = null;
    if (dateVal instanceof Date) date = dateVal;
    else if (dateVal) {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) date = d;
    }

    let stockSlug = null;
    if (stockName) {
      stockSlug = slugify(stockName);
      const existing = stockMap.get(stockSlug);
      if (existing) existing.count += 1;
      else stockMap.set(stockSlug, { displayName: stockName, count: 1 });
      // Track which stocks go with this recommendation.
      recStocks.push({ recIndex: recs.length, stockSlug });
    }

    recs.push({
      date,
      subject,
      link,
      summary,
      chartImage,
      source: "excel",
      status: "active",
      recommendationType: "Enter", // Default; can be parsed from data later.
    });
  });

  console.log(`Parsed ${recs.length} recommendations, ${stockMap.size} unique stocks.`);

  await prisma.recommendation.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.importLog.deleteMany();

  // Stocks first (Recommendation.stockSlug references Stock.stockId).
  for (const [slug, info] of stockMap) {
    await prisma.stock.create({
      data: {
        stockId: slug,
        displayName: info.displayName,
        symbolGuess: symbolGuess(info.displayName),
      },
    });
  }

  // Recommendations in chunks.
  const chunk = 100;
  const createdRecs = [];
  for (let i = 0; i < recs.length; i += chunk) {
    await prisma.recommendation.createMany({
      data: recs.slice(i, i + chunk),
    });
    // Fetch the created recommendations so we have their IDs.
    const batchRecs = await prisma.recommendation.findMany({
      orderBy: { createdAt: "desc" },
      take: recs.slice(i, i + chunk).length,
    });
    createdRecs.push(...batchRecs.reverse());
  }

  // Create the many-to-many links.
  for (const { recIndex, stockSlug } of recStocks) {
    if (recIndex < createdRecs.length) {
      await prisma.recommendationStock.create({
        data: {
          recommendationId: createdRecs[recIndex].id,
          stockId: stockSlug,
        },
      });
    }
  }

  await prisma.importLog.create({
    data: {
      sources: "excel:source.xlsx",
      rowsNew: recs.length,
      rowsMerged: 0,
      rowsTotal: recs.length,
      notes: "Initial seed from original Consolidated workbook",
    },
  });

  console.log(`Seeded ${recs.length} recommendations and ${stockMap.size} stocks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
