import { NextRequest, NextResponse } from "next/server";
import { adminOr503 } from "@/lib/nifty-weekly/admin";
import { parsePayload, toRecommendation, toRowValues } from "@/lib/nifty-weekly/schema";

export const dynamic = "force-dynamic";

const BUCKET = "nifty-charts";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Replaces a card.
 *
 * A full replace rather than a partial patch: the edit form always submits
 * every field, so a merge would only add a way for a cleared field to silently
 * keep its old value.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

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

  const admin = adminOr503();
  if ("response" in admin) return admin.response;

  // Read the old image path first: if the edit swapped the chart, the previous
  // object has to be cleaned up or the bucket fills with orphans.
  const { data: existing } = await admin.client
    .from("nifty_weekly_recommendations")
    .select("chart_image_path")
    .eq("id", id)
    .maybeSingle();

  const values = toRowValues(parsed.value);
  const { data, error } = await admin.client
    .from("nifty_weekly_recommendations")
    .update(values)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No recommendation with that id" }, { status: 404 });
  }

  const oldPath = existing?.chart_image_path;
  if (oldPath && oldPath !== values.chart_image_path) {
    await admin.client.storage.from(BUCKET).remove([oldPath]);
  }

  return NextResponse.json({ recommendation: toRecommendation(data) });
}

/**
 * Removes a card and its chart image.
 *
 * The row goes first: if the storage delete fails the card is still gone from
 * the feed, which is what the user asked for, and the leftover object is a
 * harmless orphan. Doing it the other way round could leave a card pointing at
 * a 404 image.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const admin = adminOr503();
  if ("response" in admin) return admin.response;

  const { data, error } = await admin.client
    .from("nifty_weekly_recommendations")
    .delete()
    .eq("id", id)
    .select("chart_image_path")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No recommendation with that id" }, { status: 404 });
  }

  if (data.chart_image_path) {
    await admin.client.storage.from(BUCKET).remove([data.chart_image_path]);
  }

  return NextResponse.json({ ok: true });
}
