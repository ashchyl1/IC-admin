import "server-only";

import { NextResponse } from "next/server";

import { ProviderError } from "./types";

/**
 * Shared response helpers for the `/api/market/*` routes.
 *
 * These live outside the route files on purpose: Next.js restricts a
 * `route.ts` module to the HTTP verbs and a fixed set of config exports, so a
 * helper exported from one route and imported by another fails the build's
 * type check.
 */

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProviderError) {
    return NextResponse.json({ error: error.message, provider: error.provider }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Market data request failed" },
    { status: 500 }
  );
}

export function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
