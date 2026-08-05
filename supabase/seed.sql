-- =============================================================================
-- Demo seed data
-- =============================================================================
-- A synthetic instrument with 60 daily candles, so a fresh sign-in can create a
-- replay session immediately without importing anything.
--
--   bar i:  open = 100 + i,  high = 102 + i,  low = 98 + i,  close = 101 + i
--
-- The arithmetic is deliberately trivial: every fill price and P&L figure the
-- engine produces on this series can be checked by hand, which is what the
-- suite in supabase/tests/engine_tests.sql relies on.
--
-- Run with:  psql "$SUPABASE_DB_URL" -f supabase/seed.sql
-- =============================================================================

insert into public.instruments (symbol, name, exchange, asset_type, currency, timezone, tick_size, lot_size)
values ('DEMO', 'Demo synthetic series (open = 100 + bar)', 'TEST', 'EQUITY', 'INR', 'Asia/Kolkata', 0.05, 1)
on conflict (exchange, symbol) do nothing;

insert into public.market_candles (instrument_id, timeframe, ts, open, high, low, close, volume)
select i.id, 'day',
       (timestamptz '2026-01-01 09:15:00+05:30') + (g || ' days')::interval,
       100 + g, 102 + g, 98 + g, 101 + g, 1000 + g
from public.instruments i, generate_series(0, 59) g
where i.exchange = 'TEST' and i.symbol = 'DEMO'
on conflict (instrument_id, timeframe, ts) do nothing;
