/**
 * Retries a Supabase query when it fails at the transport layer.
 *
 * Local TLS-inspecting antivirus (Avast's `aswMonFltProxy`) intermittently
 * resets or stalls the connection to Supabase on this machine -- measured at
 * roughly one failure in three, with successes ranging 0.5s to 8s. Without a
 * retry the page renders "could not load" against a perfectly healthy
 * database often enough to be useless.
 *
 * supabase-js does not throw on a failed fetch; it resolves with
 * `{ data: null, error }`, so retrying has to inspect the result rather than
 * catch. A PostgrestError carries a `code` (a real database or policy
 * rejection, which will fail identically every time); a transport failure has
 * none. Only the latter is worth another attempt.
 *
 * Deliberately read-only. A write must not be replayed blindly: a request that
 * fails *after* the insert landed would duplicate the card.
 */

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

function isTransient(error: { code?: string } | null): boolean {
  return error !== null && !error.code;
}

export async function retryRead<T>(
  run: () => PromiseLike<QueryResult<T>>,
  { attempts = 3, delayMs = 400 }: { attempts?: number; delayMs?: number } = {}
): Promise<QueryResult<T>> {
  let result = await run();
  for (let i = 1; i < attempts && isTransient(result.error); i++) {
    await new Promise((r) => setTimeout(r, delayMs * i));
    result = await run();
  }
  return result;
}
