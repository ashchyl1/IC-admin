"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Square,
  XCircle,
} from "lucide-react";

import { Badge, Button, Card, Input, Label, Select } from "@/components/ui/primitives";
import { ReplayChart } from "./ReplayChart";
import { BottomPanel } from "./BottomPanel";
import * as api from "@/lib/paper/api";
import type { Performance, ReleasedCandle, SessionState } from "@/lib/paper/types";
import { marketTime, money, n, num, pnlTone, signed } from "@/lib/paper/format";

const INTRADAY = (tf: string) => tf !== "day";

export function PaperTradingWorkspace({ initial }: { initial: SessionState }) {
  const router = useRouter();
  const [state, setState] = React.useState<SessionState>(initial);
  const [perf, setPerf] = React.useState<Performance | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<ReleasedCandle | null>(null);
  const [quantity, setQuantity] = React.useState(() => String(n(initial.session.default_quantity)));
  const [confirm, setConfirm] = React.useState<null | { side: "BUY" | "SELL"; qty: number; isClose: boolean }>(
    null
  );

  const session = state.session;
  const instrument = state.instrument;
  const position = state.position;
  const finished = session.status === "completed" || session.status === "ended";
  const signedQty = n(position?.signed_quantity);
  const avgEntry = n(position?.average_entry_price);

  const lastCandle = state.candles.length ? state.candles[state.candles.length - 1] : null;
  const shown = hovered ?? lastCandle;
  const lastPrice = n(lastCandle?.close);
  const unrealized = signedQty === 0 ? 0 : (lastPrice - avgEntry) * signedQty;
  const equity = n(session.cash_balance) + signedQty * lastPrice;
  const pendingOrders = state.orders.filter((o) => o.status === "pending");

  const barsDone = session.current_bar_index + 1;
  const progress = session.total_bars > 0 ? Math.min(100, (barsDone / session.total_bars) * 100) : 0;

  // ------------------------------------------------------------ mutations ---
  const refreshPerf = React.useCallback(async (id: string) => {
    try {
      setPerf(await api.getPerformance(id));
    } catch {
      /* metrics are non-critical; the ledger view still works */
    }
  }, []);

  React.useEffect(() => {
    void refreshPerf(session.id);
  }, [session.id, state.fills.length, state.trades.length, refreshPerf]);

  /**
   * A single in-flight advance at a time. The ref (not state) is what the
   * interval reads, so a tick that arrives mid-request is dropped rather than
   * queued -- that is what stops bars being skipped or double-released.
   */
  const advancing = React.useRef(false);

  const advance = React.useCallback(
    async (bars: number) => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        const next = await api.advanceReplay(session.id, bars, api.newClientOrderId());
        setState((prev) => mergeState(prev, next));
        setError(null);
        if (next.session.status === "completed") setPlaying(false);
      } catch (err) {
        setPlaying(false);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        advancing.current = false;
      }
    },
    [session.id]
  );

  // Playback timer. One interval, cleared on every dependency change, so two
  // timers can never coexist.
  React.useEffect(() => {
    if (!playing || finished) return;
    const id = window.setInterval(() => void advance(session.speed), 1000);
    return () => window.clearInterval(id);
  }, [playing, finished, session.speed, advance]);

  async function guard(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const onPlayPause = () =>
    guard(async () => {
      const nextPlaying = !playing;
      setPlaying(nextPlaying);
      await api.setStatus(session.id, nextPlaying ? "running" : "paused");
      setState((p) => ({ ...p, session: { ...p.session, status: nextPlaying ? "running" : "paused" } }));
    });

  const onSpeed = (speed: number) =>
    guard(async () => {
      await api.setSpeed(session.id, speed);
      setState((p) => ({ ...p, session: { ...p.session, speed } }));
    });

  const onRestart = () =>
    guard(async () => {
      if (!window.confirm("Restart wipes every order, fill, trade and equity point for this session. Continue?"))
        return;
      setPlaying(false);
      setState(await api.restartSession(session.id));
    });

  const onEnd = () =>
    guard(async () => {
      if (!window.confirm("End this session? Trading will be disabled.")) return;
      setPlaying(false);
      await api.setStatus(session.id, "ended");
      setState(await api.getSessionState(session.id));
    });

  const placeOrder = (side: "BUY" | "SELL", isClose = false) => {
    const qty = isClose ? Math.abs(signedQty) : Number(quantity);
    if (!isClose && (!Number.isFinite(qty) || qty <= 0)) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setConfirm({ side, qty, isClose });
  };

  const submitConfirmed = () =>
    guard(async () => {
      if (!confirm) return;
      const order = await api.submitOrder({
        sessionId: session.id,
        clientOrderId: api.newClientOrderId(),
        side: confirm.side,
        quantity: confirm.qty,
        isClose: confirm.isClose,
      });
      setConfirm(null);
      if (order && "rejection_reason" in order && order.rejection_reason) {
        setError(order.rejection_reason as string);
      }
      setState(await api.getSessionState(session.id));
    });

  // ---------------------------------------------------------- keyboard ---
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "Escape") return setConfirm(null);
      if (finished) return;
      if (e.code === "Space") {
        e.preventDefault();
        void onPlayPause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        void advance(1);
      } else if (["1", "2", "3"].includes(e.key)) {
        void onSpeed(Number(e.key));
      } else if (e.key.toLowerCase() === "b") {
        // Opens the confirmation dialog -- never fires an order on one keypress.
        e.preventDefault();
        placeOrder("BUY");
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        placeOrder("SELL");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, finished, quantity, signedQty, busy]);

  // ------------------------------------------------------------------ UI ---
  return (
    <div className="flex flex-col gap-4">
      {/* ---------------------------------------------------- top toolbar --- */}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
        <div className="min-w-[180px]">
          <div className="text-sm font-semibold">
            {instrument.exchange}:{instrument.symbol}
            <span className="ml-2 font-normal text-muted-foreground">{session.timeframe}</span>
          </div>
          <div className="text-xs text-muted-foreground">{instrument.name}</div>
        </div>

        <div className="min-w-[190px]">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Simulated time</div>
          <div className="font-mono text-sm" aria-live="polite">
            {marketTime(session.current_simulated_at, instrument.timezone)}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={playing ? "subtle" : "primary"}
            onClick={onPlayPause}
            disabled={busy || finished}
            aria-label={playing ? "Pause replay" : "Start replay"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void advance(1)}
            disabled={busy || finished || playing}
            aria-label="Step forward one bar"
          >
            <ChevronRight className="h-3.5 w-3.5" /> Step
          </Button>
          <Button size="sm" variant="outline" onClick={onRestart} disabled={busy} aria-label="Restart session">
            <RotateCcw className="h-3.5 w-3.5" /> Restart
          </Button>
          <Button size="sm" variant="outline" onClick={onEnd} disabled={busy || finished} aria-label="End session">
            <Square className="h-3.5 w-3.5" /> End
          </Button>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          {[1, 2, 3].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={session.speed === s ? "primary" : "outline"}
              onClick={() => void onSpeed(s)}
              disabled={busy}
              aria-pressed={session.speed === s}
            >
              {s} bar{s > 1 ? "s" : ""}/sec
            </Button>
          ))}
        </div>

        <div className="ml-auto min-w-[190px]">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Bar {barsDone} / {session.total_bars}
            </span>
            <Badge tone={finished ? "slate" : playing ? "green" : "amber"}>{session.status}</Badge>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Replay progress"
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </Card>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
          <button className="ml-auto text-xs underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      {/* ------------------------------------------- chart + trading panel --- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ReplayChart
          candles={state.candles}
          fills={state.fills}
          timeZone={instrument.timezone}
          intraday={INTRADAY(session.timeframe)}
          averageEntry={avgEntry}
          signedQuantity={signedQty}
          onHover={setHovered}
        />

        <Card className="flex flex-col gap-3 p-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {hovered ? "Hovered candle" : "Last released candle"}
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-xs">
              <Stat label="O" value={num(shown?.open)} />
              <Stat label="H" value={num(shown?.high)} />
              <Stat label="L" value={num(shown?.low)} />
              <Stat label="C" value={num(shown?.close)} />
            </div>
          </div>

          <Row label="Last price" value={money(lastPrice, session.currency)} mono />
          <Row label="Cash" value={money(session.cash_balance, session.currency)} mono />
          <Row label="Equity" value={money(equity, session.currency)} mono />

          <div className="border-t pt-3">
            <Label htmlFor="qty">Quantity</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="qty"
                type="number"
                min={1}
                step={instrument.lot_size || 1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={finished}
                className="font-mono"
              />
              {instrument.lot_size > 1 ? (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  lot {instrument.lot_size}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => placeOrder("BUY")}
              disabled={busy || finished}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <ArrowUpCircle className="h-4 w-4" /> Buy
            </Button>
            <Button
              onClick={() => placeOrder("SELL")}
              disabled={busy || finished || (!session.allow_short && signedQty <= 0)}
              className="bg-red-600 hover:bg-red-700"
            >
              <ArrowDownCircle className="h-4 w-4" /> Sell
            </Button>
          </div>
          <Button
            variant="subtle"
            onClick={() => placeOrder(signedQty > 0 ? "SELL" : "BUY", true)}
            disabled={busy || finished || signedQty === 0}
          >
            Close position
          </Button>

          <div className="space-y-1.5 border-t pt-3 text-sm">
            <Row
              label="Position"
              mono
              value={
                signedQty === 0
                  ? "flat"
                  : `${signedQty > 0 ? "LONG" : "SHORT"} ${num(Math.abs(signedQty), 0)}`
              }
            />
            <Row label="Avg entry" value={signedQty === 0 ? "—" : num(avgEntry)} mono />
            <Row
              label="Unrealised"
              value={signed(unrealized, session.currency)}
              mono
              tone={pnlTone(unrealized)}
            />
            <Row
              label="Realised (gross)"
              value={signed(position?.realized_pnl, session.currency)}
              mono
              tone={pnlTone(position?.realized_pnl)}
            />
            <Row label="Charges" value={money(position?.total_fees, session.currency)} mono />
            <Row
              label="Net P&L"
              value={signed(n(position?.realized_pnl) - n(position?.total_fees) + unrealized, session.currency)}
              mono
              tone={pnlTone(n(position?.realized_pnl) - n(position?.total_fees) + unrealized)}
            />
          </div>

          {pendingOrders.length ? (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {pendingOrders.length} order{pendingOrders.length > 1 ? "s" : ""} pending — fills at the next
              bar&apos;s open.
            </p>
          ) : null}
        </Card>
      </div>

      <BottomPanel
        state={state}
        performance={perf}
        lastPrice={lastPrice}
        onCancelOrder={async (id) => {
          await api.cancelOrder(id);
          setState(await api.getSessionState(session.id));
        }}
        onSaved={async () => setState(await api.getSessionState(session.id))}
      />

      {/* ---------------------------------------------- order confirmation --- */}
      {confirm ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onClick={(e) => e.target === e.currentTarget && setConfirm(null)}
        >
          <Card className="w-full max-w-sm p-5">
            <h2 id="confirm-title" className="text-base font-semibold">
              Confirm {confirm.isClose ? "close" : confirm.side.toLowerCase()}
            </h2>
            <dl className="mt-3 space-y-1 font-mono text-sm">
              <Row label="Side" value={confirm.side} mono />
              <Row label="Quantity" value={num(confirm.qty, 0)} mono />
              <Row label="Instrument" value={`${instrument.exchange}:${instrument.symbol}`} mono />
              <Row label="Fills at" value="next bar open ± slippage" mono />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Simulated order. Nothing is sent to a broker.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submitConfirmed} disabled={busy}>
                {busy ? "Submitting…" : "Submit order"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        Shortcuts: <kbd>Space</kbd> play/pause · <kbd>→</kbd> step · <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> speed ·{" "}
        <kbd>B</kbd>/<kbd>S</kbd> order dialog · <kbd>Esc</kbd> close
      </p>
      <button className="sr-only" onClick={() => router.refresh()}>
        Refresh
      </button>
    </div>
  );
}

/** Advance returns only newly released candles; append rather than replace. */
function mergeState(prev: SessionState, next: SessionState): SessionState {
  const seen = new Set(prev.candles.map((c) => c.bar_index));
  const appended = next.candles.filter((c) => !seen.has(c.bar_index));
  return { ...next, candles: [...prev.candles, ...appended].sort((a, b) => a.bar_index - b.bar_index) };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={[mono ? "font-mono" : "", tone ?? ""].join(" ")}>{value}</span>
    </div>
  );
}
