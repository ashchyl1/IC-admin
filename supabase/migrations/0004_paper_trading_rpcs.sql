-- =============================================================================
-- Callable RPCs (the only write path the browser has)
-- =============================================================================
-- Every function here is SECURITY DEFINER with search_path pinned to '', checks
-- auth.uid() ownership explicitly before touching anything, and is granted only
-- to `authenticated`. EXECUTE is revoked from PUBLIC first in all cases.
-- =============================================================================

-- --------------------------------------------------------- create session ---
create or replace function public.create_replay_session(
  p_instrument_id    uuid,
  p_timeframe        text,
  p_start_ts         timestamptz,
  p_end_ts           timestamptz,
  p_starting_capital numeric,
  p_default_quantity numeric  default 1,
  p_slippage_config  jsonb    default '{"mode":"ticks","value":1}'::jsonb,
  p_fee_config       jsonb    default '{"brokerage_mode":"min_of_flat_and_percent","flat":20,"percent":0.03,"percent_cap":20,"min_commission":0,"exchange_bps":3.45,"statutory_bps":0,"preset":"indian-discount"}'::jsonb,
  p_allow_short      boolean  default true,
  p_allow_reversal   boolean  default false,
  p_warmup_bars      integer  default 20,
  p_speed            integer  default 1,
  p_name             text     default null,
  p_currency         text     default 'INR',
  p_market_open      time     default '09:15',
  p_market_close     time     default '15:30'
)
returns public.replay_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.replay_sessions;
  v_total   integer;
  bar       engine.candle;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_starting_capital <= 0 then
    raise exception 'Starting capital must be positive';
  end if;
  if p_end_ts <= p_start_ts then
    raise exception 'End date/time must be after the start date/time';
  end if;
  if p_speed not between 1 and 3 then
    raise exception 'Speed must be 1, 2 or 3 bars per second';
  end if;

  insert into public.replay_sessions (
    user_id, instrument_id, timeframe, name, start_ts, end_ts, starting_capital,
    cash_balance, currency, default_quantity, slippage_config, fee_config,
    allow_short, allow_reversal, warmup_bars, speed, market_open, market_close
  ) values (
    v_uid, p_instrument_id, p_timeframe, p_name, p_start_ts, p_end_ts, p_starting_capital,
    p_starting_capital, p_currency, p_default_quantity, p_slippage_config, p_fee_config,
    p_allow_short, p_allow_reversal, p_warmup_bars, p_speed::smallint, p_market_open, p_market_close
  )
  returning * into v_session;

  v_total := engine.count_bars(v_session.id);
  -- Need the warmup plus at least one bar to trade on and one to fill against.
  if v_total < p_warmup_bars + 2 then
    raise exception
      'Only % candles exist for that instrument/timeframe/date range; need at least % (warmup % + 2). Import more history or widen the range.',
      v_total, p_warmup_bars + 2, p_warmup_bars;
  end if;

  insert into public.paper_positions (session_id, user_id, instrument_id)
  values (v_session.id, v_uid, p_instrument_id);

  -- Warmup bars are chart context only: released immediately, before any order
  -- can exist, so they cannot leak future information into a decision.
  if p_warmup_bars > 0 then
    bar := engine.candle_at(v_session.id, p_warmup_bars - 1);
    update public.replay_sessions
       set total_bars = v_total,
           current_bar_index = p_warmup_bars - 1,
           current_simulated_at = bar.ts
     where id = v_session.id
     returning * into v_session;

    insert into public.equity_snapshots (
      session_id, user_id, bar_index, simulated_ts, cash, market_value, equity,
      realized_pnl, unrealized_pnl, peak_equity, drawdown
    ) values (
      v_session.id, v_uid, p_warmup_bars - 1, bar.ts, p_starting_capital, 0,
      p_starting_capital, 0, 0, p_starting_capital, 0
    );
  else
    update public.replay_sessions set total_bars = v_total
     where id = v_session.id returning * into v_session;
  end if;

  return v_session;
end;
$fn$;

