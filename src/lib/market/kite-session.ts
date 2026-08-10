import "server-only";

/**
 * The Kite Connect login, and where its access token lives.
 *
 * Kite Connect authorises with a browser round trip, not an API key alone:
 *
 *   1. Send the user to `/connect/login?v=3&api_key=…`.
 *   2. Zerodha returns them to the app's redirect URL with a `request_token`.
 *   3. The app exchanges that for an `access_token`, proving it holds the API
 *      secret by sending sha256(api_key + request_token + api_secret).
 *
 * The resulting token is a credential — it can place orders on the account —
 * and Zerodha invalidates it at the next pre-open, around 06:00 IST. So it is
 * kept server-side only, in Supabase's non-exposed `bridge` schema behind the
 * same key that gates candle import, with an in-process cache to keep a chart
 * refresh from making a round trip for it.
 *
 * With no Supabase project configured it falls back to a local file, then to
 * `KITE_ACCESS_TOKEN`. The file matters more than it looks: module-level state
 * does not survive between requests under Next's per-route compilation, so an
 * in-memory-only token makes the login appear to succeed and then vanish on the
 * very next request. The file holds a credential, so it is written 0600 and
 * git-ignored.
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createResilientFetch } from "@/lib/supabase/resilient-fetch";
import { fetchWithTimeout } from "./http";
import { storeConfig } from "./supabase-store";
import { ProviderError } from "./types";

const KITE_LOGIN_URL = "https://kite.zerodha.com/connect/login";

export interface KiteSession {
  apiKey: string;
  accessToken: string;
  userId?: string;
  userName?: string;
  expiresAt: string;
  expired: boolean;
  /** Where the token came from, for the status panel. */
  source: "supabase" | "env" | "memory" | "file";
}

/**
 * Local fallback store. Off when `KITE_SESSION_FILE=0`, which a deployment with
 * a read-only or shared filesystem should set.
 */
function sessionFile(): string | null {
  const configured = process.env.KITE_SESSION_FILE?.trim();
  if (configured === "0" || configured === "false") return null;
  return configured && configured !== "1"
    ? path.resolve(configured)
    : path.join(process.cwd(), ".kite-session.json");
}

function readFileSession(apiKey: string): KiteSession | null {
  const file = sessionFile();
  if (!file || !existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<KiteSession>;
    if (parsed.apiKey !== apiKey || !parsed.accessToken || !parsed.expiresAt) return null;
    return {
      apiKey,
      accessToken: parsed.accessToken,
      userId: parsed.userId,
      userName: parsed.userName,
      expiresAt: parsed.expiresAt,
      expired: isExpired(parsed.expiresAt),
      source: "file",
    };
  } catch {
    return null; // corrupt file is the same as no file
  }
}

function writeFileSession(session: KiteSession): boolean {
  const file = sessionFile();
  if (!file) return false;
  try {
    writeFileSync(file, JSON.stringify(session, null, 2), { encoding: "utf8", mode: 0o600 });
    // Re-assert the mode: an existing file keeps its old permissions.
    chmodSync(file, 0o600);
    return true;
  } catch {
    return false; // read-only filesystem — Supabase or memory has to carry it
  }
}

export function kiteApiKey(): string | undefined {
  return process.env.KITE_API_KEY?.trim() || undefined;
}

function kiteApiSecret(): string | undefined {
  return process.env.KITE_API_SECRET?.trim() || undefined;
}

export function kiteBaseUrl(): string {
  return (process.env.KITE_API_URL?.trim() || "https://api.kite.trade").replace(/\/+$/, "");
}

/** True when the OAuth flow can run at all — both halves of the credential. */
export function canRunKiteLogin(): boolean {
  return Boolean(kiteApiKey() && kiteApiSecret());
}

/**
 * Where Zerodha sends the user back. Must match the redirect URL registered on
 * the Kite developer console exactly, which is why it is configurable rather
 * than derived from the request.
 */
export function kiteRedirectUrl(request?: Request): string {
  const configured = process.env.KITE_REDIRECT_URL?.trim();
  if (configured) return configured;
  const origin = request ? new URL(request.url).origin : "http://localhost:3040";
  return `${origin}/api/kite/callback`;
}

export function kiteLoginUrl(): string {
  const apiKey = kiteApiKey();
  if (!apiKey) throw new ProviderError("KITE_API_KEY is not set.", "kite-rest", 500);
  return `${KITE_LOGIN_URL}?v=3&api_key=${encodeURIComponent(apiKey)}`;
}

// ------------------------------------------------------------------ store ---

let memory: KiteSession | null = null;
let supabase: SupabaseClient | null = null;

function store(): { client: SupabaseClient; bridgeKey: string } | null {
  const config = storeConfig();
  if (!config) return null;
  if (!supabase) {
    supabase = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createResilientFetch() },
    });
  }
  return { client: supabase, bridgeKey: config.bridgeKey };
}

/**
 * The token to authenticate Kite REST calls with, or null when there is none.
 *
 * Order matters: an explicitly configured `KITE_ACCESS_TOKEN` wins, because
 * someone who pasted one in is deliberately overriding whatever is stored.
 */
