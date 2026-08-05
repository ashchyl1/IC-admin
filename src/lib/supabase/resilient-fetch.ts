/**
 * A `fetch` that retries transport failures, including on writes -- but only
 * when it is provably safe to replay the request.
 *
 * Why: local TLS-inspecting antivirus (Avast's `aswMonFltProxy`) makes the
 * connection to Supabase fail roughly one attempt in three on this machine,
 * with `UND_ERR_CONNECT_TIMEOUT` or `ECONNRESET`. Without this, saving a
 * recommendation fails about as often as it succeeds.
 *
 * The safety rule is about *where* the failure happened, not which method was
 * used:
 *
 *   - Connect-phase errors (DNS never resolved, TCP never established) mean
 *     the request never reached Supabase, so no row was written and nothing
 *     can be duplicated. Safe to replay for any method, POST included.
 *
 *   - Anything else -- a reset mid-flight, a socket closing after the headers
 *     went out -- is ambiguous: the insert may well have landed and only the
 *     response was lost. Replaying that would duplicate the row. So those are
 *     retried only for GET/HEAD and re-thrown for everything else.
 *
 * The body must be replayable for this to be correct. supabase-js sends
 * strings, Buffers and Uint8Arrays, all of which can be re-read; a streaming
 * body could not, and would need to be excluded here.
 */

/** Errors that prove the request never left this machine. */
const NEVER_SENT = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

function causeCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createResilientFetch({
  attempts = 4,
  baseDelayMs = 300,
}: { attempts?: number; baseDelayMs?: number } = {}): typeof fetch {
  return async function resilientFetch(input, init) {
    const method = (init?.method ?? "GET").toUpperCase();
    const replayableAnyway = method === "GET" || method === "HEAD";

    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fetch(input, init);
      } catch (err) {
        lastError = err;

        const code = causeCode(err);
        const neverSent = code !== undefined && NEVER_SENT.has(code);
        // Ambiguous failure on a mutating request: fail loudly rather than
        // risk writing the same row twice.
        if (!neverSent && !replayableAnyway) throw err;
        if (attempt === attempts - 1) break;

        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  };
}
