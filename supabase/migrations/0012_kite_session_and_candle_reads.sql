-- =============================================================================
-- Kite Connect sessions, and a read path for cached candles
-- =============================================================================
-- Two additions, both following the pattern 0007 established: a narrow,
-- bridge-key-gated function rather than handing a server process the
-- service-role key, which can read and write everything in the project
-- including auth.
--
--   1. bridge.kite_sessions -- the access token from a Kite Connect login.
--      Zerodha issues one per day per api_key, so the app needs somewhere to
--      keep it that survives a restart and is shared across instances.
--
--   2. public.read_market_candles -- `market_candles` grants select to
--      `authenticated` only, and the chart's data route serves requests that
--      have no Supabase user session. Rather than widen the table's grants to
--      anon, reading goes through the same gate the writes already use.
--
-- The access token is a credential: it can place orders on the account it
-- belongs to. It therefore lives in the non-exposed `bridge` schema, is never
-- selectable by anon or authenticated, and comes back only from a function
-- that has already checked the bridge key.
-- =============================================================================

-- ------------------------------------------------------------- kite session ---

create table if not exists bridge.kite_sessions (
  api_key       text primary key,
  user_id       text,
  user_name     text,
  access_token  text        not null,
  public_token  text,
  -- Kite tokens die at the next pre-open (about 06:00 IST); stored so the app
  -- can say "expired, sign in again" instead of failing with a bare 403.
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table bridge.kite_sessions enable row level security;
revoke all on table bridge.kite_sessions from public, anon, authenticated;

create or replace function public.save_kite_session(
  p_key          text,
  p_api_key      text,
  p_access_token text,
  p_user_id      text        default null,
  p_user_name    text        default null,
  p_public_token text        default null,
  p_expires_at   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key_row  bridge.api_keys;
  v_expires  timestamptz;
begin
  select * into v_key_row from bridge.api_keys where name = 'kite-console';
  if not found or v_key_row.key_hash <> extensions.crypt(coalesce(p_key, ''), v_key_row.key_hash) then
    raise exception 'Invalid bridge key' using errcode = '42501';
  end if;

  if coalesce(p_api_key, '') = '' or coalesce(p_access_token, '') = '' then
    raise exception 'api_key and access_token are required';
  end if;

  -- Default to the next 06:00 IST, which is when Zerodha invalidates tokens.
  v_expires := coalesce(
    p_expires_at,
    (date_trunc('day', (now() at time zone 'Asia/Kolkata') + interval '1 day')
      + interval '6 hours') at time zone 'Asia/Kolkata'
  );

  insert into bridge.kite_sessions (api_key, user_id, user_name, access_token, public_token, expires_at)
  values (p_api_key, p_user_id, p_user_name, p_access_token, p_public_token, v_expires)
  on conflict (api_key) do update
    set access_token = excluded.access_token,
        public_token = excluded.public_token,
        user_id      = coalesce(excluded.user_id, bridge.kite_sessions.user_id),
        user_name    = coalesce(excluded.user_name, bridge.kite_sessions.user_name),
        expires_at   = excluded.expires_at,
        updated_at   = now();

  update bridge.api_keys
     set last_used_at = now(), call_count = call_count + 1
   where name = 'kite-console';

  return jsonb_build_object('apiKey', p_api_key, 'expiresAt', v_expires);
end;
$fn$;

create or replace function public.read_kite_session(p_key text, p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key_row bridge.api_keys;
  v_session bridge.kite_sessions;
begin
  select * into v_key_row from bridge.api_keys where name = 'kite-console';
  if not found or v_key_row.key_hash <> extensions.crypt(coalesce(p_key, ''), v_key_row.key_hash) then
    raise exception 'Invalid bridge key' using errcode = '42501';
  end if;

  select * into v_session from bridge.kite_sessions where api_key = p_api_key;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'apiKey', v_session.api_key,
    'userId', v_session.user_id,
    'userName', v_session.user_name,
    'accessToken', v_session.access_token,
    'expiresAt', v_session.expires_at,
    'expired', v_session.expires_at <= now()
  );
end;
$fn$;

create or replace function public.clear_kite_session(p_key text, p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key_row bridge.api_keys;
  v_deleted integer;
begin
  select * into v_key_row from bridge.api_keys where name = 'kite-console';
  if not found or v_key_row.key_hash <> extensions.crypt(coalesce(p_key, ''), v_key_row.key_hash) then
    raise exception 'Invalid bridge key' using errcode = '42501';
  end if;

  delete from bridge.kite_sessions where api_key = p_api_key;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('cleared', v_deleted);
end;
$fn$;

-- ------------------------------------------------------------- candle reads ---

create or replace function public.read_market_candles(
  p_key       text,
  p_exchange  text,
  p_symbol    text,
  p_timeframe text,
  p_from      timestamptz default null,
  p_to        timestamptz default null,
  p_limit     integer     default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key_row    bridge.api_keys;
  v_instrument uuid;
  v_rows       jsonb;
begin
  select * into v_key_row from bridge.api_keys where name = 'kite-console';
  if not found or v_key_row.key_hash <> extensions.crypt(coalesce(p_key, ''), v_key_row.key_hash) then
    raise exception 'Invalid bridge key' using errcode = '42501';
  end if;

  select id into v_instrument from public.instruments
   where exchange = upper(trim(p_exchange)) and symbol = upper(trim(p_symbol));

  if v_instrument is null then
    return jsonb_build_object('found', false, 'candles', '[]'::jsonb);
  end if;

  -- Newest-first with a cap, then flipped back to chronological order: a chart
  -- that asks for "the last N bars" of a long history should get the recent
  -- end, not the beginning.
  select coalesce(jsonb_agg(row order by ts), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'ts', ts, 'open', open, 'high', high,
             'low', low, 'close', close, 'volume', volume
           ) as row,
           ts
      from public.market_candles
     where instrument_id = v_instrument
       and timeframe = p_timeframe
       and (p_from is null or ts >= p_from)
       and (p_to   is null or ts <= p_to)
     order by ts desc
     limit greatest(1, least(coalesce(p_limit, 5000), 20000))
  ) recent;

  return jsonb_build_object(
    'found', true,
    'instrumentId', v_instrument,
    'timeframe', p_timeframe,
    'candles', v_rows
  );
end;
$fn$;

-- --------------------------------------------------------------- privileges ---

revoke all on function public.save_kite_session(text, text, text, text, text, text, timestamptz) from public;
revoke all on function public.read_kite_session(text, text) from public;
revoke all on function public.clear_kite_session(text, text) from public;
revoke all on function public.read_market_candles(text, text, text, text, timestamptz, timestamptz, integer) from public;

grant execute on function public.save_kite_session(text, text, text, text, text, text, timestamptz) to anon, authenticated;
grant execute on function public.read_kite_session(text, text) to anon, authenticated;
grant execute on function public.clear_kite_session(text, text) to anon, authenticated;
grant execute on function public.read_market_candles(text, text, text, text, timestamptz, timestamptz, integer) to anon, authenticated;
