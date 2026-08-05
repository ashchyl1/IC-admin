-- =============================================================================
-- Harden the trade-journal immutability guard
-- =============================================================================
-- The original guard in 0002 keyed off a `app.engine` GUC set by the engine
-- with set_config(..., is_local => true). That flag lasts for the whole
-- transaction, not just the engine call, so a client UPDATE arriving in the
-- same transaction as an engine call would have bypassed the guard and been
-- able to rewrite its own P&L. Caught by the invariant tests.
--
-- The boundary is now the role, which a browser client cannot forge: engine
-- functions are SECURITY DEFINER and run as the table owner, while anything
-- from PostgREST arrives as `authenticated` or `anon`.
--
-- Also adds exit_quantity (introduced in 0003) to the protected column set.
-- =============================================================================

create or replace function public.guard_trade_journal_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if (new.session_id, new.user_id, new.instrument_id, new.trade_number, new.direction,
      new.status, new.entry_ts, new.exit_ts, new.entry_bar_index, new.exit_bar_index,
      new.average_entry_price, new.average_exit_price, new.quantity, new.exit_quantity,
      new.gross_pnl, new.fees, new.net_pnl, new.return_percentage, new.holding_bars,
      new.mfe, new.mae)
     is distinct from
     (old.session_id, old.user_id, old.instrument_id, old.trade_number, old.direction,
      old.status, old.entry_ts, old.exit_ts, old.entry_bar_index, old.exit_bar_index,
      old.average_entry_price, old.average_exit_price, old.quantity, old.exit_quantity,
      old.gross_pnl, old.fees, old.net_pnl, old.return_percentage, old.holding_bars,
      old.mfe, old.mae)
  then
    raise exception 'Trade execution results are immutable; only annotations may be edited'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;