-- ----------------------------------------------------------- submit order ---
create or replace function public.submit_paper_order(
  p_session_id      uuid,
  p_client_order_id text,
  p_side            text,
  p_quantity        numeric,
  p_is_close        boolean default false
)
returns public.paper_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  s           public.replay_sessions;
  pos         public.paper_positions;
  ord         public.paper_orders;
  bar         engine.candle;
  v_side      public.order_side;
  v_qty       numeric;
  v_delta     numeric;
  v_new_pos   numeric;
  v_price     numeric;
  v_fees      numeric;
  v_reject    text := null;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into s from public.replay_sessions where id = p_session_id for update;
  if not found or s.user_id <> v_uid then
    raise exception 'Replay session not found' using errcode = '42501';
  end if;

  -- Idempotency: a retry or a double-click returns the original order.
  select * into ord from public.paper_orders
   where session_id = p_session_id and client_order_id = p_client_order_id;
  if found then
    return ord;
  end if;

  v_side := upper(p_side)::public.order_side;
  select * into pos from public.paper_positions
   where session_id = p_session_id and instrument_id = s.instrument_id;

  v_qty := case when p_is_close then abs(pos.signed_quantity) else p_quantity end;

  if v_qty is null or v_qty <= 0 then
    raise exception 'Order quantity must be greater than zero';
  end if;

  v_delta   := case when v_side = 'BUY' then v_qty else -v_qty end;
  v_new_pos := pos.signed_quantity + v_delta;

  bar := engine.candle_at(p_session_id, greatest(s.current_bar_index, 0));
  v_price := bar.close;
  v_fees  := engine.compute_fees(s.fee_config, v_qty * v_price);

  -- ------------------------------------------------- business rejections ---
  if s.status in ('completed', 'ended') then
    v_reject := 'Replay session is finished; trading is disabled';
  elsif s.current_bar_index >= s.total_bars - 1 then
    v_reject := 'No further candles: a market order can only fill at the next bar''s open';
  elsif not s.allow_short and v_new_pos < 0 then
    v_reject := 'Long-only session: this order would open a short position';
  elsif not s.allow_reversal and pos.signed_quantity <> 0
        and sign(v_delta) <> sign(pos.signed_quantity) and v_qty > abs(pos.signed_quantity) then
    v_reject := 'Position reversal is disabled: reduce the quantity to at most ' || abs(pos.signed_quantity);
  elsif v_side = 'BUY' and (v_qty * v_price + v_fees) > s.cash_balance then
    v_reject := 'Insufficient buying power: need ' || round(v_qty * v_price + v_fees, 2)
                || ', available ' || round(s.cash_balance, 2);
  elsif v_side = 'SELL' and v_new_pos < 0 and (abs(v_new_pos) * v_price) > s.cash_balance then
    v_reject := 'Insufficient margin for a short: this session requires 100% of notional in cash';
  end if;

  insert into public.paper_orders (
    client_order_id, session_id, user_id, side, quantity, status,
    submitted_bar_index, simulated_submitted_at, reference_price,
    rejection_reason, cancelled_at, is_close_request
  ) values (
    p_client_order_id, p_session_id, v_uid, v_side, v_qty,
    case when v_reject is null then 'pending' else 'rejected' end::public.order_status,
    s.current_bar_index, s.current_simulated_at, v_price,
    v_reject, case when v_reject is null then null else now() end, p_is_close
  )
  returning * into ord;

  return ord;
end;
$fn$;

-- ----------------------------------------------------------- cancel order ---
create or replace function public.cancel_paper_order(p_order_id uuid)
returns public.paper_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  ord   public.paper_orders;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.paper_orders
     set status = 'cancelled', cancelled_at = now(),
         rejection_reason = coalesce(rejection_reason, 'Cancelled by user')
   where id = p_order_id and user_id = v_uid and status = 'pending'
   returning * into ord;

  if not found then
    raise exception 'No pending order with that id' using errcode = '42501';
  end if;
  return ord;
end;
$fn$;

