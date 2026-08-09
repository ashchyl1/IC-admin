/**
 * Pre-flight for the Zerodha login.
 *
 *   npm run kite:doctor
 *
 * The Kite Connect sign-in fails in a handful of predictable ways, and most of
 * them surface as an unhelpful redirect rather than an error: a redirect URL
 * that does not match the developer console, a secret that was never set, a
 * token that quietly expired at 06:00. This checks each one up front and says
 * what to fix, so the first attempt is the one that works.
 *
 * Reads `.env` directly — it runs before the server does.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const env = { ...loadEnvFile(path.join(root, ".env")), ...process.env };

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

let blocking = 0;

// ------------------------------------------------------------ credentials ---
head("Kite Connect credentials");

const apiKey = env.KITE_API_KEY?.trim();
const apiSecret = env.KITE_API_SECRET?.trim();
const provider = env.MARKET_PROVIDER?.trim() || "auto";

if (apiKey) ok(`KITE_API_KEY set (${apiKey.slice(0, 4)}…)`);
else {
  bad("KITE_API_KEY is not set — the login cannot start.");
  blocking += 1;
}

if (apiSecret) ok("KITE_API_SECRET set");
else {
  bad("KITE_API_SECRET is not set. Without it the request token cannot be exchanged.");
  blocking += 1;
}

if (provider === "kite-rest") ok("MARKET_PROVIDER=kite-rest");
else if (provider === "auto") warn(`MARKET_PROVIDER=auto — set it to kite-rest to pin this path.`);
else warn(`MARKET_PROVIDER=${provider} — the Kite Connect login only feeds the kite-rest provider.`);

// ----------------------------------------------------------- redirect URL ---
head("Redirect URL");

const redirect = env.KITE_REDIRECT_URL?.trim();
if (!redirect) {
  warn("KITE_REDIRECT_URL is not set; it defaults to http://localhost:3040/api/kite/callback.");
} else {
  try {
    const url = new URL(redirect);
    if (url.pathname !== "/api/kite/callback") {
      bad(`Path is "${url.pathname}" — it must end in /api/kite/callback.`);
      blocking += 1;
    } else {
      ok(`${redirect}`);
    }
  } catch {
    bad(`KITE_REDIRECT_URL is not a valid URL: ${redirect}`);
    blocking += 1;
  }
}
console.log(
  "    This must match the redirect URL on your Kite developer console character for\n" +
    "    character. Zerodha ignores any redirect sent at login time, so a mismatch shows\n" +
    "    up as a login that lands somewhere unexpected rather than as an error."
);

// ------------------------------------------------------------ reachability ---
head("Reachability");

for (const host of ["api.kite.trade", "kite.zerodha.com"]) {
  const result = await canReach(`https://${host}/`);
  if (result.reachable) ok(`${host} reachable`);
  else {
    bad(`${host} is not reachable: ${result.reason}`);
    blocking += 1;
  }
}

// --------------------------------------------------------- stored session ---
head("Stored session");

const sessionPath = env.KITE_SESSION_FILE && !["0", "1", "false"].includes(env.KITE_SESSION_FILE)
  ? path.resolve(env.KITE_SESSION_FILE)
  : path.join(root, ".kite-session.json");

if (env.KITE_ACCESS_TOKEN?.trim()) {
  warn("KITE_ACCESS_TOKEN is set — it overrides any signed-in session. Unset it to use the login.");
} else if (existsSync(sessionPath)) {
  try {
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    const expires = Date.parse(session.expiresAt);
    if (Number.isFinite(expires) && expires > Date.now()) {
      ok(`Signed in as ${session.userName ?? session.userId ?? "?"}, valid until ${new Date(expires).toLocaleString()}`);
    } else {
      warn("A stored token exists but has expired. Sign in again — tokens die at about 06:00 IST.");
    }
  } catch {
    warn(`${path.relative(root, sessionPath)} exists but could not be read; it will be ignored.`);
  }
} else {
  warn("No stored token yet. Sign in from the chart's connection panel.");
}

// ---------------------------------------------------------- supabase store ---
head("Supabase candle store (optional)");

const hasSupabase =
  env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() &&
  env.SUPABASE_BRIDGE_KEY?.trim();

if (hasSupabase) {
  ok("Configured — candles will be cached and the token kept across restarts.");
} else {
  warn(
    "Not configured. The chart still works; bars are re-fetched from Kite each time\n" +
      "    and the token is kept only in .kite-session.json. Needs NEXT_PUBLIC_SUPABASE_URL,\n" +
      "    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_BRIDGE_KEY."
  );
}

// -------------------------------------------------------------- conclusion ---
console.log("");
if (blocking === 0) {
  console.log("\x1b[32mReady.\x1b[0m Run `npm run dev`, open http://localhost:3040/wave-lab,");
  console.log("then the connection badge → Sign in with Kite Connect.");
} else {
  console.log(`\x1b[31m${blocking} thing${blocking > 1 ? "s" : ""} to fix before the login will work.\x1b[0m`);
  process.exitCode = 1;
}
console.log(
  "\nNote: historical candles need Zerodha's historical-data subscription on your API\n" +
    "key. Being signed in is not the same thing — quotes can work while historical\n" +
    "returns nothing."
);

// ------------------------------------------------------------------ helpers ---

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Reachability, not "did fetch resolve".
 *
 * Any HTTP status from the host itself means TCP and TLS got there, which is
 * all this needs to know — Kite's root path is not a health endpoint and may
 * legitimately answer 403 or 404. But a sandboxed or corporate network can
 * proxy egress and deny by allowlist, which also resolves, with a 403 that came
 * from the proxy rather than from Zerodha. Treating that as reachable is how a
 * doctor ends up certifying a machine that cannot possibly log in.
 */
async function canReach(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    if (response.status === 403) {
      const body = await response.text().catch(() => "");
      if (/not in allowlist|egress|blocked by|proxy/i.test(body)) {
        return { reachable: false, reason: body.replace(/\s+/g, " ").trim().slice(0, 110) };
      }
    }
    return { reachable: true };
  } catch (error) {
    const reason = controller.signal.aborted ? "timed out after 8s" : error.message;
    return { reachable: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
