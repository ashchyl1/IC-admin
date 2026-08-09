import "server-only";

/**
 * One place for the fetch details every provider needs: a timeout that actually
 * aborts, and errors that name the provider so the status strip can say which
 * hop failed rather than "fetch failed".
 */

import { ProviderError, type ProviderId } from "./types";

export const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  provider: ProviderId
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new ProviderError(`${url} — ${reason}`, provider, 504);
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(response: Response, provider: ProviderId): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new ProviderError(
      `HTTP ${response.status} ${response.statusText} — ${truncate(text, 300)}`,
      provider,
      response.status === 403 || response.status === 401 ? 401 : 502
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(`Non-JSON response: ${truncate(text, 200)}`, provider);
  }
}

export function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/** Extra headers supplied as a JSON object in an env var. Bad JSON is ignored. */
export function parseHeaderEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
