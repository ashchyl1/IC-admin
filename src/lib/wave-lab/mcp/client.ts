import "server-only";

/**
 * Streamable-HTTP MCP client for Zerodha's server. §2.1 of the brief.
 *
 * Hand-rolled against the spec rather than pulled from a package, because the
 * three things that actually break here are all environmental and none of them
 * are a library's fault:
 *
 *  1. Responses arrive as `application/json` OR `text/event-stream`. A client
 *     that only parses JSON passes every test and dies in production, because
 *     which one you get depends on the server's mood about the payload.
 *  2. The `Mcp-Session-Id` must be cached ACROSS HTTP requests. Next compiles
 *     routes per-request, so a plain module-level variable is re-initialised
 *     constantly and the user is asked to log in on every chart pan (§12.7).
 *  3. Tool names must be discovered, not hardcoded, so a server-side rename
 *     does not take the app down.
 *
 * Credentials never leave the server: this module is `server-only` (§12.6).
 */

/** Tool-name patterns we refuse to dispatch, no matter who asks. §12.8. */
const FORBIDDEN_TOOL_PATTERN =
  /(place|modify|cancel|exit|square[_\s-]?off)[_\s-]?(order|position|trade|gtt)|^(buy|sell)$|order[_\s-]?(place|modify|cancel)/i;

/**
 * Refusing order-shaped tools is a check in the call path, not a code-review
 * convention. The brief is explicit that nothing in this application may place
 * a real order; a pattern here means a future caller cannot do it by accident
 * even if the server offers the tool and something upstream asks for it.
 */
export function isForbiddenTool(name: string): boolean {
  return FORBIDDEN_TOOL_PATTERN.test(name);
}

export class ForbiddenToolError extends Error {
  constructor(toolName: string) {
    super(
      `Refusing to call MCP tool "${toolName}": this application never places, modifies or cancels real orders.`
    );
    this.name = "ForbiddenToolError";
  }
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  isError: boolean;
  /** Concatenated text content across all returned blocks. */
  text: string;
  /** First structured payload, when the server returns one. */
  structured?: unknown;
  raw: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Parses an SSE body into its JSON-RPC frames.
 *
 * Frames are separated by a blank line; each may carry `event:`, `id:` and one
 * or more `data:` lines, and per the SSE spec multiple `data:` lines in a frame
 * concatenate with newlines. Non-JSON frames (comments, keep-alives) are
 * skipped rather than thrown on — a heartbeat is not an error.
 */
export function parseSseFrames(body: string): JsonRpcResponse[] {
  const out: JsonRpcResponse[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      out.push(JSON.parse(data) as JsonRpcResponse);
    } catch {
      // A frame we cannot parse is not fatal; the caller checks for a match.
    }
  }
  return out;
}

/** Pull the useful bits out of an MCP `tools/call` result envelope. */
export function normaliseCallResult(result: unknown): McpCallResult {
  const r = (result ?? {}) as Record<string, unknown>;
  const content = Array.isArray(r.content) ? r.content : [];
  const text = content
    .map((block) => {
      const b = block as Record<string, unknown>;
      return typeof b.text === "string" ? b.text : "";
    })
    .filter(Boolean)
    .join("\n");
  return {
    isError: r.isError === true,
    text,
    structured: r.structuredContent,
    raw: result,
  };
}

/**
 * Does this failure mean "sign in", as opposed to any other error? §2.2.
 *
 * `exemptLoginTool` matters more than it looks: the login tool's own successful
 * reply contains the word "login" by nature, so without the exemption the
 * detector fires on the very call that fixes the problem and the UI loops.
 */
export function looksLikeAuthFailure(text: string): boolean {
  return /login|authenticat|session expired|unauthor|not logged in/i.test(text);
}

interface SessionEntry {
  sessionId: string | null;
  initialisedAt: number;
  tools: McpToolDescriptor[] | null;
}

/**
 * Session cache keyed on `${serverUrl}|${token}`.
 *
 * Parked on `globalThis` deliberately. Module-level state does not survive
 * request boundaries under Next's per-route compilation (§12.7), but the
 * global object does for the life of the Node process, which is what "durable
 * enough for a session id" means here.
 */
const CACHE_KEY = Symbol.for("wave-lab.mcp.sessions");
type SessionCache = Map<string, SessionEntry>;

function sessionCache(): SessionCache {
  const g = globalThis as unknown as Record<symbol, SessionCache | undefined>;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY]!;
}

export interface McpClientOptions {
  serverUrl: string;
  /** Optional bearer token; part of the cache key so sessions never cross. */
  token?: string;
  timeoutMs?: number;
}

