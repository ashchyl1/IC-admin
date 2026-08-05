import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import type { RecommendationInput } from "./types";

export interface ListParams {
  search?: string;
  stock?: string; // stockId/slug
  status?: string;
  source?: string;
  recommendationType?: string;
  dateFrom?: string;
  dateTo?: string;
  missingSummary?: boolean;
  missingChart?: boolean;
  sort?: string; // field
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTABLE = new Set(["date", "subject", "status", "source", "recommendationType", "updatedAt", "createdAt"]);

export function buildWhere(p: ListParams): Prisma.RecommendationWhereInput {
  const where: Prisma.RecommendationWhereInput = {};
  const and: Prisma.RecommendationWhereInput[] = [];

  if (p.search) {
    const q = p.search;
    and.push({
      OR: [
        { subject: { contains: q } },
        { summary: { contains: q } },
        { stocks: { some: { stock: { displayName: { contains: q } } } } },
      ],
    });
  }
  if (p.stock) {
    where.stocks = { some: { stockId: p.stock } };
  }
  if (p.status) where.status = p.status;
  if (p.source) where.source = p.source;
  if (p.recommendationType) where.recommendationType = p.recommendationType;
  if (p.dateFrom || p.dateTo) {
    where.date = {};
    if (p.dateFrom) (where.date as Prisma.DateTimeFilter).gte = new Date(p.dateFrom);
    if (p.dateTo) (where.date as Prisma.DateTimeFilter).lte = new Date(p.dateTo + "T23:59:59");
  }
  if (p.missingSummary) and.push({ OR: [{ summary: null }, { summary: "" }] });
  if (p.missingChart) and.push({ OR: [{ chartImage: null }, { chartImage: "" }] });

  if (and.length) where.AND = and;
  return where;
}

export async function listRecommendations(p: ListParams) {
  const where = buildWhere(p);
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, p.pageSize ?? 50));
  const sort = p.sort && SORTABLE.has(p.sort) ? p.sort : "date";
  const dir = p.dir === "asc" ? "asc" : "desc";

  const [rows, total] = await Promise.all([
    prisma.recommendation.findMany({
      where,
      include: { stocks: { include: { stock: true } } },
      orderBy: { [sort]: dir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.recommendation.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

function normalizeDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export async function createRecommendation(input: RecommendationInput) {
  return prisma.recommendation.create({
    data: {
      date: normalizeDate(input.date),
      subject: input.subject.trim(),
      link: input.link?.trim() || null,
      summary: input.summary ?? null,
      chartImage: input.chartImage?.trim() || null,
      source: input.source ?? "manual",
      status: input.status ?? "active",
      recommendationType: input.recommendationType ?? "Enter",
      stocks: {
        create: (input.stockIds ?? []).map((stockId) => ({ stockId })),
      },
    },
    include: { stocks: { include: { stock: true } } },
  });
}

export async function updateRecommendation(id: string, input: RecommendationInput) {
  return prisma.recommendation.update({
    where: { id },
    data: {
      date: normalizeDate(input.date),
      subject: input.subject.trim(),
      link: input.link?.trim() || null,
      summary: input.summary ?? null,
      chartImage: input.chartImage?.trim() || null,
      source: input.source,
      status: input.status,
      recommendationType: input.recommendationType,
      stocks: {
        deleteMany: {}, // Remove all existing relationships
        create: (input.stockIds ?? []).map((stockId) => ({ stockId })),
      },
    },
    include: { stocks: { include: { stock: true } } },
  });
}
