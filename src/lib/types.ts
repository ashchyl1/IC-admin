export type Source = "manual" | "website" | "excel" | "scrape" | "api";
export type Status = "active" | "closed" | "draft";
export type RecommendationType = "Enter" | "Update" | "Exit";

export const SOURCES: Source[] = ["manual", "website", "excel", "scrape", "api"];
export const STATUSES: Status[] = ["active", "closed", "draft"];
export const RECOMMENDATION_TYPES: RecommendationType[] = ["Enter", "Update", "Exit"];

export interface Stock {
  stockId: string;
  displayName: string;
  symbolGuess: string | null;
}

export interface RecommendationDTO {
  id: string;
  stocks: Stock[];
  date: string | null; // ISO YYYY-MM-DD
  subject: string;
  link: string | null;
  summary: string | null;
  chartImage: string | null;
  source: Source;
  status: Status;
  recommendationType: RecommendationType;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationInput {
  stockIds?: string[]; // Array of stock slugs/IDs
  date?: string | null;
  subject: string;
  link?: string | null;
  summary?: string | null;
  chartImage?: string | null;
  source?: Source;
  status?: Status;
  recommendationType?: RecommendationType;
}

export interface ListResponse {
  rows: RecommendationDTO[];
  total: number;
  page: number;
  pageSize: number;
}
