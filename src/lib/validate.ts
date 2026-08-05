import { SOURCES, STATUSES, RECOMMENDATION_TYPES, type RecommendationInput } from "./types";
import { isValidUrl } from "./utils";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: RecommendationInput;
}

/** Validate + coerce a raw payload into a RecommendationInput. */
export function validateRecommendation(body: any): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== "object") {
    return { ok: false, errors: ["Body must be a JSON object"] };
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) errors.push("subject is required");

  const link = body.link ? String(body.link).trim() : "";
  if (link && !isValidUrl(link)) errors.push("link must be a valid http(s) URL");

  const chartImage = body.chartImage ? String(body.chartImage).trim() : "";
  // chart image may be a relative /uploads path or an absolute URL
  if (chartImage && !chartImage.startsWith("/") && !isValidUrl(chartImage)) {
    errors.push("chart_image must be a valid URL or an /uploads path");
  }

  // Validate stockIds (comma-separated or array)
  let stockIds: string[] | undefined;
  if (body.stockIds) {
    if (Array.isArray(body.stockIds)) {
      stockIds = body.stockIds.map((s: any) => String(s).trim()).filter(Boolean);
    } else if (typeof body.stockIds === "string") {
      stockIds = body.stockIds.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    if (stockIds && stockIds.length === 0) stockIds = undefined;
  }

  const source = body.source ?? undefined;
  if (source && !SOURCES.includes(source)) errors.push(`source must be one of ${SOURCES.join(", ")}`);

  const status = body.status ?? undefined;
  if (status && !STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);

  const recommendationType = body.recommendationType ?? undefined;
  if (recommendationType && !RECOMMENDATION_TYPES.includes(recommendationType)) {
    errors.push(`recommendationType must be one of ${RECOMMENDATION_TYPES.join(", ")}`);
  }

  let date = body.date ?? null;
  if (date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) errors.push("date must be a valid ISO date");
    else date = d.toISOString().slice(0, 10);
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: {
      stockIds,
      date,
      subject,
      link: link || null,
      summary: typeof body.summary === "string" ? body.summary : null,
      chartImage: chartImage || null,
      source,
      status,
      recommendationType,
    },
  };
}
