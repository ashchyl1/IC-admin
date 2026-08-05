-- =============================================================================
-- Repeatable engine test suite
-- =============================================================================
-- Run against a NON-PRODUCTION project:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/engine_tests.sql
-- or paste into the SQL editor. Every assertion raises on failure, so the
-- script either completes silently or aborts at the first broken invariant.
--
-- Fixture: bar i has open = 100+i, high = 102+i, low = 98+i, close = 101+i.
-- Every expected number below is therefore hand-checkable.
-- =============================================================================

begin;

-- --------------------------------------------------------------- fixtures ---
insert into public.instruments (symbol, name, exchange, asset_type, currency, tick_size, lot_size)
values ('TESTCO', 'Engine Test Instrument', 'TEST', 'EQUITY', 'INR', 0.05, 1)
on conflict (exchange, symbol) do nothing;

insert into public.market_candles (instrument_id, timeframe, ts, open, high, low, close, volume)
select i.id, 'day',
       (timestamptz '2026-01-01 09:15:00+05:30') + (g || ' days')::interval,
       100 + g, 102 + g, 98 + g, 101 + g, 1000 + g
from public.instruments i, generate_series(0, 59) g
where i.exchange = 'TEST' and i.symbol = 'TESTCO'
on conflict (instrument_id, timeframe, ts) do nothing;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000'::uuid, u.uid, 'authenticated', 'authenticated',
       u.email, crypt('engine-test-only', gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', u.label)
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'engine-test-a@example.test', 'Engine Test A'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'engine-test-b@example.test', 'Engine Test B')
) as u(uid, email, label)
on conflict (id) do nothing;

-- =========================================================== 1. long cycle ===
-- warmup 5 => bars 0..4 visible (close 105)
-- BUY 10 @ bar 4  -> fills bar 5 open  = 105
-- SELL 10 @ bar 7 -> fills bar 8 open  = 108, realised = 30
do $$
declare
  v_instr uuid; v_s uuid; v_cash numeric; v_pos numeric; v_real numeric;
  t public.trade_journal;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select id into v_instr from public.instruments where exchange = 'TEST' and symbol = 'TESTCO';

  v_s := (public.create_replay_session(
    v_instr, 'day', timestamptz '2026-01-01 00:00:00+05:30', timestamptz '2026-04-01 00:00:00+05:30',
    100000, 10, '{"mode":"points","value":0}'::jsonb,
    '{"brokerage_mode":"flat","flat":0,"percent":0,"exchange_bps":0,"statutory_bps":0}'::jsonb,
    true, false, 5, 1, 'T1-LONG')).id;

  perform public.submit_paper_order(v_s, 'b1', 'BUY', 10);
  perform public.advance_replay(v_s, 1, 'r1');
  perform public.advance_replay(v_s, 2, 'r2');
  perform public.submit_paper_order(v_s, 's1', 'SELL', 10);
  perform public.advance_replay(v_s, 1, 'r3');

  select cash_balance into v_cash from public.replay_sessions where id = v_s;
  select signed_quantity, realized_pnl into v_pos, v_real
    from public.paper_positions where session_id = v_s;

  if v_cash <> 100030 then raise exception 'T1 cash: expected 100030, got %', v_cash; end if;
  if v_pos <> 0 then raise exception 'T1 position: expected flat, got %', v_pos; end if;
  if v_real <> 30 then raise exception 'T1 realised: expected 30, got %', v_real; end if;

  select * into t from public.trade_journal where session_id = v_s and trade_number = 1;
  if t.average_entry_price <> 105 then raise exception 'T1 entry: %', t.average_entry_price; end if;
  if t.average_exit_price <> 108 then raise exception 'T1 exit: %', t.average_exit_price; end if;
  if t.holding_bars <> 3 then raise exception 'T1 holding bars: %', t.holding_bars; end if;
  if t.mfe <> 40 then raise exception 'T1 MFE: expected 40, got %', t.mfe; end if;
  if t.mae <> -20 then raise exception 'T1 MAE: expected -20, got %', t.mae; end if;
  if t.status <> 'closed' then raise exception 'T1 status: %', t.status; end if;

  -- ===================================================== 2. short cycle ===
  -- SELL 10 @ bar 8  -> fills bar 9  open = 109
  -- BUY  10 @ bar 10 -> fills bar 11 open = 111, realised = -20
  perform public.submit_paper_order(v_s, 'sh1', 'SELL', 10);
  perform public.advance_replay(v_s, 1, 'r4');
  perform public.advance_replay(v_s, 1, 'r5');
  perform public.submit_paper_order(v_s, 'cv1', 'BUY', 10);
  perform public.advance_replay(v_s, 1, 'r6');

  select * into t from public.trade_journal where session_id = v_s and trade_number = 2;
  if t.direction <> 'SHORT' then raise exception 'T2 direction: %', t.direction; end if;
  if t.average_entry_price <> 109 then raise exception 'T2 entry: %', t.average_entry_price; end if;
  if t.gross_pnl <> -20 then raise exception 'T2 gross: expected -20, got %', t.gross_pnl; end if;

  raise notice 'T1/T2 long + short cycles OK';
