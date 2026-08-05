"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge, Button, Card, Input, Label, Select } from "@/components/ui/primitives";
import * as api from "@/lib/paper/api";
import { FEE_PRESETS, TIMEFRAMES } from "@/lib/paper/types";
import type { Instrument } from "@/lib/supabase/types";
import { marketTime, money } from "@/lib/paper/format";

type SessionRow = {
  id: string;
  name: string | null;
  timeframe: string;
  status: string;
  current_bar_index: number;
  total_bars: number;
  starting_capital: number;
  currency: string;
  created_at: string;
  instruments: { symbol: string; exchange: string; name: string } | null;
};

export function SessionLauncher() {
  const router = useRouter();
  const [instruments, setInstruments] = React.useState<Instrument[]>([]);
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    instrument_id: "",
    timeframe: "day",
    start: "",
    end: "",
    capital: "100000",
    quantity: "10",
    slippage_mode: "ticks",
    slippage_value: "1",
    fee_preset: "indian-discount",
    allow_short: true,
    allow_reversal: false,
    warmup: "20",
    name: "",
  });

  React.useEffect(() => {
    (async () => {
      try {
        const [ins, ses] = await Promise.all([api.listInstruments(), api.listSessions()]);
        setInstruments(ins);
        setSessions(ses as unknown as SessionRow[]);
        if (ins.length && !form.instrument_id) {
          setForm((f) => ({ ...f, instrument_id: ins[0].id }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.createSession({
        p_instrument_id: form.instrument_id,
        p_timeframe: form.timeframe,
        p_start_ts: new Date(form.start).toISOString(),
        p_end_ts: new Date(form.end).toISOString(),
        p_starting_capital: Number(form.capital),
        p_default_quantity: Number(form.quantity),
        p_slippage_config: { mode: form.slippage_mode, value: Number(form.slippage_value) },
        p_fee_config: FEE_PRESETS[form.fee_preset].config as never,
        p_allow_short: form.allow_short,
        p_allow_reversal: form.allow_reversal,
        p_warmup_bars: Number(form.warmup),
        p_name: form.name || `${form.timeframe} replay`,
        p_currency: instruments.find((i) => i.id === form.instrument_id)?.currency ?? "INR",
      });
      router.push(`/paper-trading/${(session as { id: string }).id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
      <Card className="p-4">
        <h2 className="text-sm font-semibold">New replay session</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose the instrument, timeframe and history window, then set the account rules.
        </p>

        {instruments.length === 0 ? (
          <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            No instruments yet. Import OHLCV history first (see the README) — a session needs candles to replay.
          </p>
        ) : null}

        <form onSubmit={create} className="mt-4 space-y-3">
          <Two>
            <Wrap label="Instrument">
              <Select
                className="w-full"
                value={form.instrument_id}
                onChange={(e) => setForm({ ...form, instrument_id: e.target.value })}
                required
              >
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.exchange}:{i.symbol}
                  </option>
                ))}
              </Select>
            </Wrap>
            <Wrap label="Timeframe">
              <Select
                className="w-full"
                value={form.timeframe}
                onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Wrap>
          </Two>

          <Two>
            <Wrap label="Replay from">
              <Input
                type="datetime-local"
                required
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </Wrap>
            <Wrap label="Replay to">
              <Input
                type="datetime-local"
                required
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </Wrap>
          </Two>

          <Two>
            <Wrap label="Starting capital">
              <Input
                type="number"
                min={1}
                required
                value={form.capital}
                onChange={(e) => setForm({ ...form, capital: e.target.value })}
              />
            </Wrap>
            <Wrap label="Default quantity">
              <Input
                type="number"
                min={1}
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </Wrap>
          </Two>

          <Two>
            <Wrap label="Slippage mode">
              <Select
                className="w-full"
                value={form.slippage_mode}
                onChange={(e) => setForm({ ...form, slippage_mode: e.target.value })}
              >
                <option value="ticks">ticks</option>
                <option value="points">points</option>
                <option value="bps">basis points</option>
              </Select>
            </Wrap>
            <Wrap label="Slippage value">
              <Input
                type="number"
                min={0}
                step="any"
                value={form.slippage_value}
                onChange={(e) => setForm({ ...form, slippage_value: e.target.value })}
              />
            </Wrap>
          </Two>

          <Wrap label="Cost model">
            <Select
              className="w-full"
              value={form.fee_preset}
              onChange={(e) => setForm({ ...form, fee_preset: e.target.value })}
            >
              {Object.entries(FEE_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Rates are stored per session and shown in Session details. Edit the presets in
              <code className="mx-1">src/lib/paper/types.ts</code> — nothing is hard-coded in the engine.
            </p>
          </Wrap>

          <Two>
            <Wrap label="Warmup bars (chart context)">
              <Input
                type="number"
                min={0}
                value={form.warmup}
                onChange={(e) => setForm({ ...form, warmup: e.target.value })}
              />
            </Wrap>
            <Wrap label="Session name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="optional"
              />
            </Wrap>
          </Two>

          <div className="flex flex-wrap gap-4 pt-1">
            <Check
              label="Allow short selling"
              checked={form.allow_short}
              onChange={(v) => setForm({ ...form, allow_short: v })}
            />
            <Check
              label="Allow position reversal"
              checked={form.allow_reversal}
              onChange={(v) => setForm({ ...form, allow_reversal: v })}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}

          <Button type="submit" disabled={busy || !form.instrument_id} className="w-full">
            {busy ? "Creating…" : "Create session"}
          </Button>
        </form>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Your sessions</h2>
        {sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No sessions yet — create one on the left.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/paper-trading/${s.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-muted/40"
                >
                  <span className="font-mono text-sm">
                    {s.instruments ? `${s.instruments.exchange}:${s.instruments.symbol}` : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.timeframe}</span>
                  <span className="text-xs">{s.name}</span>
                  <Badge
                    tone={
                      s.status === "running" ? "green"
                        : s.status === "completed" || s.status === "ended" ? "slate" : "amber"
                    }
                  >
                    {s.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    bar {s.current_bar_index + 1}/{s.total_bars}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {money(s.starting_capital, s.currency)} · {marketTime(s.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Two({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Wrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-current"
      />
      {label}
    </label>
  );
}