-- --------------------------------------------------------- advance replay ---
create or replace function public.advance_replay(
  p_session_id uuid,
  p_bars       integer default 1,
  p_request_id text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  s       public.replay_sessions;
  v_from  integer;
  v_next  integer;
  i       integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_bars is null or p_bars not between 1 and 3 then
    raise exception 'Can only advance 1 to 3 bars at a time';
  end if;

  -- FOR UPDATE serialises concurrent tabs and any stray second timer: the
  -- loser waits, then re-reads the already-advanced cursor.
  select * into s from public.replay_sessions where id = p_session_id for update;
  if not found or s.user_id <> v_uid then
    raise exception 'Replay session not found' using errcode = '42501';
  end if;

  -- Replayed request (network retry): return current state, advance nothing.
  if p_request_id is not null and s.last_advance_request_id is distinct from null
     and s.last_advance_request_id = p_request_id then
    return public.get_session_state(p_session_id);
  end if;

  v_from := s.current_bar_index;

  if s.status in ('completed', 'ended') then
    return public.get_session_state(p_session_id);
  end if;

  for i in 1..p_bars loop
    v_next := s.current_bar_index + 1;
    exit when v_next > s.total_bars - 1;
    perform engine.release_bar(p_session_id, v_next);
    select * into s from public.replay_sessions where id = p_session_id;
  end loop;

  if s.current_bar_index >= s.total_bars - 1 then
    update public.paper_orders
       set status = 'cancelled', cancelled_at = now(),
           rejection_reason = 'Replay reached the last candle before this order could fill'
     where session_id = p_session_id and status = 'pending';

    update public.replay_sessions
       set status = 'completed', completed_at = now(),
           last_advance_request_id = coalesce(p_request_id, last_advance_request_id)
     where id = p_session_id;
  else
    update public.replay_sessions
       set status = 'running',
           last_advance_request_id = coalesce(p_request_id, last_advance_request_id)
     where id = p_session_id;
  end if;

  return public.get_session_state(p_session_id, v_from + 1);
end;
$fn$;

-- ------------------------------------------------------- session controls ---
create or replace function public.set_session_status(p_session_id uuid, p_status text)
returns public.replay_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  s     public.replay_sessions;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_status not in ('running', 'paused', 'ended') then
    raise exception 'Status must be running, paused or ended';
  end if;

  update public.replay_sessions
     set status = p_status::public.replay_status,
         completed_at = case when p_status = 'ended' then now() else completed_at end
   where id = p_session_id and user_id = v_uid and status <> 'completed'
   returning * into s;

  if not found then
    select * into s from public.replay_sessions where id = p_session_id and user_id = v_uid;
    if not found then
      raise exception 'Replay session not found' using errcode = '42501';
    end if;
  end if;

  if p_status = 'ended' then
    update public.paper_orders
       set status = 'cancelled', cancelled_at = now(),
           rejection_reason = 'Session ended by user'
     where session_id = p_session_id and status = 'pending';
  end if;

  return s;
end;
$fn$;

create or replace function public.set_session_speed(p_session_id uuid, p_speed integer)
returns public.replay_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  s     public.replay_sessions;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_speed not between 1 and 3 then
    raise exception 'Speed must be 1, 2 or 3 bars per second';
  end if;

  update public.replay_sessions set speed = p_speed::smallint
   where id = p_session_id and user_id = v_uid
   returning * into s;

  if not found then
    raise exception 'Replay session not found' using errcode = '42501';
  end if;
  return s;
end;
$fn$;

-- Destructive: wipes every trading result for the session and rewinds the
-- cursor to the warmup point. The UI confirms before calling this.
create or replace function public.restart_replay_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  s     public.replay_sessions;
  bar   engine.candle;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into s from public.replay_sessions where id = p_session_id for update;
  if not found or s.user_id <> v_uid then
    raise exception 'Replay session not found' using errcode = '42501';
  end if;

  perform set_config('app.engine', 'on', true);

  delete from public.paper_fills      where session_id = p_session_id;
  delete from public.paper_orders     where session_id = p_session_id;
  delete from public.trade_journal    where session_id = p_session_id;
  delete from public.equity_snapshots where session_id = p_session_id;

  update public.paper_positions
     set signed_quantity = 0, average_entry_price = 0, realized_pnl = 0,
         total_fees = 0, updated_at = now()
   where session_id = p_session_id;

  if s.warmup_bars > 0 then
    bar := engine.candle_at(p_session_id, s.warmup_bars - 1);
    insert into public.equity_snapshots (
      session_id, user_id, bar_index, simulated_ts, cash, market_value, equity,
      realized_pnl, unrealized_pnl, peak_equity, drawdown
    ) values (
      p_session_id, v_uid, s.warmup_bars - 1, bar.ts, s.starting_capital, 0,
      s.starting_capital, 0, 0, s.starting_capital, 0
    );
  end if;

  update public.replay_sessions
     set current_bar_index = case when s.warmup_bars > 0 then s.warmup_bars - 1 else -1 end,
         current_simulated_at = bar.ts,
         cash_balance = s.starting_capital,
         status = 'created',
         started_at = null,
         completed_at = null,
         last_advance_request_id = null
   where id = p_session_id;

  return public.get_session_state(p_session_id);
end;
$fn$;

-- ------------------------------------------------------------ read models ---
-- Single round trip that fully restores the UI after a refresh.
create or replace function public.get_session_state(
  p_session_id uuid,
  p_since_bar  integer default null
)
returns jsonb
language plpgsql
security definer
-- Deliberately VOLATILE: advance_replay calls this after writing, and a STABLE
-- function would risk answering from a stale snapshot.
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  s     public.replay_sessions;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into s from public.replay_sessions where id = p_session_id;
  if not found or s.user_id <> v_uid then
    raise exception 'Replay session not found' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'session', to_jsonb(s),
    'instrument', (select to_jsonb(i) from public.instruments i where i.id = s.instrument_id),
    'position', (select to_jsonb(p) from public.paper_positions p
                  where p.session_id = p_session_id limit 1),
    -- Only candles the engine has released; never the full window.
    'candles', coalesce((
      select jsonb_agg(c order by c.bar_index)
      from (
        select (row_number() over (order by mc.ts))::integer - 1 as bar_index,
               mc.ts, mc.open, mc.high, mc.low, mc.close, mc.volume
        from public.market_candles mc
        where mc.instrument_id = s.instrument_id
          and mc.timeframe = s.timeframe
          and mc.ts >= s.start_ts and mc.ts <= s.end_ts
      ) c
      where c.bar_index <= s.current_bar_index
        and (p_since_bar is null or c.bar_index >= p_since_bar)
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.submitted_at desc)
      from public.paper_orders o where o.session_id = p_session_id), '[]'::jsonb),
    'fills', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.bar_index, f.created_at)
      from public.paper_fills f where f.session_id = p_session_id), '[]'::jsonb),
    'trades', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.trade_number)
      from public.trade_journal t where t.session_id = p_session_id), '[]'::jsonb),
    'equity', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.bar_index)
      from public.equity_snapshots e where e.session_id = p_session_id), '[]'::jsonb)
  );