end $$;

-- ============================== 3. slippage, fees, partial exit, rejections ===
do $$
declare
  v_instr uuid; v_f uuid; v_r uuid; o public.paper_orders; o2 public.paper_orders;
  v_cash numeric; v_avg numeric; v_real numeric; v_fees numeric; v_cnt integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select id into v_instr from public.instruments where exchange = 'TEST' and symbol = 'TESTCO';

  -- 1 tick slippage (0.05) + flat 20 brokerage + 3.45 bps exchange charge
  v_f := (public.create_replay_session(
    v_instr, 'day', timestamptz '2026-01-01 00:00:00+05:30', timestamptz '2026-04-01 00:00:00+05:30',
    100000, 10, '{"mode":"ticks","value":1}'::jsonb,
    '{"brokerage_mode":"flat","flat":20,"percent":0,"exchange_bps":3.45,"statutory_bps":0}'::jsonb,
    true, false, 5, 1, 'T3-FEES')).id;

  perform public.submit_paper_order(v_f, 'f1', 'BUY', 20);
  perform public.advance_replay(v_f, 3, 'f-a');
  perform public.submit_paper_order(v_f, 'f2', 'SELL', 10);
  perform public.advance_replay(v_f, 1, 'f-b');

  select cash_balance into v_cash from public.replay_sessions where id = v_f;
  select average_entry_price, realized_pnl, total_fees into v_avg, v_real, v_fees
    from public.paper_positions where session_id = v_f;

  -- buy  20 @ 105.05 -> 2101.00 + fees 20.7248
  -- sell 10 @ 107.95 -> 1079.50 - fees 20.3724 ; realised (107.95-105.05)*10 = 29
  if v_avg  <> 105.05    then raise exception 'T3 avg entry: %', v_avg;  end if;
  if v_real <> 29        then raise exception 'T3 realised: %', v_real;  end if;
  if v_fees <> 41.0972   then raise exception 'T3 fees: %', v_fees;      end if;
  if v_cash <> 98937.4028 then raise exception 'T3 cash: %', v_cash;     end if;

  -- reversal disabled
  o := public.submit_paper_order(v_f, 'f3', 'SELL', 30);
  if o.status <> 'rejected' or o.rejection_reason not like '%reversal%' then
    raise exception 'T3 reversal should be rejected, got % / %', o.status, o.rejection_reason;
  end if;

  -- idempotency: same client_order_id must not create a second order
  o2 := public.submit_paper_order(v_f, 'f3', 'SELL', 30);
  if o.id <> o2.id then raise exception 'T3 idempotency: duplicate order created'; end if;
  select count(*) into v_cnt from public.paper_orders where session_id = v_f and client_order_id = 'f3';
  if v_cnt <> 1 then raise exception 'T3 idempotency: % rows for one client_order_id', v_cnt; end if;

  -- buying power + long-only
  v_r := (public.create_replay_session(
    v_instr, 'day', timestamptz '2026-01-01 00:00:00+05:30', timestamptz '2026-04-01 00:00:00+05:30',
    1000, 10, '{"mode":"points","value":0}'::jsonb,
    '{"brokerage_mode":"flat","flat":20,"exchange_bps":3.45}'::jsonb,
    false, false, 5, 1, 'T3-REJECT')).id;

  o := public.submit_paper_order(v_r, 'r1', 'BUY', 10);
  if o.status <> 'rejected' or o.rejection_reason not like '%buying power%' then
    raise exception 'T3 buying power should be rejected, got %', o.rejection_reason;
  end if;

  o := public.submit_paper_order(v_r, 'r2', 'SELL', 10);
  if o.status <> 'rejected' or o.rejection_reason not like '%Long-only%' then
    raise exception 'T3 long-only should be rejected, got %', o.rejection_reason;
  end if;

  raise notice 'T3 fees, slippage, partial exit and rejections OK';
