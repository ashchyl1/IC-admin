-- =============================================================================
-- Replay + paper order execution engine
-- =============================================================================
-- Everything that touches money lives here, in the database, in numeric
-- arithmetic, inside one transaction per call. The browser never computes a
-- balance it then writes back.
--
-- Security posture:
--   * Internals live in the `engine` schema, which is NOT exposed to the Data
--     API. EXECUTE on them is revoked from public/anon/authenticated.
--   * The callable RPCs are thin SECURITY DEFINER wrappers in `public` that
--     verify auth.uid() ownership explicitly before doing anything, pin
--     search_path to '', and are granted only to `authenticated`.
--
-- Cash / margin model (documented, per brief §6):
--   BUY  -> cash -= qty * fill_price ; cash -= fees
--   SELL -> cash += qty * fill_price ; cash -= fees
--   Equity = cash + signed_quantity * price. Shorts therefore credit cash on
--   entry and debit it on cover. Opening or increasing a short requires cash >=
--   notional, i.e. a flat 100% margin requirement. This keeps one arithmetic
--   path for both directions and makes
--       equity = starting_capital + net_realized_pnl + unrealized_pnl
--   hold exactly at every bar.
-- =============================================================================

create schema if not exists engine;
revoke all on schema engine from public, anon, authenticated;

-- Columns the brief did not anticipate but the engine needs.
alter table public.replay_sessions
  add column if not exists last_advance_request_id text;
alter table public.trade_journal
  add column if not exists exit_quantity numeric(20, 4) not null default 0;

