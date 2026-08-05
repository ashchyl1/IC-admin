"use client";

import * as React from "react";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import type { Performance, SessionState } from "@/lib/paper/types";
import type { TradeJournalEntry } from "@/lib/supabase/types";
import { marketTime, money, n, num, pct, pnlTone, signed } from "@/lib/paper/format";
import * as api from "@/lib/paper/api";

const TABS = [
  "Transaction journal",
  "Completed trades",
  "Open position",
  "Orders & fills",
  "Performance",
  "Session details",
] as const;

type Tab = (typeof TABS)[number];

export function BottomPanel({
  state,
  performance,
  lastPrice,
  onCancelOrder,
  onSaved,
}: {
  state: SessionState;
  performance: Performance | null;
  lastPrice: number;
  onCancelOrder: (orderId: string) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [tab, setTab] = React.useState<Tab>("Transaction journal");
  const { session, instrument } = state;
  const tz = instrument.timezone;
  const ccy = session.currency;

  return (
    <Card className="overflow-hidden">
      <div role="tablist" aria-label="Session data" className="flex flex-wrap gap-1 border-b bg-muted/40 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={[
              "rounded px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/60",
            ].join(" ")}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="max-h-[360px] overflow-auto p-3">
        {tab === "Transaction journal" ? (
          state.fills.length === 0 ? (
            <Empty>No executions yet. Orders fill at the next bar&apos;s open once the replay advances.</Empty>
          ) : (
            <Table
              head={[
                "#", "Sim. time", "Side", "Qty", "Raw price", "Slippage", "Fill price", "Fees",
                "Position after", "Avg entry after", "Realised on fill", "Running net", "Status",
              ]}
              rows={state.fills.map((f, i) => {
                const running = state.fills
                  .slice(0, i + 1)
                  .reduce((acc, x) => acc + n(x.realized_pnl) - n(x.fees), 0);
                return [
                  String(i + 1),
                  marketTime(f.simulated_ts, tz),
                  <Badge key="s" tone={f.side === "BUY" ? "green" : "red"}>{f.side}</Badge>,
                  num(f.quantity, 0),
                  num(f.raw_price),
                  num(f.slippage_amount, 4),
                  num(f.fill_price),
                  money(f.fees, ccy),
                  num(f.position_after, 0),
                  num(f.avg_entry_after),
                  <span key="r" className={pnlTone(f.realized_pnl)}>{signed(f.realized_pnl, ccy)}</span>,
                  <span key="n" className={pnlTone(running)}>{signed(running, ccy)}</span>,
                  "filled",
                ];
              })}
            />
          )
        ) : null}

        {tab === "Completed trades" ? (
          state.trades.length === 0 ? (
            <Empty>No trades yet. A trade opens when the position leaves flat and closes when it returns.</Empty>
          ) : (
            <div className="space-y-3">
              {state.trades.map((t) => (
                <TradeCard key={t.id} trade={t} tz={tz} ccy={ccy} onSaved={onSaved} />
              ))}
            </div>
          )
        ) : null}

        {tab === "Open position" ? (
          n(state.position?.signed_quantity) === 0 ? (
            <Empty>Flat — no open position.</Empty>
          ) : (
            <Table
              head={["Instrument", "Direction", "Quantity", "Avg entry", "Last price", "Unrealised", "Charges"]}
              rows={[[
                `${instrument.exchange}:${instrument.symbol}`,
                n(state.position?.signed_quantity) > 0 ? "LONG" : "SHORT",
                num(Math.abs(n(state.position?.signed_quantity)), 0),
                num(state.position?.average_entry_price),
                num(lastPrice),
                <span key="u" className={pnlTone((lastPrice - n(state.position?.average_entry_price)) * n(state.position?.signed_quantity))}>
                  {signed((lastPrice - n(state.position?.average_entry_price)) * n(state.position?.signed_quantity), ccy)}
                </span>,
                money(state.position?.total_fees, ccy),
              ]]}
            />
          )
        ) : null}

        {tab === "Orders & fills" ? (
          state.orders.length === 0 ? (
            <Empty>No orders submitted.</Empty>
          ) : (
            <Table
              head={["Submitted (sim.)", "Side", "Qty", "Type", "Status", "Ref price", "Reason", ""]}
              rows={state.orders.map((o) => [
                marketTime(o.simulated_submitted_at, tz),
                <Badge key="s" tone={o.side === "BUY" ? "green" : "red"}>{o.side}</Badge>,
                num(o.quantity, 0),
                o.order_type,
                <Badge
                  key="st"
                  tone={
                    o.status === "filled" ? "green"
                      : o.status === "pending" ? "amber"
                      : o.status === "rejected" ? "red" : "slate"
                  }
                >
                  {o.status}
                </Badge>,
                num(o.reference_price),
                <span key="r" className="text-xs text-muted-foreground">{o.rejection_reason ?? "—"}</span>,
                o.status === "pending" ? (
                  <Button key="c" size="sm" variant="outline" onClick={() => void onCancelOrder(o.id)}>
                    Cancel
                  </Button>
                ) : "",
              ])}
            />
          )
        ) : null}

        {tab === "Performance" ? (
          !performance ? (
            <Empty>Metrics load once the session has data.</Empty>
          ) : (
            <PerformanceView perf={performance} state={state} />
          )
        ) : null}

        {tab === "Session details" ? <SessionDetails state={state} /> : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ trade --- */

function TradeCard({
  trade,
  tz,
  ccy,
  onSaved,
}: {
  trade: TradeJournalEntry;
  tz: string;
  ccy: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    strategy: trade.strategy ?? "",
    setup: trade.setup ?? "",
    tags: (trade.tags ?? []).join(", "),
    confidence: trade.confidence ? String(trade.confidence) : "",
    mistake_category: trade.mistake_category ?? "",
    notes: trade.notes ?? "",
    review: trade.review ?? "",
  });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveAnnotations(trade.id, {
        strategy: form.strategy || null,
        setup: form.setup || null,
        tags: form.tags ? form.tags.split(",").map((s) => s.trim()).filter(Boolean) : null,
        confidence: form.confidence ? Number(form.confidence) : null,
        mistake_category: form.mistake_category || null,
        notes: form.notes || null,
        review: form.review || null,
      });
      setMsg("Saved");
      await onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-4 lg:grid-cols-6">
        <Field label="Trade">#{trade.trade_number}</Field>
        <Field label="Direction">
          <Badge tone={trade.direction === "LONG" ? "green" : "red"}>{trade.direction}</Badge>
        </Field>
        <Field label="Status">{trade.status}</Field>
        <Field label="Entry">{marketTime(trade.entry_ts, tz)}</Field>
        <Field label="Exit">{trade.exit_ts ? marketTime(trade.exit_ts, tz) : "—"}</Field>
        <Field label="Holding">{trade.holding_bars ?? "—"} bars</Field>
        <Field label="Avg entry">{num(trade.average_entry_price)}</Field>
        <Field label="Avg exit">{num(trade.average_exit_price)}</Field>
        <Field label="Quantity">{num(trade.quantity, 0)}</Field>
        <Field label="Gross P&L">
          <span className={pnlTone(trade.gross_pnl)}>{signed(trade.gross_pnl, ccy)}</span>
        </Field>
        <Field label="Charges">{money(trade.fees, ccy)}</Field>
        <Field label="Net P&L">
          <span className={pnlTone(trade.net_pnl)}>{signed(trade.net_pnl, ccy)}</span>
        </Field>
        <Field label="Return">{trade.return_percentage === null ? "—" : pct(trade.return_percentage)}</Field>
        <Field label="MFE">{signed(trade.mfe, ccy)}</Field>
        <Field label="MAE">{signed(trade.mae, ccy)}</Field>
      </div>

      <div className="border-t px-3 py-2">
        <button
          className="text-xs font-medium underline underline-offset-4"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide notes" : "Notes, strategy & review"}
        </button>

        {open ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Annotated label="Strategy">
              <Input value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })} />
            </Annotated>
            <Annotated label="Setup">
              <Input value={form.setup} onChange={(e) => setForm({ ...form, setup: e.target.value })} />
            </Annotated>
            <Annotated label="Tags (comma separated)">
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </Annotated>
            <Annotated label="Confidence (1–5)">
              <Select
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: e.target.value })}
                className="w-full"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Annotated>
            <Annotated label="Mistake category">
              <Input
                value={form.mistake_category}
                onChange={(e) => setForm({ ...form, mistake_category: e.target.value })}
                placeholder="early entry, no stop, oversized…"
              />
            </Annotated>
            <Annotated label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Annotated>
            <Annotated label="Post-trade review">
              <Textarea value={form.review} onChange={(e) => setForm({ ...form, review: e.target.value })} />
            </Annotated>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save annotations"}
              </Button>
              {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ performance --- */

function PerformanceView({ perf, state }: { perf: Performance; state: SessionState }) {
  const ccy = state.session.currency;
  const equity = state.equity;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Starting capital" value={money(perf.starting_capital, ccy)} />
        <Metric label="Equity" value={money(perf.equity, ccy)} tone={pnlTone(n(perf.equity) - n(perf.starting_capital))} />
        <Metric label="Cash" value={money(perf.cash, ccy)} />
        <Metric label="Total return" value={pct(perf.total_return_pct)} tone={pnlTone(perf.total_return_pct)} />
        <Metric label="Net realised" value={signed(perf.net_realized, ccy)} tone={pnlTone(perf.net_realized)} />
        <Metric label="Unrealised" value={signed(perf.unrealized_pnl, ccy)} tone={pnlTone(perf.unrealized_pnl)} />
        <Metric label="Gross realised" value={signed(perf.gross_realized, ccy)} tone={pnlTone(perf.gross_realized)} />
        <Metric label="Total charges" value={money(perf.total_fees, ccy)} />
        <Metric label="Trades" value={num(perf.trades, 0)} />
        <Metric label="Win rate" value={`${num(perf.win_rate)}%`} />
        <Metric label="Wins / losses" value={`${num(perf.wins, 0)} / ${num(perf.losses, 0)}`} />
        <Metric label="Breakeven" value={num(perf.breakeven, 0)} />
        <Metric label="Average win" value={signed(perf.average_win, ccy)} tone={pnlTone(perf.average_win)} />
        <Metric label="Average loss" value={signed(perf.average_loss, ccy)} tone={pnlTone(perf.average_loss)} />
        <Metric label="Largest win" value={signed(perf.largest_win, ccy)} tone={pnlTone(perf.largest_win)} />
        <Metric label="Largest loss" value={signed(perf.largest_loss, ccy)} tone={pnlTone(perf.largest_loss)} />
        <Metric label="Risk / reward" value={perf.risk_reward === null ? "—" : num(perf.risk_reward)} />
        <Metric label="Profit factor" value={perf.profit_factor === null ? "—" : num(perf.profit_factor)} />
        <Metric label="Expectancy / trade" value={signed(perf.expectancy, ccy)} tone={pnlTone(perf.expectancy)} />
        <Metric label="Max drawdown" value={signed(perf.max_drawdown, ccy)} tone={pnlTone(perf.max_drawdown)} />
        <Metric label="Max drawdown %" value={pct(perf.max_drawdown_pct)} tone={pnlTone(perf.max_drawdown_pct)} />
        <Metric label="Consecutive wins" value={num(perf.max_consecutive_wins, 0)} />
        <Metric label="Consecutive losses" value={num(perf.max_consecutive_losses, 0)} />
        <Metric label="Avg holding (bars)" value={num(perf.average_holding_bars)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SideCard title="Long trades" data={perf.long} ccy={ccy} />
        <SideCard title="Short trades" data={perf.short} ccy={ccy} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Sparkline
          title="Equity curve"
          values={equity.map((e) => n(e.equity))}
          baseline={n(perf.starting_capital)}
        />
        <Sparkline title="Drawdown" values={equity.map((e) => n(e.drawdown))} baseline={0} />
        <Sparkline
          title="Cumulative net P&L"
          values={equity.map((e) => n(e.equity) - n(perf.starting_capital))}
          baseline={0}
        />
        <BarSeries
          title="P&L by trade"
          values={state.trades.filter((t) => t.status === "closed").map((t) => n(t.net_pnl))}
        />
      </div>
    </div>
  );
}

function SideCard({ title, data, ccy }: { title: string; data: Performance["long"]; ccy: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-medium">{title}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <Metric label="Trades" value={num(data?.trades ?? 0, 0)} />
        <Metric label="Wins" value={num(data?.wins ?? 0, 0)} />
        <Metric label="Net P&L" value={signed(data?.net_pnl ?? 0, ccy)} tone={pnlTone(data?.net_pnl ?? 0)} />
      </div>
    </div>
  );
}

/** Inline SVG chart -- no extra dependency, scales to the container. */
function Sparkline({ title, values, baseline }: { title: string; values: number[]; baseline: number }) {
  if (values.length < 2) return <ChartEmpty title={title} />;
  const min = Math.min(...values, baseline);
  const max = Math.max(...values, baseline);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / span) * 100}`)
    .join(" ");
  const zero = 100 - ((baseline - min) / span) * 100;
  const last = values[values.length - 1];

  return (
    <figure className="rounded-md border p-3">
      <figcaption className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-medium">{title}</span>
        <span className={`font-mono ${pnlTone(last - baseline)}`}>{num(last)}</span>
      </figcaption>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label={title}>
        <line x1="0" y1={zero} x2="100" y2={zero} stroke="currentColor" strokeWidth="0.4" opacity="0.3" />
        <polyline
          points={pts}
          fill="none"
          stroke={last >= baseline ? "#10b981" : "#ef4444"}
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

function BarSeries({ title, values }: { title: string; values: number[] }) {
  if (!values.length) return <ChartEmpty title={title} />;
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <figure className="rounded-md border p-3">
      <figcaption className="mb-2 text-xs font-medium">{title}</figcaption>
      <div className="flex h-28 items-center gap-1" role="img" aria-label={title}>
        {values.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-center" title={num(v)}>
            <div className="flex h-1/2 items-end">
              {v > 0 ? <div className="w-full bg-emerald-500" style={{ height: `${(v / max) * 100}%` }} /> : null}
            </div>
            <div className="flex h-1/2 items-start">
              {v < 0 ? <div className="w-full bg-red-500" style={{ height: `${(-v / max) * 100}%` }} /> : null}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

function ChartEmpty({ title }: { title: string }) {
  return (
    <figure className="rounded-md border p-3">
      <figcaption className="mb-2 text-xs font-medium">{title}</figcaption>
      <div className="grid h-28 place-items-center text-xs text-muted-foreground">Not enough data yet</div>
    </figure>
  );
}

/* -------------------------------------------------------------- details --- */

function SessionDetails({ state }: { state: SessionState }) {
  const s = state.session;
  const slip = s.slippage_config as { mode?: string; value?: number } | null;
  const fee = s.fee_config as Record<string, unknown> | null;

  return (
    <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Session">{s.name || s.id}</Field>
      <Field label="Instrument">{state.instrument.exchange}:{state.instrument.symbol}</Field>
      <Field label="Timeframe">{s.timeframe}</Field>
      <Field label="Range start">{marketTime(s.start_ts, state.instrument.timezone)}</Field>
      <Field label="Range end">{marketTime(s.end_ts, state.instrument.timezone)}</Field>
      <Field label="Market hours">{s.market_open}–{s.market_close} ({state.instrument.timezone})</Field>
      <Field label="Warmup bars">{s.warmup_bars}</Field>
      <Field label="Total bars">{s.total_bars}</Field>
      <Field label="Starting capital">{money(s.starting_capital, s.currency)}</Field>
      <Field label="Default quantity">{num(s.default_quantity, 0)}</Field>
      <Field label="Shorting">{s.allow_short ? "allowed" : "long-only"}</Field>
      <Field label="Position reversal">{s.allow_reversal ? "allowed" : "blocked"}</Field>
      <Field label="Slippage model">{slip?.mode} × {slip?.value}</Field>
      <Field label="Cost model">{String(fee?.preset ?? "custom")}</Field>
      <Field label="Cost detail">
        <code className="text-[10px]">{JSON.stringify(fee)}</code>
      </Field>
      <Field label="Created">{marketTime(s.created_at, state.instrument.timezone)}</Field>
      <Field label="Status">{s.status}</Field>
      <Field label="Currency">{s.currency}</Field>
    </div>
  );
}

/* ------------------------------------------------------------- primitives --- */

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b px-2 py-1.5 text-left font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-muted/40">
              {r.map((cell, j) => (
                <td key={j} className="whitespace-nowrap border-b px-2 py-1.5 font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono">{children}</div>
    </div>
  );
}

function Annotated({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
