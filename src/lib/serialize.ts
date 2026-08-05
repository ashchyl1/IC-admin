import type { Recommendation, RecommendationStock } from "@prisma/client";
import type { RecommendationDTO, Source, Status, RecommendationType } from "./types";

type RecommendationWithStocks = Recommendation & {
  stocks?: (RecommendationStock & { stock?: { stockId: string; displayName: string; symbolGuess: string | null } })[];
};

export function toDTO(r: RecommendationWithStocks): RecommendationDTO {
  return {
    id: r.id,
    stocks: (r.stocks ?? []).map((rs) => ({
      stockId: rs.stock?.stockId ?? rs.stockId,
      displayName: rs.stock?.displayName ?? "",
      symbolGuess: rs.stock?.symbolGuess ?? null,
    })),
    date: r.date ? r.date.toISOString().slice(0, 10) : null,
    subject: r.subject,
    link: r.link,
    summary: r.summary,
    chartImage: r.chartImage,
    source: r.source as Source,
    status: r.status as Status,
    recommendationType: r.recommendationType as RecommendationType,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
