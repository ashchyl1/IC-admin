"use client";

import * as React from "react";
import Link from "next/link";

import { Badge, Button, Card, Input, Label, Select } from "@/components/ui/primitives";
import * as api from "@/lib/paper/api";
import { TIMEFRAMES } from "@/lib/paper/types";
import type { Instrument } from "@/lib/supabase/types";
import {
  guessColumns,
  parseCsv,
  validateRows,
  type ColumnMap,
  type ParsedCsv,
  type ValidationReport,
} from "@/lib/paper/csv";
import { marketTime, num } from "@/lib/paper/format";

const ZONES = ["Asia/Kolkata", "UTC", "America/New_York", "Europe/London", "Asia/Singapore"];

export default function ImportPage() {
  const [instruments, setInstruments] = React.useState<Instrument[]>([]);
  const [parsed, setParsed] = React.useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [columns, setColumns] = React.useState<Partial<ColumnMap>>({});
  const [timeZone, setTimeZone] = React.useState("Asia/Kolkata");
  const [timeframe, setTimeframe] = React.useState("day");
  const [target, setTarget] = React.useState<"existing" | "new">("existing");
  const [instrumentId, setInstrumentId] = React.useState("");
  const [fresh, setFresh] = React.useState({ symbol: "", exchange: "NSE", name: "", tick_size: "0.05", lot_size: "1" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    api.listInstruments().then((rows) => {
      setInstruments(rows);
      if (rows.length) setInstrumentId(rows[0].id);
      else setTarget("new");
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const report: ValidationReport | null = React.useMemo(() => {
    if (!parsed || !columns.timestamp || !columns.open || !columns.high || !columns.low || !columns.close) {
      return null;
    }
    return validateRows(parsed.rows, columns as ColumnMap, timeZone);
  }, [parsed, columns, timeZone]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    const p = parseCsv(text);
    if (!p.headers.length) {
      setError("That file has no readable header row.");
      return;
    }
    setParsed(p);
    setColumns(guessColumns(p.headers));
  }

  async function upload() {
    if (!report || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/paper/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeframe,
          instrument:
            target === "existing"
              ? { id: instrumentId }
              : {
                  symbol: fresh.symbol.trim().toUpperCase(),
                  exchange: fresh.exchange.trim().toUpperCase(),
                  name: fresh.name || fresh.symbol,
                  timezone: timeZone,
                  tick_size: Number(fresh.tick_size),
                  lot_size: Number(fresh.lot_size),
                },
          candles: report.valid,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
      setInstruments(await api.listInstruments());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    !!report &&
    report.valid.length > 0 &&
    (target === "existing" ? !!instrumentId : !!fresh.symbol && !!fresh.exchange);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">Import OHLCV history</h1>
        <Link href="/paper-trading" className="text-xs underline underline-offset-4">
          back to sessions
        </Link>
      </div>

      <Card className="space-y-4 p-4">
        <div>
          <Label htmlFor="csv">CSV file</Label>
          <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} className="mt-1" />
          <p className="mt-1 text-xs text-muted-foreground">
            Any header names work — map them below. Timestamps carrying their own offset are used as-is;
            naive ones are read in the timezone you pick.
          </p>
        </div>

        {parsed ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {(["timestamp", "open", "high", "low", "close", "volume"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{key}</Label>
                  <Select
                    className="w-full"
                    value={columns[key] ?? ""}
                    onChange={(e) => setColumns({ ...columns, [key]: e.target.value || undefined })}
                  >
                    <option value="">{key === "volume" ? "— none —" : "— choose —"}</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Timezone of naive timestamps</Label>
                <Select className="w-full" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Timeframe</Label>
                <Select className="w-full" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                  {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target instrument</Label>
                <Select
                  className="w-full"
                  value={target}
                  onChange={(e) => setTarget(e.target.value as "existing" | "new")}
                >
                  <option value="existing" disabled={!instruments.length}>Existing</option>
                  <option value="new">Create new</option>
                </Select>
              </div>
            </div>

            {target === "existing" ? (
              <Select className="w-full sm:w-72" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>{i.exchange}:{i.symbol} — {i.name}</option>
                ))}
              </Select>
            ) : (
              <div className="grid gap-3 sm:grid-cols-5">
                <Field label="Symbol"><Input value={fresh.symbol} onChange={(e) => setFresh({ ...fresh, symbol: e.target.value })} /></Field>
                <Field label="Exchange"><Input value={fresh.exchange} onChange={(e) => setFresh({ ...fresh, exchange: e.target.value })} /></Field>
                <Field label="Name"><Input value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></Field>
                <Field label="Tick size"><Input type="number" step="any" value={fresh.tick_size} onChange={(e) => setFresh({ ...fresh, tick_size: e.target.value })} /></Field>
                <Field label="Lot size"><Input type="number" value={fresh.lot_size} onChange={(e) => setFresh({ ...fresh, lot_size: e.target.value })} /></Field>
              </div>
            )}
          </>
        ) : null}
      </Card>

      {report ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Badge tone="green">{report.valid.length} valid</Badge>
            <Badge tone={report.problems.length ? "red" : "slate"}>{report.problems.length} rejected</Badge>
            <Badge tone={report.duplicatesInFile ? "amber" : "slate"}>
              {report.duplicatesInFile} duplicate timestamps in file
            </Badge>
            {report.wasReordered ? <Badge tone="amber">file was not sorted — reordered</Badge> : null}
            <span className="text-muted-foreground">
              {report.firstTs ? marketTime(report.firstTs, timeZone) : "—"} →{" "}
              {report.lastTs ? marketTime(report.lastTs, timeZone) : "—"}
            </span>
            <span className="ml-auto text-muted-foreground">{fileName}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr>
                  {["ts (in " + timeZone + ")", "open", "high", "low", "close", "volume"].map((h) => (
                    <th key={h} className="border-b px-2 py-1 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.valid.slice(0, 8).map((c) => (
                  <tr key={c.ts}>
                    <td className="border-b px-2 py-1 font-mono">{marketTime(c.ts, timeZone)}</td>
                    <td className="border-b px-2 py-1 font-mono">{num(c.open)}</td>
                    <td className="border-b px-2 py-1 font-mono">{num(c.high)}</td>
                    <td className="border-b px-2 py-1 font-mono">{num(c.low)}</td>
                    <td className="border-b px-2 py-1 font-mono">{num(c.close)}</td>
                    <td className="border-b px-2 py-1 font-mono">{num(c.volume, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.problems.length ? (
            <details className="rounded border p-2">
              <summary className="cursor-pointer text-xs font-medium">
                {report.problems.length} rejected row{report.problems.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                {report.problems.slice(0, 200).map((p, i) => (
                  <li key={i}>
                    <span className="font-mono">line {p.line}</span> — {p.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <Button onClick={upload} disabled={!ready || busy}>
            {busy ? "Importing…" : `Import ${report.valid.length} candles`}
          </Button>

          {result ? (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="font-medium text-emerald-800 dark:text-emerald-300">Import complete</p>
              <pre className="mt-1 overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