export async function currentKiteSession(): Promise<KiteSession | null> {
  const apiKey = kiteApiKey();
  const envToken = process.env.KITE_ACCESS_TOKEN?.trim();

  if (envToken && apiKey) {
    return {
      apiKey,
      accessToken: envToken,
      // A pasted token carries no expiry; Zerodha's daily reset still applies.
      expiresAt: nextTokenExpiry().toISOString(),
      expired: false,
      source: "env",
    };
  }

  if (memory && !isExpired(memory.expiresAt)) return { ...memory, source: "memory" };
  if (!apiKey) return null;

  const backing = store();
  if (!backing) {
    // No Supabase: the file is the only thing that survives a request boundary.
    const fromFile = readFileSession(apiKey);
    if (fromFile && !fromFile.expired) {
      memory = fromFile;
      return fromFile;
    }
    return fromFile;
  }

  const { data, error } = await backing.client.rpc("read_kite_session", {
    p_key: backing.bridgeKey,
    p_api_key: apiKey,
  });
  if (error) throw new ProviderError(`Could not read the Kite session: ${error.message}`, "kite-rest", 502);

  const payload = data as
    | { found?: boolean; accessToken?: string; userId?: string; userName?: string; expiresAt?: string; expired?: boolean }
    | null;
  if (!payload?.found || !payload.accessToken) return readFileSession(apiKey);

  const session: KiteSession = {
    apiKey,
    accessToken: payload.accessToken,
    userId: payload.userId,
    userName: payload.userName,
    expiresAt: payload.expiresAt ?? nextTokenExpiry().toISOString(),
    expired: payload.expired === true,
    source: "supabase",
  };
  memory = session;
  return session;
}

export async function saveKiteSession(session: {
  apiKey: string;
  accessToken: string;
  publicToken?: string;
  userId?: string;
  userName?: string;
}): Promise<{ persisted: boolean; expiresAt: string }> {
  const expiresAt = nextTokenExpiry().toISOString();
  memory = { ...session, expiresAt, expired: false, source: "memory" };

  // Always write the file too. Supabase is the shared, authoritative copy, but
  // the file is what keeps a single-server deployment working at all.
  const onDisk = writeFileSession(memory);

  const backing = store();
  if (!backing) return { persisted: onDisk, expiresAt };

  const { error } = await backing.client.rpc("save_kite_session", {
    p_key: backing.bridgeKey,
    p_api_key: session.apiKey,
    p_access_token: session.accessToken,
    p_user_id: session.userId ?? null,
    p_user_name: session.userName ?? null,
    p_public_token: session.publicToken ?? null,
    p_expires_at: expiresAt,
  });
  if (error) throw new ProviderError(`Could not save the Kite session: ${error.message}`, "kite-rest", 502);
  return { persisted: true, expiresAt };
}

export async function clearKiteSession(): Promise<void> {
  memory = null;
  const file = sessionFile();
  if (file && existsSync(file)) {
    try {
      unlinkSync(file);
    } catch {
      // Best effort: an unreadable file is already treated as absent.
    }
  }

  const apiKey = kiteApiKey();
  const backing = store();
  if (!backing || !apiKey) return;
  await backing.client.rpc("clear_kite_session", { p_key: backing.bridgeKey, p_api_key: apiKey });
}

// ------------------------------------------------------------- token swap ---

/** sha256(api_key + request_token + api_secret) — Kite Connect v3's proof of secret. */
export function loginChecksum(apiKey: string, requestToken: string, apiSecret: string): string {
  return createHash("sha256").update(`${apiKey}${requestToken}${apiSecret}`).digest("hex");
}

export interface ExchangeResult {
  accessToken: string;
  publicToken?: string;
  userId?: string;
  userName?: string;
}

/** Step 3 of the login: turn the one-time request token into an access token. */
export async function exchangeRequestToken(requestToken: string): Promise<ExchangeResult> {
  const apiKey = kiteApiKey();
  const apiSecret = kiteApiSecret();
  if (!apiKey || !apiSecret) {
    throw new ProviderError(
      "KITE_API_KEY and KITE_API_SECRET must both be set to complete a Kite login.",
      "kite-rest",
      500
    );
  }

  const body = new URLSearchParams({
    api_key: apiKey,
    request_token: requestToken,
    checksum: loginChecksum(apiKey, requestToken, apiSecret),
  });

  const response = await fetchWithTimeout(
    `${kiteBaseUrl()}/session/token`,
    {
      method: "POST",
      headers: {
        "X-Kite-Version": "3",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
    "kite-rest"
  );

  const text = await response.text();
  let payload: { status?: string; message?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new ProviderError(`Kite returned a non-JSON session response: ${text.slice(0, 200)}`, "kite-rest");
  }

  if (!response.ok || payload.status !== "success" || !payload.data) {
    throw new ProviderError(
      payload.message ?? `Kite rejected the login (HTTP ${response.status}).`,
      "kite-rest",
      response.status === 400 || response.status === 403 ? 401 : 502
    );
  }

  const data = payload.data;
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) throw new ProviderError("Kite's session response carried no access_token.", "kite-rest");

  return {
    accessToken,
    publicToken: typeof data.public_token === "string" ? data.public_token : undefined,
    userId: typeof data.user_id === "string" ? data.user_id : undefined,
    userName: typeof data.user_name === "string" ? data.user_name : undefined,
  };
}

// ---------------------------------------------------------------- helpers ---

/**
 * Zerodha invalidates access tokens at the next pre-open, about 06:00 IST.
 * Anything issued after that today therefore dies tomorrow morning.
 */
export function nextTokenExpiry(now = new Date()): Date {
  const IST_OFFSET_MS = 5.5 * 3_600_000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const sixAm = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 0, 0);
  const target = sixAm > ist.getTime() ? sixAm : sixAm + 86_400_000;
  return new Date(target - IST_OFFSET_MS);
}

function isExpired(iso: string): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms <= Date.now() : true;
}

/** Clears the in-process cache — used after a sign-out or a failed call. */
export function forgetCachedKiteSession(): void {
  memory = null;
}
