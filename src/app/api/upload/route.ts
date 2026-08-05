import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

// Chart-image upload -> saved under /public/uploads, returns { url }.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const f = file as File;
  if (!ALLOWED.has(f.type)) {
    return NextResponse.json({ error: `Unsupported type ${f.type}` }, { status: 415 });
  }
  const buffer = Buffer.from(await f.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 8 MB" }, { status: 413 });
  }

  const ext = (f.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buffer);

  return NextResponse.json({ url: `/uploads/${name}` });
}
