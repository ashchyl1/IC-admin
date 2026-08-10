"use client";

/**
 * Persistent connection badge and its panel. §2.2.
 *
 * The rule that shapes this component: **the panel must render something
 * useful in every state, including the unconfigured one.** A sign-in button
 * that only appears once you are already configured is a button nobody can
 * find, so "not configured" gets the setup checklist rather than an empty box.
 */

import * as React from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionState, ProviderInfo } from "@/lib/wave-lab/types";

interface SessionPayload {
  provider: ProviderInfo;
  configuredKind: string;
  mcpConfigured: boolean;
  connection: ConnectionState;
  setupSteps: string[];
}

const DOT: Record<ConnectionState["status"], string> = {
  "signed-in": "bg-[var(--wl-profit)]",
  "signed-out": "bg-[var(--wl-amber)]",
  "not-configured": "bg-[var(--wl-muted)]",
  error: "bg-[var(--wl-sell)]",
};

function label(state: ConnectionState, provider: ProviderInfo): string {
  switch (state.status) {
    case "signed-in":
      return state.userName;
    case "signed-out":
      return "Signed out";
    case "not-configured":
      return provider.live ? "Not configured" : provider.label;
    case "error":
      return "Connection error";
  }
}

export function ConnectionBadge() {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SessionPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [signingIn, setSigningIn] = React.useState(false);
  const [loginUrl, setLoginUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wave-lab/session", { cache: "no-store" });
      const json = (await res.json()) as SessionPayload;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the connection state.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function startSignIn() {
    setSigningIn(true);
    setError(null);
    try {
      const res = await fetch("/api/wave-lab/session", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start sign-in.");
      setLoginUrl(json.loginUrl);
      window.open(json.loginUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in.");
    } finally {
      setSigningIn(false);
    }
  }

  const connection = data?.connection;
  const provider = data?.provider;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-[3px] border border-[var(--wl-border)] px-2 py-1 text-[11px] font-medium text-[var(--wl-text)] transition-colors hover:bg-[var(--wl-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-blue)]"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            connection ? DOT[connection.status] : "bg-[var(--wl-muted)]"
          )}
        />
        {loading && !data ? "Checking…" : connection && provider ? label(connection, provider) : "Unknown"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-[3px] border border-[var(--wl-border)] bg-[var(--wl-bg)] p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[var(--wl-text-strong)]">
              Market data connection
            </h3>
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Re-check connection"
              className="rounded-[3px] p-1 text-[var(--wl-muted)] transition-colors hover:bg-[var(--wl-hover)] hover:text-[var(--wl-text)]"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>

          {provider && (
            <p className="mt-2 text-xs text-[var(--wl-muted)]">
              Provider: <span className="text-[var(--wl-text)]">{provider.label}</span>
              {!provider.live && (
                <span className="ml-1 rounded-[3px] bg-[var(--wl-amber)]/15 px-1 py-px text-[10px] font-semibold uppercase text-[var(--wl-amber)]">
                  synthetic
                </span>
              )}
            </p>
          )}

          {connection && (
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--wl-text)]">
              {connection.status === "signed-in"
                ? `Signed in as ${connection.userName}.`
                : connection.detail}
            </p>
          )}

          {/* The unconfigured state gets the checklist, not an empty box. */}
          {data?.setupSteps && data.setupSteps.length > 0 && (
            <ol className="mt-2.5 space-y-1 border-t border-[var(--wl-border)] pt-2.5">
              {data.setupSteps.map((step, i) => (
                <li key={step} className="flex gap-2 text-xs text-[var(--wl-muted)]">
                  <span className="shrink-0 font-semibold text-[var(--wl-text)]">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}

          {error && <p className="mt-2 text-xs text-[var(--wl-sell)]">{error}</p>}

          {data?.mcpConfigured && connection?.status !== "signed-in" && (
            <button
              type="button"
              onClick={() => void startSignIn()}
              disabled={signingIn}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-[var(--wl-blue)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {signingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Sign in to Kite
            </button>
          )}

          {loginUrl && (
            <p className="mt-2 break-all text-[11px] text-[var(--wl-muted)]">
              If the tab did not open,{" "}
              <a
                href={loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[var(--wl-blue)] underline underline-offset-2"
              >
                open the Kite login <ExternalLink className="h-3 w-3" />
              </a>
              , then press the refresh icon above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
