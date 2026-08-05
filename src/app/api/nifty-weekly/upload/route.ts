import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { adminOr503 } from "@/lib/nifty-weekly/admin";

export const dynamic = "force-dynamic";

const BUCKET = "nifty-charts";
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 8 * 1024 * 1024; // matches the bucket's file_size_limit

/**
 * Chart-image upload into the `nifty-charts` Supabase Storage bucket.
 *
 * Returns both the object path and the public URL: the card stores the URL for
 * rendering and the path so a later delete can remove the object too.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const f = file as File;
  const ext = ALLOWED[f.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported image type ${f.type || "(unknown)"}. Use PNG, JPEG, WebP or GIF.` },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await f.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Image exceeds 8 MB" }, { status: 413 });
  }

  const admin = adminOr503();
  if ("response" in admin) return admin.response;

  // Foldered by month so the bucket stays browsable as weeks accumulate.
  const now = new Date();
  const folder = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const path = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

  const { error } = await admin.client.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: f.type, upsert: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = admin.client.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({ path, url: publicUrl }, { status: 201 });
}
