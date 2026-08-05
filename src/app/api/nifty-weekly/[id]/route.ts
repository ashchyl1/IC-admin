import { NextRequest, NextResponse } from "next/server";
import { adminOr503 } from "@/lib/nifty-weekly/admin";

export const dynamic = "force-dynamic";

const BUCKET = "nifty-charts";

/**
 * Removes a card and its chart image.
 *
 * The row goes first: if the storage delete fails the card is still gone from
 * the feed, which is what the user asked for, and the leftover object is a
 * harmless orphan. Doing it the other way round could leave a card pointing at
 * a 404 image.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
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
