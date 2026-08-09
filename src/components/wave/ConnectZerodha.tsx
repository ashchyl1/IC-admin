"use client";

/**
 * Zerodha connection state, the setup it needs, and the sign-in that finishes
 * it.
 *
 * Connecting has two stages, and the first one is easy to miss: the app has to
 * be pointed at a Kite MCP endpoint (an env var and a restart), and only then
 * is there anything to sign in to. An earlier version showed a sign-in button
 * solely once a provider was configured, which meant the most common state —
 * wanting to connect, not yet configured — was a badge reading "Not connected"
 * and no way forward. So the panel now leads with setup when that is the step
 * you are on, and with sign-in when it is not.
 */

import * as React from "react";
import { Check, Copy, ExternalLink, KeyRound, Loader2, PlugZap, RefreshCw, TriangleAlert } from "lucide-react";

import { getMarketClient, type MarketStatus } from "@/lib/market/client";
import { Badge, Button, clsx } from "@/components/scalper/ui";

interface Props {
  onNotify: (tone: "info" | "error" | "success", message: string) => void;
  onReload: () => void;
}

/** What to paste into `.env`, for the endpoint most people will use. */
const ENV_SNIPPET = `MARKET_PROVIDER=kite-mcp
KITE_MCP_URL=https://mcp.kite.trade/mcp`;

export function ConnectZerodha({ onNotify, onReload }: Props) {
  const [status, setStatus] = React.useState<MarketStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [loginUrl, setLoginUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const refresh = React.useCallback(async () => {
    const client = getMarketClient();
    if (!client.status) return; // standalone build — nothing to connect to
    try {
      setStatus(await client.status());
      setStatusError(null);
    } catch (error) {
      // Say so rather than disappearing: a hidden control is indistinguishable
      // from a missing feature.
      setStatusError(error instanceof Error ? error.message : "Status check failed");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The standalone build has no server, so there is genuinely nothing to show.
  if (!getMarketClient().status) return null;

  const connected = status?.diagnostics?.ready ?? status?.active?.live ?? false;
  const needsLogin = status?.diagnostics?.needsLogin ?? false;
  const configured = (status?.chain ?? []).some((entry) => entry.id !== "synthetic");

  const label = statusError
    ? "Data status"
    : connected
      ? "Zerodha"
      : needsLogin
        ? "Sign in to Kite"
        : configured
          ? "Not connected"
          : "Connect data";

  const signIn = async () => {
    const client = getMarketClient();
    if (!client.login) return;
    setBusy(true);
    try {
      const challenge = await client.login();
      setLoginUrl(challenge.url);
      if (challenge.url) {
        window.open(challenge.url, "_blank", "noopener,noreferrer");
        onNotify("info", "Sign in to Kite in the new tab, then choose Reload data.");
        setOpen(true);
      } else {
        onNotify("error", challenge.message);
      }
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const copyEnv = async () => {
    try {
      await navigator.clipboard.writeText(ENV_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify("error", "Clipboard blocked — copy the two lines by hand.");
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        aria-expanded={open}
        title={
          connected
            ? `Connected to ${status?.active?.label}`
            : configured
              ? "Configured but not returning data — open for details"
              : "Charts are showing simulated data. Open to connect Zerodha."
        }
        className={clsx(
          "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors",
          statusError
            ? "border-rose-700/60 bg-rose-900/30 text-rose-200 hover:bg-rose-900/50"
            : connected
              ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50"
              : "border-amber-700/60 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50"
        )}
      >
        {statusError ? <TriangleAlert className="h-3 w-3" /> : <PlugZap className="h-3 w-3" />}
        {label}
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-40 max-h-[70vh] w-[360px] overflow-y-auto rounded-md border border-slate-700 bg-[#0f1725] p-3 text-[11px] shadow-2xl">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-slate-400">Market data</span>
            <Badge tone={connected ? "green" : "amber"}>{status?.active?.label ?? "unknown"}</Badge>
          </div>

          {statusError ? (
            <p className="mb-2 rounded border border-rose-800/60 bg-rose-950/40 px-2 py-1.5 leading-relaxed text-rose-100">
              Could not read the data status: {statusError}
            </p>
          ) : null}

          {/* ------------------------------------------------------ setup --- */}
          {!configured ? (
            <div className="space-y-2">
              <p className="leading-relaxed text-slate-300">
                No broker is connected, so both charts are drawing generated prices. Connecting is two
                steps — point the app at a Kite MCP endpoint, then sign in.
              </p>

              <ol className="space-y-1.5 text-slate-400">
                <li>
                  <span className="font-semibold text-slate-300">1.</span> Add these to{" "}
                  <code className="rounded bg-slate-800 px-1 text-[10px] text-slate-200">.env</code> in the
                  project root:
                  <pre className="mt-1 overflow-x-auto rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-cyan-200">
{ENV_SNIPPET}
                  </pre>
                  <button
                    type="button"
                    onClick={copyEnv}
                    className="mt-1 inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </li>
                <li>
                  <span className="font-semibold text-slate-300">2.</span> Restart the dev server — env
                  vars are read once at boot.
                </li>
                <li>
                  <span className="font-semibold text-slate-300">3.</span> Come back here and choose{" "}
                  <span className="font-semibold text-slate-300">Sign in to Kite</span>, which will appear
                  once an endpoint is configured.
                </li>
              </ol>

              <p className="leading-relaxed text-slate-500">
                Running your own bridge instead? Point{" "}
                <code className="rounded bg-slate-800 px-1 text-[10px] text-slate-300">KITE_MCP_URL</code>{" "}
                at it. Prefer Kite Connect REST? Set{" "}
                <code className="rounded bg-slate-800 px-1 text-[10px] text-slate-300">KITE_API_KEY</code>{" "}
                and{" "}
                <code className="rounded bg-slate-800 px-1 text-[10px] text-slate-300">KITE_ACCESS_TOKEN</code>{" "}
                instead — that path uses a daily token rather than this sign-in. Historical candles need
                Zerodha&apos;s historical-data entitlement on your API key.
              </p>
            </div>
          ) : (
            <>
              <dl className="space-y-1 text-slate-400">
                <Row label="Mode">{status?.mode}</Row>
                <Row label="Chain">{(status?.chain ?? []).map((entry) => entry.label).join(" → ")}</Row>
                {status?.active?.detail ? <Row label="Endpoint">{status.active.detail}</Row> : null}
                {status?.diagnostics?.resolved ? (
                  <Row label="Tools">
                    {Object.entries(status.diagnostics.resolved)
                      .map(([job, tool]) => `${job}: ${tool ?? "—"}`)
                      .join(", ")}
                  </Row>
                ) : null}
              </dl>

              {status?.diagnostics?.detail && !connected ? (
                <p className="mt-2 rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1.5 leading-relaxed text-amber-100">
                  {status.diagnostics.detail}
                </p>
              ) : null}
            </>
          )}

          {loginUrl ? (
            <a
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 rounded border border-cyan-800/60 bg-cyan-950/40 px-2 py-1.5 text-cyan-200 hover:bg-cyan-900/40"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">Open the Kite sign-in again</span>
            </a>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {status?.canLogin ? (
              <Button tone="accent" disabled={busy} onClick={signIn}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                {connected ? "Re-authorise" : "Sign in to Kite"}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                void refresh();
                onReload();
              }}
            >
              <RefreshCw className="h-3 w-3" />
              {configured ? "Reload data" : "Re-check"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-300">{children}</dd>
    </div>
  );
}
