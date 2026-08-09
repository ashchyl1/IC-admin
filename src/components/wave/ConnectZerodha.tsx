"use client";

/**
 * Zerodha connection state, and the sign-in that fixes it.
 *
 * Kite MCP binds an authorised Kite session to the MCP session id, so
 * connecting is a browser round trip: call the login tool, open the URL it
 * returns, sign in, come back. This surfaces that as one button instead of an
 * error in a server log, and shows what the provider actually discovered so a
 * misconfigured endpoint is diagnosable from the page.
 */

import * as React from "react";
import { KeyRound, Link2, Loader2, PlugZap, RefreshCw } from "lucide-react";

import { getMarketClient, type MarketStatus } from "@/lib/market/client";
import { Badge, Button, clsx } from "@/components/scalper/ui";

interface Props {
  onNotify: (tone: "info" | "error" | "success", message: string) => void;
  onReload: () => void;
}

export function ConnectZerodha({ onNotify, onReload }: Props) {
  const [status, setStatus] = React.useState<MarketStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [loginUrl, setLoginUrl] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const refresh = React.useCallback(async () => {
    const client = getMarketClient();
    if (!client.status) return; // standalone build — nothing to connect to
    try {
      setStatus(await client.status());
    } catch {
      // The badge simply stays hidden; the per-terminal source badge already
      // tells the analyst the data is simulated.
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

  if (!status || !getMarketClient().status) return null;

  const connected = status.diagnostics?.ready ?? status.active?.live ?? false;
  const needsLogin = status.diagnostics?.needsLogin ?? false;

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

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        aria-expanded={open}
        title={
          connected
            ? `Connected to ${status.active?.label}`
            : "Not connected to a broker — charts are showing simulated data"
        }
        className={clsx(
          "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors",
          connected
            ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50"
            : "border-amber-700/60 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50"
        )}
      >
        <PlugZap className="h-3 w-3" />
        {connected ? "Zerodha" : needsLogin ? "Sign in" : "Not connected"}
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-40 w-80 rounded-md border border-slate-700 bg-[#0f1725] p-3 text-[11px] shadow-2xl">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-slate-400">Market data</span>
            <Badge tone={connected ? "green" : "amber"}>{status.active?.label ?? "none"}</Badge>
          </div>

          <dl className="space-y-1 text-slate-400">
            <Row label="Mode">{status.mode}</Row>
            <Row label="Chain">{status.chain.map((entry) => entry.label).join(" → ")}</Row>
            {status.active?.detail ? <Row label="Endpoint">{status.active.detail}</Row> : null}
            {status.diagnostics?.resolved ? (
              <Row label="Tools">
                {Object.entries(status.diagnostics.resolved)
                  .map(([job, tool]) => `${job}: ${tool ?? "—"}`)
                  .join(", ")}
              </Row>
            ) : null}
          </dl>

          {status.diagnostics?.detail && !connected ? (
            <p className="mt-2 rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1.5 leading-relaxed text-amber-100">
              {status.diagnostics.detail}
            </p>
          ) : null}

          {loginUrl ? (
            <a
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 rounded border border-cyan-800/60 bg-cyan-950/40 px-2 py-1.5 text-cyan-200 hover:bg-cyan-900/40"
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">Open the Kite sign-in again</span>
            </a>
          ) : null}

          <div className="mt-2.5 flex items-center gap-1.5">
            {status.canLogin ? (
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
              Reload data
            </Button>
          </div>

          {!status.canLogin && !connected ? (
            <p className="mt-2 leading-relaxed text-slate-500">
              No provider is configured. Set <code className="text-slate-300">KITE_MCP_URL</code> for
              Zerodha MCP, or <code className="text-slate-300">KITE_API_KEY</code> +{" "}
              <code className="text-slate-300">KITE_ACCESS_TOKEN</code> for Kite REST, then restart the
              server.
            </p>
          ) : null}
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