export class KiteMcpClient {
  private readonly serverUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly cacheKey: string;
  private nextId = 1;

  constructor(options: McpClientOptions) {
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.cacheKey = `${this.serverUrl}|${this.token ?? ""}`;
  }

  private entry(): SessionEntry {
    const cache = sessionCache();
    let e = cache.get(this.cacheKey);
    if (!e) {
      e = { sessionId: null, initialisedAt: 0, tools: null };
      cache.set(this.cacheKey, e);
    }
    return e;
  }

  /** Drop the cached session so the next call re-initialises. */
  reset(): void {
    sessionCache().delete(this.cacheKey);
  }

  get sessionId(): string | null {
    return this.entry().sessionId;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      // Both, because the server picks. See parseSseFrames.
      Accept: "application/json, text/event-stream",
    };
    const sid = this.entry().sessionId;
    if (sid) h["Mcp-Session-Id"] = sid;
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** One JSON-RPC round trip. Returns null for notifications (no id). */
  private async rpc(
    method: string,
    params?: unknown,
    { notification = false }: { notification?: boolean } = {}
  ): Promise<unknown> {
    const id = notification ? undefined : this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined && { id }), method, params });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.serverUrl, {
        method: "POST",
        headers: this.headers(),
        body,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not reach the Kite MCP server at ${this.serverUrl}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    // The session id arrives on the initialize response and must be echoed on
    // everything after it.
    const returnedSession = res.headers.get("mcp-session-id");
    if (returnedSession) this.entry().sessionId = returnedSession;

    if (res.status === 404 && this.entry().sessionId) {
      // Server forgot the session; clear it so the caller can retry clean.
      this.reset();
      throw new Error("The MCP session expired. Retry to start a new one.");
    }

    if (notification) return null;

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();

    if (!res.ok && !raw) {
      throw new Error(`Kite MCP server returned HTTP ${res.status} with an empty body.`);
    }

    let payload: JsonRpcResponse | undefined;
    if (contentType.includes("text/event-stream")) {
      const frames = parseSseFrames(raw);
      payload = frames.find((f) => f.id === id) ?? frames[frames.length - 1];
    } else {
      try {
        payload = JSON.parse(raw) as JsonRpcResponse;
      } catch {
        throw new Error(
          `Kite MCP server returned a non-JSON ${contentType || "response"} (HTTP ${res.status}).`
        );
      }
    }

    if (!payload) {
      throw new Error(`Kite MCP server returned no usable frame for ${method}.`);
    }
    if (payload.error) {
      throw new Error(`Kite MCP ${method} failed: ${payload.error.message}`);
    }
    return payload.result;
  }

  /** Initialise once per cached session; cheap no-op afterwards. */
  async ensureInitialised(): Promise<void> {
    const e = this.entry();
    if (e.sessionId) return;

    await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "wave-lab", version: "1.0.0" },
    });
    e.initialisedAt = Date.now();
    // Per spec the server expects this before real traffic.
    await this.rpc("notifications/initialized", undefined, { notification: true });
  }

  async listTools(force = false): Promise<McpToolDescriptor[]> {
    const e = this.entry();
    if (e.tools && !force) return e.tools;
    await this.ensureInitialised();
    const result = (await this.rpc("tools/list")) as { tools?: McpToolDescriptor[] } | undefined;
    e.tools = result?.tools ?? [];
    return e.tools;
  }

  /**
   * Find a tool by pattern rather than by exact name, so a server-side rename
   * degrades to "slightly different tool chosen" instead of a dead app (§2.1).
   */
  async findTool(pattern: RegExp): Promise<McpToolDescriptor | null> {
    const tools = await this.listTools();
    return tools.find((t) => pattern.test(t.name)) ?? null;
  }

  /**
   * Call a tool by name.
   *
   * `exemptAuthDetection` is for the login tool: its own reply necessarily
   * contains "login", and without the exemption we would classify a successful
   * sign-in prompt as an auth failure.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    { exemptAuthDetection = false }: { exemptAuthDetection?: boolean } = {}
  ): Promise<McpCallResult> {
    if (isForbiddenTool(name)) throw new ForbiddenToolError(name);

    await this.ensureInitialised();
    const result = await this.rpc("tools/call", { name, arguments: args });
    const normalised = normaliseCallResult(result);

    if (!exemptAuthDetection && normalised.isError && looksLikeAuthFailure(normalised.text)) {
      const { AuthRequiredError } = await import("../types");
      throw new AuthRequiredError(
        normalised.text || "Kite session expired. Sign in again to continue."
      );
    }
    return normalised;
  }
}