end;
$fn$;

-- Metrics computed from the persisted ledger, never from UI state.
create or replace function public.session_performance(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := (select auth.uid());
  s        public.replay_sessions;
  pos      public.paper_positions;
  snap     public.equity_snapshots;
  v_result jsonb;
  v_streak jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into s from public.replay_sessions where id = p_session_id;
  if not found or s.user_id <> v_uid then
    raise exception 'Replay session not found' using errcode = '42501';
  end if;

  select * into pos from public.paper_positions where session_id = p_session_id limit 1;
  select * into snap from public.equity_snapshots
   where session_id = p_session_id order by bar_index desc limit 1;

  with closed as (
    select * from public.trade_journal
     where session_id = p_session_id and status = 'closed'
  ),
  streaks as (
    select net_pnl > 0 as win, trade_number,
           trade_number - row_number() over (partition by net_pnl > 0 order by trade_number) as grp
    from closed
  ),
  runs as (
    select win, count(*) as run_len from streaks group by win, grp
  )
  select jsonb_build_object(
    'trades',            (select count(*) from closed),
    'wins',              (select count(*) from closed where net_pnl > 0),
    'losses',            (select count(*) from closed where net_pnl < 0),
    'breakeven',         (select count(*) from closed where net_pnl = 0),
    'win_rate',          (select case when count(*) = 0 then 0
                            else round(count(*) filter (where net_pnl > 0)::numeric / count(*) * 100, 2) end from closed),
    'gross_realized',    (select coalesce(sum(gross_pnl), 0) from closed),
    'total_fees',        coalesce(pos.total_fees, 0),
    'net_realized',      (select coalesce(sum(net_pnl), 0) from closed),
    'average_win',       (select coalesce(round(avg(net_pnl), 4), 0) from closed where net_pnl > 0),
    'average_loss',      (select coalesce(round(avg(net_pnl), 4), 0) from closed where net_pnl < 0),
    'largest_win',       (select coalesce(max(net_pnl), 0) from closed),
    'largest_loss',      (select coalesce(min(net_pnl), 0) from closed),
    'profit_factor',     (select case
                            when coalesce(abs(sum(net_pnl) filter (where net_pnl < 0)), 0) = 0 then null
                            else round(coalesce(sum(net_pnl) filter (where net_pnl > 0), 0)
                                 / abs(sum(net_pnl) filter (where net_pnl < 0)), 4) end from closed),
    'expectancy',        (select case when count(*) = 0 then 0 else round(avg(net_pnl), 4) end from closed),
    'risk_reward',       (select case
                            when coalesce(abs(avg(net_pnl) filter (where net_pnl < 0)), 0) = 0 then null
                            else round(coalesce(avg(net_pnl) filter (where net_pnl > 0), 0)
                                 / abs(avg(net_pnl) filter (where net_pnl < 0)), 4) end from closed),
    'average_holding_bars', (select coalesce(round(avg(holding_bars), 2), 0) from closed),
    'max_consecutive_wins',   (select coalesce(max(run_len) filter (where win), 0) from runs),
    'max_consecutive_losses', (select coalesce(max(run_len) filter (where not win), 0) from runs),
    'long',  (select jsonb_build_object(
                'trades', count(*), 'net_pnl', coalesce(sum(net_pnl), 0),
                'wins', count(*) filter (where net_pnl > 0))
              from closed where direction = 'LONG'),
    'short', (select jsonb_build_object(
                'trades', count(*), 'net_pnl', coalesce(sum(net_pnl), 0),
                'wins', count(*) filter (where net_pnl > 0))
              from closed where direction = 'SHORT')
  ) into v_result;

  return v_result || jsonb_build_object(
    'starting_capital', s.starting_capital,
    'cash',             s.cash_balance,
    'equity',           coalesce(snap.equity, s.starting_capital),
    'unrealized_pnl',   coalesce(snap.unrealized_pnl, 0),
    'open_quantity',    coalesce(pos.signed_quantity, 0),
    'average_entry',    coalesce(pos.average_entry_price, 0),
    'total_return_pct', round((coalesce(snap.equity, s.starting_capital) - s.starting_capital)
                              / s.starting_capital * 100, 4),
    'max_drawdown',     (select coalesce(min(drawdown), 0) from public.equity_snapshots
                          where session_id = p_session_id),
    'max_drawdown_pct', (select coalesce(round(min(drawdown / nullif(peak_equity, 0)) * 100, 4), 0)
                          from public.equity_snapshots where session_id = p_session_id),
    'bars_elapsed',     s.current_bar_index + 1,
    'total_bars',       s.total_bars
  );
end;
$fn$;

-- --------------------------------------------------------------- privileges ---
revoke all on function public.create_replay_session(uuid, text, timestamptz, timestamptz, numeric, numeric, jsonb, jsonb, boolean, boolean, integer, integer, text, text, time, time) from public, anon;
revoke all on function public.submit_paper_order(uuid, text, text, numeric, boolean) from public, anon;
revoke all on function public.cancel_paper_order(uuid) from public, anon;
revoke all on function public.advance_replay(uuid, integer, text) from public, anon;
revoke all on function public.set_session_status(uuid, text) from public, anon;
revoke all on function public.set_session_speed(uuid, integer) from public, anon;
revoke all on function public.restart_replay_session(uuid) from public, anon;
revoke all on function public.get_session_state(uuid, integer) from public, anon;
revoke all on function public.session_performance(uuid) from public, anon;

grant execute on function public.create_replay_session(uuid, text, timestamptz, timestamptz, numeric, numeric, jsonb, jsonb, boolean, boolean, integer, integer, text, text, time, time) to authenticated;
grant execute on function public.submit_paper_order(uuid, text, text, numeric, boolean) to authenticated;
grant execute on function public.cancel_paper_order(uuid) to authenticated;
grant execute on function public.advance_replay(uuid, integer, text) to authenticated;
grant execute on function public.set_session_status(uuid, text) to authenticated;
grant execute on function public.set_session_speed(uuid, integer) to authenticated;
grant execute on function public.restart_replay_session(uuid) to authenticated;
grant execute on function public.get_session_state(uuid, integer) to authenticated;
grant execute on function public.session_performance(uuid) to authenticated;
