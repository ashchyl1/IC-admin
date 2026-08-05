import { NextRequest, NextResponse } from "next/server";
import { adminOr503 } from "@/lib/nifty-weekly/admin";
import { parsePayload, toRecommendation } from "@/lib/nifty-weekly/schema";

export const dynamic = "force-dynamic";

/**
 * Creates a weekly card.
 *
 * The table has no insert policy, so this has to run as the service role. That
 * is the point: the browser reads the feed with the publishable key but can
 * never write to it, even though /nifty-weekly itself is ungated.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = parsePayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const v = parsed.value;

  const admin = adminOr503();
  if ("response" in admin) return admin.response;

  const { data, error } = await admin.client
    .from("nifty_weekly_recommendations")
    .insert({
      week_ending: v.weekEnding,
      trend: v.trend,
      bias: v.bias,
      setup_status: v.setupStatus,
      spot_price: v.spotPrice,
      change_points: v.changePoints,
      change_percent: v.changePercent,
      support_levels: v.supportLevels,
      resistance_levels: v.resistanceLevels,
      target_levels: v.targetLevels,
      invalidation_levels: v.invalidationLevels,
      analysis: v.analysis,
      chart_image_path: v.chartImagePath,
      chart_image_url: v.chartImageUrl,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ recommendation: toRecommendation(data) }, { status: 201 });
}
