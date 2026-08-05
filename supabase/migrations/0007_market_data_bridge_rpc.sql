-- =============================================================================
-- Market-data bridge: a narrow import path for the Kite MCP Console
-- =============================================================================
-- `instruments` and `market_candles` are shared reference data with no client
-- write policy, so an external importer previously needed the service-role key.
-- That key can read and write everything in the project, including auth, which
-- is far more authority than "load some candles" requires.
--
-- This function is the alternative: it can do exactly one thing -- upsert an
-- instrument and its candles -- and is gated by a bcrypt-hashed key held in the
-- non-exposed `bridge` schema. A leak of the console's config therefore cannot
-- reach user sessions, orders, fills or journals.
--
-- EXECUTE is granted to `anon` because the console is a server-side process
-- with no Supabase user session; the bridge key, not the role, is the gate.
-- Rotate it with:
--   update bridge.api_keys
--      set key_hash = extensions.crypt('<new key>', extensions.gen_salt('bf'))
--    where name = 'kite-console';
-- =============================================================================

create schema if not exists bridge;
revoke all on schema bridge from public, anon, authenticated;

create table if not exists bridge.api_keys (
  name         text primary key,
  key_hash     text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  call_count   bigint not null default 0
);

alter table bridge.api_keys enable row level security;
revoke all on table bridge.api_keys from public, anon, authenticated;

create or replace function public.import_market_candles(
  p_key        text,
  p_exchange   text,
  p_symbol     text,
  p_timeframe  text,
  p_candles    jsonb,
  p_name       text    default null,
  p_asset_type text    default 'EQUITY',
  p_currency   text    default 'INR',
  p_timezone   text    default 'Asia/Kolkata',
  p_tick_size  numeric default 0.05,
  p_lot_size   integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key_row    bridge.api_keys;
  v_instrument uuid;
  v_exchange   text := upper(trim(p_exchange));
  v_symbol     text := upper(trim(p_symbol));
  v_before     integer;
  v_after      integer;
  v_valid      integer;
  v_rejected   jsonb;
begin
  select * into v_key_row from bridge.api_keys where name = 'kite-console';
  if not found or v_key_row.key_hash <> extensions.crypt(coalesce(p_key, ''), v_key_row.key_hash) then
    raise exception 'Invalid bridge key' using errcode = '42501';
  end if;

  if p_candles is null or jsonb_typeof(p_candles) <> 'array' or jsonb_array_length(p_candles) = 0 then
    raise exception 'p_candles must be a non-empty JSON array';
  end if;
  if v_exchange is null or v_symbol is null or coalesce(p_timeframe, '') = '' then
    raise exception 'exchange, symbol and timeframe are required';
  end if;

  update bridge.api_keys
     set last_used_at = now(), call_count = call_count + 1
   where name = 'kite-console';

  select id into v_instrument from public.instruments
   where exchange = v_exchange and symbol = v_symbol;

  if v_instrument is null then
    insert into public.instruments (exchange, symbol, name, asset_type, currency, timezone, tick_size, lot_size)
    values (v_exchange, v_symbol, coalesce(p_name, v_symbol), coalesce(p_asset_type, 'EQUITY'),
            coalesce(p_currency, 'INR'), coalesce(p_timezone, 'Asia/Kolkata'),
            case when p_tick_size > 0 then p_tick_size else 0.05 end,
            case when p_lot_size > 0 then p_lot_size else 1 end)
    returning id into v_instrument;
  end if;

  select count(*)::integer into v_before
    from public.market_candles
   where instrument_id = v_instrument and timeframe = p_timeframe;

  -- Re-validate server-side: the CHECK constraints would abort the whole
  -- statement on one bad row, so bad rows are reported rather than fatal.
  with parsed as (
    select (c ->> 'ts')::timestamptz as ts,
           (c ->> 'open')::numeric   as open,
           (c ->> 'high')::numeric   as high,
           (c ->> 'low')::numeric    as low,
           (c ->> 'close')::numeric  as close,
           coalesce((c ->> 'volume')::numeric, 0) as volume
    from jsonb_array_elements(p_candles) c
  ),
  judged as (
    select *, case
      when ts is null then 'unparseable ts'
      when open is null or high is null or low is null or close is null then 'missing OHLC'
      when least(open, high, low, close) <= 0 then 'non-positive price'
      when volume < 0 then 'negative volume'
      when high < greatest(open, low, close) then 'high is not the maximum'
      when low > least(open, high, close) then 'low is not the minimum'
      else null end as reason
    from parsed
  ),
  good as (
    select distinct on (ts) ts, open, high, low, close, volume
    from judged where reason is null order by ts
  ),
  ins as (
    insert into public.market_candles (instrument_id, timeframe, ts, open, high, low, close, volume)
    select v_instrument, p_timeframe, ts, open, high, low, close, volume from good
    on conflict (instrument_id, timeframe, ts) do update
      set open = excluded.open, high = excluded.high, low = excluded.low,
          close = excluded.close, volume = excluded.volume
    returning 1
  )
  select (select count(*)::integer from ins),
         coalesce((select jsonb_agg(jsonb_build_object('ts', ts, 'reason', reason))
                   from judged where reason is not null), '[]'::jsonb)
    into v_valid, v_rejected;

  select count(*)::integer into v_after
    from public.market_candles
   where instrument_id = v_instrument and timeframe = p_timeframe;

  return jsonb_build_object(
    'instrumentId', v_instrument,
    'timeframe', p_timeframe,
    'received', jsonb_array_length(p_candles),
    'written', v_valid,
    'rejected', v_rejected,
    'existingBefore', v_before,
    'totalAfter', v_after,
    'inserted', v_after - v_before,
    'updated', v_valid - (v_after - v_before)
  );
end;
$fn$;

revoke all on function public.import_market_candles(text, text, text, text, jsonb, text, text, text, text, numeric, integer) from public;
grant execute on function public.import_market_candles(text, text, text, text, jsonb, text, text, text, text, numeric, integer) to anon, authenticated;

-- The key row itself is intentionally NOT in this migration: insert your own.
--   insert into bridge.api_keys (name, key_hash)
--   values ('kite-console', extensions.crypt('<your key>', extensions.gen_salt('bf')))
--   on conflict (name) do update set key_hash = excluded.key_hash;
