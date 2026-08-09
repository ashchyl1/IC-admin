import { NextResponse } from "next/server";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { SCHEMA_ID } from "@/lib/wave/export";
import { parseAnalysis } from "@/lib/wave/serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Saved wave analyses.
 *
 * The export in the browser can copy or download a bundle, but the most useful
 * destination is the repository itself: a file under `data/wave-analyses/` is
 * something Claude Code can open directly on the next question, with no
 * copy-paste step and no truncation.
 *
 *   GET  /api/wave/analysis          list saved analyses (newest first)
 *   GET  /api/wave/analysis?id=slug  read one back
 *   POST /api/wave/analysis          save a bundle, returns its id
 */

const DIRECTORY = path.join(process.cwd(), "data", "wave-analyses");
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  try {
    if (id) {
      const file = resolveFile(id);
      if (!file) return NextResponse.json({ error: "Invalid analysis id" }, { status: 400 });
      const raw = await readFile(file, "utf8");
      return new NextResponse(raw, {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    await mkdir(DIRECTORY, { recursive: true });
    const names = (await readdir(DIRECTORY)).filter((name) => name.endsWith(".json"));
    const entries = await Promise.all(
      names.map(async (name) => {
        const info = await stat(path.join(DIRECTORY, name));
        return { id: name.replace(/\.json$/, ""), bytes: info.size, savedAt: info.mtime.toISOString() };
      })
    );
    entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return NextResponse.json({ analyses: entries, directory: "data/wave-analyses" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json(
        id ? { error: "Analysis not found" } : { analyses: [], directory: "data/wave-analyses" },
        { status: id ? 404 : 200 }
      );
    }
    // A read-only deployment has no saved-analysis directory and never will;
    // an empty list is the truthful answer, not a server error.
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      return NextResponse.json({ analyses: [], readOnly: true, directory: null });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Read failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const serialized = JSON.stringify(body, null, 2);
  if (serialized.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `Analysis is ${(serialized.length / 1e6).toFixed(1)} MB; the limit is 8 MB. Export fewer candles.` },
      { status: 413 }
    );
  }

  // Reject anything that is not a readable analysis, so the directory stays
  // something Claude can open blind and trust.
  const parsed = parseAnalysis(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `Not a usable wave analysis: ${parsed.errors.slice(0, 3).join(" ")}`, schema: SCHEMA_ID },
      { status: 400 }
    );
  }

  const record = body as { terminals?: { symbol?: string; interval?: string }[] };
  const first = record.terminals?.[0];
  const id = [
    new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19),
    slug(first?.symbol ?? "analysis"),
    slug(first?.interval ?? ""),
  ]
    .filter(Boolean)
    .join("_");

  try {
    await mkdir(DIRECTORY, { recursive: true });
    await writeFile(path.join(DIRECTORY, `${id}.json`), serialized, "utf8");
    return NextResponse.json({
      id,
      path: `data/wave-analyses/${id}.json`,
      drawings: parsed.terminals.reduce((sum, terminal) => sum + terminal.drawings.length, 0),
      warnings: parsed.warnings,
    });
  } catch (error) {
    // Serverless hosts (Vercel, Netlify, Cloud Run) mount the bundle read-only,
    // so saving into the repository is a local-development affordance only.
    // Say so plainly instead of surfacing a raw EROFS — the download and
    // clipboard routes out of the export dialog work everywhere.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      return NextResponse.json(
        {
          error:
            "This deployment has a read-only filesystem, so analyses cannot be saved into the repository. " +
            "Use Copy JSON or the .json download instead — both carry the identical document.",
          readOnly: true,
        },
        { status: 501 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Write failed" },
      { status: 500 }
    );
  }
}

/** Resolve an id to a path inside the directory, or null if it tries to escape. */
function resolveFile(id: string): string | null {
  const file = path.resolve(DIRECTORY, `${slug(id)}.json`);
  return file.startsWith(path.resolve(DIRECTORY) + path.sep) ? file : null;
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