end $$;

-- ================================= 4. advance idempotency + equity identity ===
do $$
declare v_s uuid; v_before integer; v_after integer; v_bad integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select id into v_s from public.replay_sessions where name = 'T3-FEES';

  select current_bar_index into v_before from public.replay_sessions where id = v_s;
  perform public.advance_replay(v_s, 2, 'dup');
  select current_bar_index into v_after from public.replay_sessions where id = v_s;
  if v_after <> v_before + 2 then
    raise exception 'T4 advance moved % bars, expected 2', v_after - v_before;
  end if;

  perform public.advance_replay(v_s, 2, 'dup');   -- replayed request
  select current_bar_index into v_before from public.replay_sessions where id = v_s;
  if v_before <> v_after then raise exception 'T4 replayed request advanced the cursor'; end if;

  select count(*) into v_bad
  from public.equity_snapshots e join public.replay_sessions s on s.id = e.session_id
  where e.session_id = v_s
    and abs(e.equity - (s.starting_capital + e.realized_pnl + e.unrealized_pnl)) > 0.0001;
  if v_bad > 0 then raise exception 'T4 equity identity broken on % snapshots', v_bad; end if;

  select count(*) into v_bad from public.equity_snapshots
   where session_id = v_s and abs(equity - (cash + market_value)) > 0.0001;
  if v_bad > 0 then raise exception 'T4 equity <> cash + market value on % snapshots', v_bad; end if;

  raise notice 'T4 idempotency and equity identities OK';
end $$;

-- ============================================== 5. RLS isolation (two users) ===
do $$
declare v_s uuid; v_cnt integer;
begin
  select id into v_s from public.replay_sessions where name = 'T1-LONG';
  set local role authenticated;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  select count(*) into v_cnt from public.replay_sessions where id = v_s;
  if v_cnt <> 0 then raise exception 'RLS: user B can see user A sessions'; end if;
  select count(*) into v_cnt from public.paper_fills where session_id = v_s;
  if v_cnt <> 0 then raise exception 'RLS: user B can see user A fills'; end if;
  select count(*) into v_cnt from public.trade_journal where session_id = v_s;
  if v_cnt <> 0 then raise exception 'RLS: user B can see user A journal'; end if;
  select count(*) into v_cnt from public.equity_snapshots where session_id = v_s;
  if v_cnt <> 0 then raise exception 'RLS: user B can see user A equity'; end if;

  begin
    perform public.get_session_state(v_s);
    raise exception 'RLS: user B read user A session through the RPC';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select count(*) into v_cnt from public.replay_sessions where id = v_s;
  if v_cnt <> 1 then raise exception 'RLS: owner cannot see own session'; end if;

  reset role;
  raise notice 'T5 RLS isolation OK';
end $$;

-- ==================================== 6. ledger immutability from the client ===
do $$
declare v_s uuid;
begin
  select id into v_s from public.replay_sessions where name = 'T3-FEES';
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    update public.trade_journal set gross_pnl = 999999 where session_id = v_s;
    raise exception 'IMMUTABILITY: client rewrote gross_pnl';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.replay_sessions set cash_balance = 1000000 where id = v_s;
    raise exception 'LEDGER: client rewrote cash_balance';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.paper_fills (order_id, session_id, user_id, instrument_id, side,
      quantity, raw_price, fill_price, bar_index, simulated_ts, position_after,
      avg_entry_after, cash_after)
    select f.order_id, f.session_id, f.user_id, f.instrument_id, 'BUY', 1, 1, 1, 0, now(), 0, 0, 0
    from public.paper_fills f limit 1;
    raise exception 'LEDGER: client forged a fill';
  exception when insufficient_privilege then null;
  end;

  -- annotations must still be allowed
  update public.trade_journal
     set notes = 'test note', strategy = 'test', tags = array['a'], confidence = 3
   where session_id = v_s;

  reset role;
  raise notice 'T6 ledger immutability OK';
end $$;

rollback;   -- change to COMMIT if you want to inspect the fixtures afterwards
