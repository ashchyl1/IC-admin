"use client";

import { createClient } from "@/lib/supabase/client";
import type { Instrument, Json } from "@/lib/supabase/types";
import type { Performance, SessionState } from "./types";

const supabase = () => createClient();

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(cleanMessage(error.message));
  return data as T;
}

/** Postgres exception text arrives wrapped; show the human part. */
function cleanMessage(message: string) {
  return message.replace(/^.*?(?:ERROR:|error:)\s*/i, "").trim() || message;
}

export async function listInstruments(): Promise<Instrument[]> {
  const { data, error } = await supabase()
    .from("instruments")
    .select("*")
    .eq("is_active", true)
    .order("exchange")
    .order("symbol");
  if (error) throw new Error(cleanMessage(error.message));
  return data ?? [];
}

export async function listSessions() {
  const { data, error } = await supabase()
    .from("replay_sessions")
    .select("*, instruments(symbol, exchange, name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(cleanMessage(error.message));
  return data ?? [];
}

export async function createSession(args: {
  p_instrument_id: string;
  p_timeframe: string;
  p_start_ts: string;
  p_end_ts: string;
  p_starting_capital: number;
  p_default_quantity: number;
  p_slippage_config: Json;
  p_fee_config: Json;
  p_allow_short: boolean;
  p_allow_reversal: boolean;
  p_warmup_bars: number;
  p_name: string;
  p_currency: string;
}) {
  const { data, error } = await supabase().rpc("create_replay_session", args);
  if (error) throw new Error(cleanMessage(error.message));
  return data;
}

export async function getSessionState(sessionId: string): Promise<SessionState> {
  const { data, error } = await supabase().rpc("get_session_state", { p_session_id: sessionId });
  return unwrap<SessionState>(data, error);
}

/**
 * `requestId` is the idempotency key: if the response is lost and the call is
 * retried, the server returns the same state instead of releasing more bars.
 */
export async function advanceReplay(
  sessionId: string,
  bars: number,
  requestId: string
): Promise<SessionState> {
  const { data, error } = await supabase().rpc("advance_replay", {
    p_session_id: sessionId,
    p_bars: bars,
    p_request_id: requestId,
  });
  return unwrap<SessionState>(data, error);
}

export async function submitOrder(args: {
  sessionId: string;
  clientOrderId: string;
  side: "BUY" | "SELL";
  quantity: number;
  isClose?: boolean;
}) {
  const { data, error } = await supabase().rpc("submit_paper_order", {
    p_session_id: args.sessionId,
    p_client_order_id: args.clientOrderId,
    p_side: args.side,
    p_quantity: args.quantity,
    p_is_close: args.isClose ?? false,
  });
  if (error) throw new Error(cleanMessage(error.message));
  return data;
}

export async function cancelOrder(orderId: string) {
  const { data, error } = await supabase().rpc("cancel_paper_order", { p_order_id: orderId });
  if (error) throw new Error(cleanMessage(error.message));
  return data;
}

export async function setStatus(sessionId: string, status: "running" | "paused" | "ended") {
  const { data, error } = await supabase().rpc("set_session_status", {
    p_session_id: sessionId,
    p_status: status,
  });
  if (error) throw new Error(cleanMessage(error.message));
  return data;
}

export async function setSpeed(sessionId: string, speed: number) {
  const { data, error } = await supabase().rpc("set_session_speed", {
    p_session_id: sessionId,
    p_speed: speed,
  });
  if (error) throw new Error(cleanMessage(error.message));
  return data;
}

export async function restartSession(sessionId: string): Promise<SessionState> {
  const { data, error } = await supabase().rpc("restart_replay_session", {
    p_session_id: sessionId,
  });
  return unwrap<SessionState>(data, error);
}

export async function getPerformance(sessionId: string): Promise<Performance> {
  const { data, error } = await supabase().rpc("session_performance", { p_session_id: sessionId });
  return unwrap<Performance>(data, error);
}

/** Annotations only -- the database rejects any attempt to touch results. */
export async function saveAnnotations(
  tradeId: string,
  patch: {
    strategy?: string | null;
    setup?: string | null;
    tags?: string[] | null;
    confidence?: number | null;
    mistake_category?: string | null;
    notes?: string | null;
    review?: string | null;
  }
) {
  const { error } = await supabase().from("trade_journal").update(patch).eq("id", tradeId);
  if (error) throw new Error(cleanMessage(error.message));
}

export function newClientOrderId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `coid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