do $$ begin
  create type engine.candle as (
    bar_index integer,
    ts        timestamptz,
    open      numeric,
    high      numeric,
    low       numeric,
    close     numeric,
    volume    numeric
  );
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- fee model ---
-- brokerage_mode: 'flat' | 'percent' | 'min_of_flat_and_percent'
-- Rates are configuration, never hard-coded, because statutory charges change.
create or replace function engine.compute_fees(p_fee_config jsonb, p_notional numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mode      text    := coalesce(p_fee_config ->> 'brokerage_mode', 'min_of_flat_and_percent');
  v_flat      numeric := coalesce((p_fee_config ->> 'flat')::numeric, (p_fee_config ->> 'per_order')::numeric, 0);
  v_percent   numeric := coalesce((p_fee_config ->> 'percent')::numeric, 0);
  v_cap       numeric := nullif(coalesce((p_fee_config ->> 'percent_cap')::numeric, 0), 0);
  v_min       numeric := coalesce((p_fee_config ->> 'min_commission')::numeric, 0);
  v_exch_bps  numeric := coalesce((p_fee_config ->> 'exchange_bps')::numeric, 0);
  v_stat_bps  numeric := coalesce((p_fee_config ->> 'statutory_bps')::numeric, 0);
  v_pct_value numeric;
  v_brokerage numeric;
begin
  v_pct_value := v_percent / 100.0 * p_notional;
  if v_cap is not null then
    v_pct_value := least(v_pct_value, v_cap);
  end if;

  v_brokerage := case v_mode
    when 'flat'    then v_flat
    when 'percent' then v_pct_value
    else least(v_flat, v_pct_value)
  end;

  v_brokerage := greatest(v_brokerage, v_min);

  return round(v_brokerage + (v_exch_bps + v_stat_bps) / 10000.0 * p_notional, 4);
end;
$$;

-- ---------------------------------------------------------- slippage model ---
-- mode: 'ticks' | 'points' | 'bps'. Always applied against the trader.
create or replace function engine.compute_slippage(
  p_slippage_config jsonb,
  p_tick_size       numeric,
  p_price           numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mode  text    := coalesce(p_slippage_config ->> 'mode', 'ticks');
  v_value numeric := coalesce((p_slippage_config ->> 'value')::numeric, 0);
begin
  return round(
    case v_mode
      when 'points' then v_value
      when 'bps'    then v_value / 10000.0 * p_price
      else               v_value * p_tick_size
    end, 6);
end;
$$;

-- ------------------------------------------------------- candle addressing ---
-- Bar index is 0-based within the session's [start_ts, end_ts] window, ordered
-- by time. Uses the (instrument_id, timeframe, ts) index.
create or replace function engine.candle_at(p_session_id uuid, p_index integer)
returns engine.candle
language sql
stable
set search_path = ''
as $$
  select (p_index, c.ts, c.open, c.high, c.low, c.close, c.volume)::engine.candle
  from public.replay_sessions s
  join public.market_candles c
    on c.instrument_id = s.instrument_id
   and c.timeframe = s.timeframe
   and c.ts >= s.start_ts
   and c.ts <= s.end_ts
  where s.id = p_session_id
  order by c.ts
  offset greatest(p_index, 0)
  limit 1;
$$;

create or replace function engine.count_bars(p_session_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.replay_sessions s
  join public.market_candles c
    on c.instrument_id = s.instrument_id
   and c.timeframe = s.timeframe
   and c.ts >= s.start_ts
   and c.ts <= s.end_ts
  where s.id = p_session_id;
$$;

-- ============================================================================
-- engine.release_bar -- the single place a candle becomes visible.
-- ============================================================================
-- For the bar at p_index it, in order:
--   1. fills every pending order at that bar's OPEN (+/- slippage),
--   2. updates position, average entry, cash, realized P&L and the journal,
--   3. advances the session cursor onto the bar,
--   4. marks MFE/MAE against the bar's high/low for any open trade,
--   5. writes the equity snapshot from the bar's CLOSE.
-- Nothing reads a candle beyond p_index, which is what keeps the simulation
-- free of look-ahead bias.
create or replace function engine.release_bar(p_session_id uuid, p_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          public.replay_sessions;
  bar        engine.candle;
  ord        public.paper_orders;
  pos        public.paper_positions;
  trade      public.trade_journal;
  v_tick     numeric;
  v_instr    uuid;
  v_slip     numeric;
  v_raw      numeric;
  v_fill     numeric;
  v_qty      numeric;
  v_delta    numeric;
  v_closing  numeric;
  v_opening  numeric;
  v_realized numeric;
  v_fees     numeric;
  v_fee_close numeric;
  v_fee_open  numeric;
  v_new_pos  numeric;
  v_new_avg  numeric;
  v_cash     numeric;
  v_peak     numeric;
  v_mv       numeric;
  v_equity   numeric;
  v_unreal   numeric;
  v_net_real numeric;
  v_next_no  integer;
begin
  -- Lets the trade_journal immutability guard know these writes are the engine's.
  perform set_config('app.engine', 'on', true);

  select * into s from public.replay_sessions where id = p_session_id;
  bar := engine.candle_at(p_session_id, p_index);
  if bar.ts is null then
    raise exception 'No candle at index % for session %', p_index, p_session_id;
  end if;

  select i.id, i.tick_size into v_instr, v_tick
  from public.instruments i where i.id = s.instrument_id;

  select * into pos from public.paper_positions
   where session_id = p_session_id and instrument_id = v_instr for update;

  v_cash := s.cash_balance;

  -- ---------------------------------------------------------- fill orders ---
  for ord in
    select * from public.paper_orders
     where session_id = p_session_id and status = 'pending'
     order by submitted_at, id
  loop
    v_qty  := ord.quantity;
    v_slip := engine.compute_slippage(s.slippage_config, v_tick, bar.open);
    v_raw  := bar.open;
    v_fill := case when ord.side = 'BUY' then v_raw + v_slip else v_raw - v_slip end;

    if v_fill <= 0 then
      update public.paper_orders
         set status = 'rejected',
             rejection_reason = 'Slippage produced a non-positive fill price',
             cancelled_at = now()
       where id = ord.id;
      continue;
    end if;

    v_delta := case when ord.side = 'BUY' then v_qty else -v_qty end;
    v_fees  := engine.compute_fees(s.fee_config, v_qty * v_fill);

    -- Split into the part that closes existing exposure and the part that
    -- opens new exposure. Only the closing part realises P&L.
    v_closing := 0;
    v_realized := 0;
    if pos.signed_quantity <> 0 and sign(v_delta) <> sign(pos.signed_quantity) then
      v_closing := least(v_qty, abs(pos.signed_quantity));
      v_realized := case
        when pos.signed_quantity > 0 then (v_fill - pos.average_entry_price) * v_closing
        else (pos.average_entry_price - v_fill) * v_closing
      end;
    end if;
    v_opening := v_qty - v_closing;

    v_new_pos := pos.signed_quantity + v_delta;
    if v_new_pos = 0 then
      v_new_avg := 0;
    elsif pos.signed_quantity = 0 then
      v_new_avg := v_fill;
    elsif sign(v_delta) = sign(pos.signed_quantity) then
      v_new_avg := (pos.average_entry_price * abs(pos.signed_quantity) + v_fill * v_qty)
                   / (abs(pos.signed_quantity) + v_qty);
    elsif v_opening > 0 then
      v_new_avg := v_fill;                      -- reversal: new leg starts here
    else
      v_new_avg := pos.average_entry_price;     -- partial close, entry unchanged
    end if;

    v_cash := v_cash + case when ord.side = 'BUY' then -(v_qty * v_fill) else (v_qty * v_fill) end - v_fees;

    v_fee_close := case when v_qty > 0 then round(v_fees * v_closing / v_qty, 4) else 0 end;
    v_fee_open  := v_fees - v_fee_close;

    -- ------------------------------------------------------------ journal ---
    if v_closing > 0 then
      select * into trade from public.trade_journal
       where session_id = p_session_id and status = 'open'
       order by trade_number desc limit 1;

      if found then
        update public.trade_journal
           set gross_pnl = gross_pnl + v_realized,
               fees = fees + v_fee_close,
               exit_quantity = exit_quantity + v_closing,
               average_exit_price = case
                 when exit_quantity + v_closing = 0 then null
                 else (coalesce(average_exit_price, 0) * exit_quantity + v_fill * v_closing)
                      / (exit_quantity + v_closing)
               end,
               status = case when abs(v_new_pos) = 0 or v_opening > 0 then 'closed' else 'open' end,
               exit_ts = case when abs(v_new_pos) = 0 or v_opening > 0 then bar.ts else exit_ts end,
               exit_bar_index = case when abs(v_new_pos) = 0 or v_opening > 0 then p_index else exit_bar_index end,
               holding_bars = case when abs(v_new_pos) = 0 or v_opening > 0 then p_index - entry_bar_index else holding_bars end,
               net_pnl = gross_pnl + v_realized - (fees + v_fee_close),
               return_percentage = case
                 when average_entry_price * quantity = 0 then null
                 else (gross_pnl + v_realized - (fees + v_fee_close)) / (average_entry_price * quantity) * 100
               end
         where id = trade.id;
      end if;
    end if;

    if v_opening > 0 then
      if pos.signed_quantity = 0 or sign(v_delta) <> sign(pos.signed_quantity) then
        select coalesce(max(trade_number), 0) + 1 into v_next_no
          from public.trade_journal where session_id = p_session_id;
        insert into public.trade_journal (
          session_id, user_id, instrument_id, trade_number, direction, status,
          entry_ts, entry_bar_index, average_entry_price, quantity, fees, net_pnl
        ) values (
          p_session_id, s.user_id, v_instr, v_next_no,
          case when v_delta > 0 then 'LONG' else 'SHORT' end::public.trade_direction,
          'open', bar.ts, p_index, v_fill, v_opening, v_fee_open, -v_fee_open
        );
      else
        update public.trade_journal
           set quantity = quantity + v_opening,
               average_entry_price = v_new_avg,
               fees = fees + v_fee_open,
               net_pnl = gross_pnl - (fees + v_fee_open)
         where session_id = p_session_id and status = 'open';
      end if;
    end if;

    -- ----------------------------------------------------------- position ---
    update public.paper_positions
       set signed_quantity = v_new_pos,
           average_entry_price = v_new_avg,
           realized_pnl = realized_pnl + v_realized,
           total_fees = total_fees + v_fees,
           updated_at = now()
     where id = pos.id;

    insert into public.paper_fills (
      order_id, session_id, user_id, instrument_id, side, quantity, raw_price,
      slippage_amount, fill_price, fees, bar_index, simulated_ts, realized_pnl,
      position_after, avg_entry_after, cash_after
    ) values (
      ord.id, p_session_id, s.user_id, v_instr, ord.side, v_qty, v_raw,
      v_slip, v_fill, v_fees, p_index, bar.ts, v_realized,
      v_new_pos, v_new_avg, v_cash
    );

    update public.paper_orders
       set status = 'filled', filled_at = now(), reference_price = v_raw
     where id = ord.id;

    select * into pos from public.paper_positions where id = pos.id;
  end loop;

  -- ------------------------------------------------------ advance cursor ---
  update public.replay_sessions
     set current_bar_index = p_index,
         current_simulated_at = bar.ts,
         cash_balance = v_cash,
         started_at = coalesce(started_at, now())
   where id = p_session_id;

  select * into pos from public.paper_positions
   where session_id = p_session_id and instrument_id = v_instr;

  -- --------------------------------------------------------- MFE / MAE -----
  if pos.signed_quantity <> 0 then
    update public.trade_journal
       set mfe = greatest(mfe, case
             when pos.signed_quantity > 0 then (bar.high - pos.average_entry_price) * abs(pos.signed_quantity)
             else (pos.average_entry_price - bar.low) * abs(pos.signed_quantity) end),
           mae = least(mae, case
             when pos.signed_quantity > 0 then (bar.low - pos.average_entry_price) * abs(pos.signed_quantity)
             else (pos.average_entry_price - bar.high) * abs(pos.signed_quantity) end)
     where session_id = p_session_id and status = 'open';
  end if;

  -- ------------------------------------------------------ equity snapshot ---
  v_mv     := pos.signed_quantity * bar.close;
  v_equity := v_cash + v_mv;
  v_unreal := case when pos.signed_quantity = 0 then 0
                   else (bar.close - pos.average_entry_price) * pos.signed_quantity end;
  v_net_real := pos.realized_pnl - pos.total_fees;

  select coalesce(max(peak_equity), s.starting_capital) into v_peak
    from public.equity_snapshots where session_id = p_session_id;
  v_peak := greatest(v_peak, v_equity);

  insert into public.equity_snapshots (
    session_id, user_id, bar_index, simulated_ts, cash, market_value, equity,
    realized_pnl, unrealized_pnl, peak_equity, drawdown
  ) values (
    p_session_id, s.user_id, p_index, bar.ts, v_cash, v_mv, v_equity,
    v_net_real, v_unreal, v_peak, v_equity - v_peak
  )
  on conflict (session_id, bar_index) do update
    set cash = excluded.cash, market_value = excluded.market_value,
        equity = excluded.equity, realized_pnl = excluded.realized_pnl,
        unrealized_pnl = excluded.unrealized_pnl, peak_equity = excluded.peak_equity,
        drawdown = excluded.drawdown;
end;
$$;

revoke all on function engine.release_bar(uuid, integer) from public, anon, authenticated;
revoke all on function engine.compute_fees(jsonb, numeric) from public, anon, authenticated;
revoke all on function engine.compute_slippage(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function engine.candle_at(uuid, integer) from public, anon, authenticated;
revoke all on function engine.count_bars(uuid) from public, anon, authenticated;
