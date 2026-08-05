-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Ownership model: every user-owned table carries user_id and is reachable only
-- when it equals auth.uid(). Policies are all `TO authenticated` -- anon gets
-- nothing anywhere.
--
-- Execution records (orders, fills, positions, equity snapshots) are READ-ONLY
-- to the client. They have SELECT policies and no INSERT/UPDATE/DELETE policy,
-- and the write privileges are revoked outright. The only thing that can write
-- them is the SECURITY DEFINER engine in migration 0003, which re-checks
-- auth.uid() itself. That is what makes the ledger tamper-proof from the
-- browser while still being fully visible to its owner.
-- =============================================================================

alter table public.profiles          enable row level security;
alter table public.instruments       enable row level security;
alter table public.market_candles    enable row level security;
alter table public.replay_sessions   enable row level security;
alter table public.paper_orders      enable row level security;
alter table public.paper_fills       enable row level security;
alter table public.paper_positions   enable row level security;
alter table public.trade_journal     enable row level security;
alter table public.equity_snapshots  enable row level security;

-- ------------------------------------------------------------------ grants ---
-- Start from "no writes", then hand back only what the client legitimately does
-- directly: annotate a journal entry, edit own profile, delete own session.
revoke insert, update, delete on public.instruments      from anon, authenticated;
revoke insert, update, delete on public.market_candles   from anon, authenticated;
revoke insert, update, delete on public.paper_orders     from anon, authenticated;
revoke insert, update, delete on public.paper_fills      from anon, authenticated;
revoke insert, update, delete on public.paper_positions  from anon, authenticated;
revoke insert, update, delete on public.equity_snapshots from anon, authenticated;
revoke insert, update        on public.replay_sessions   from anon, authenticated;
revoke insert, delete        on public.trade_journal     from anon, authenticated;

grant select on public.instruments, public.market_candles to authenticated;
grant select on public.paper_orders, public.paper_fills, public.paper_positions,
                public.equity_snapshots to authenticated;
grant select, delete on public.replay_sessions to authenticated;
grant select, update on public.trade_journal   to authenticated;
grant select, insert, update on public.profiles to authenticated;

-- ---------------------------------------------------------------- profiles ---
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ----------------------------------------------- shared reference / market ---
drop policy if exists instruments_read on public.instruments;
create policy instruments_read on public.instruments
  for select to authenticated using (true);

drop policy if exists market_candles_read on public.market_candles;
create policy market_candles_read on public.market_candles
  for select to authenticated using (true);

-- --------------------------------------------------------- replay_sessions ---
drop policy if exists replay_sessions_select_own on public.replay_sessions;
create policy replay_sessions_select_own on public.replay_sessions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists replay_sessions_delete_own on public.replay_sessions;
create policy replay_sessions_delete_own on public.replay_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ------------------------------------------- execution records: read only ----
drop policy if exists paper_orders_select_own on public.paper_orders;
create policy paper_orders_select_own on public.paper_orders
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists paper_fills_select_own on public.paper_fills;
create policy paper_fills_select_own on public.paper_fills
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists paper_positions_select_own on public.paper_positions;
create policy paper_positions_select_own on public.paper_positions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists equity_snapshots_select_own on public.equity_snapshots;
create policy equity_snapshots_select_own on public.equity_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------ trade_journal ---
drop policy if exists trade_journal_select_own on public.trade_journal;
create policy trade_journal_select_own on public.trade_journal
  for select to authenticated using ((select auth.uid()) = user_id);

-- Annotations only; the guard trigger below rejects edits to engine columns.
drop policy if exists trade_journal_update_own on public.trade_journal;
create policy trade_journal_update_own on public.trade_journal
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -------------------------------------------- immutability of trade results ---
-- The engine sets app.engine = 'on' for the duration of its transaction; any
-- other caller changing an engine-owned column is rejected outright.
create or replace function public.guard_trade_journal_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.engine', true), '') = 'on' then
    return new;
  end if;

  if (new.session_id, new.user_id, new.instrument_id, new.trade_number, new.direction,
      new.status, new.entry_ts, new.exit_ts, new.entry_bar_index, new.exit_bar_index,
      new.average_entry_price, new.average_exit_price, new.quantity, new.gross_pnl,
      new.fees, new.net_pnl, new.return_percentage, new.holding_bars, new.mfe, new.mae)
     is distinct from
     (old.session_id, old.user_id, old.instrument_id, old.trade_number, old.direction,
      old.status, old.entry_ts, old.exit_ts, old.entry_bar_index, old.exit_bar_index,
      old.average_entry_price, old.average_exit_price, old.quantity, old.gross_pnl,
      old.fees, old.net_pnl, old.return_percentage, old.holding_bars, old.mfe, old.mae)
  then
    raise exception 'Trade execution results are immutable; only annotations may be edited'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trade_journal_guard on public.trade_journal;
create trigger trade_journal_guard before update on public.trade_journal
  for each row execute function public.guard_trade_journal_columns();
