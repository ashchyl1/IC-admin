-- =============================================================================
-- Paper trading + historical replay: core schema
-- =============================================================================
-- Money, prices, quantities and fees are all `numeric` -- never float -- so the
-- ledger is exact. All timestamps are stored UTC (timestamptz) and rendered in
-- the session's market timezone by the client.
--
-- Deviation from the brief, deliberate: `replay_sessions.current_timestamp` was
-- renamed to `current_simulated_at` because CURRENT_TIMESTAMP is a reserved SQL
-- keyword and would need quoting at every call site.
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------- enums ---
do $$ begin
  create type public.replay_status as enum ('created', 'running', 'paused', 'completed', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_side as enum ('BUY', 'SELL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending', 'filled', 'cancelled', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trade_direction as enum ('LONG', 'SHORT');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- profiles ---
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text,
  timezone         text        not null default 'Asia/Kolkata',
  default_currency text        not null default 'INR',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ------------------------------------------------------------ instruments ---
-- Shared reference data: readable by any authenticated user, never written
-- from the browser (no INSERT/UPDATE/DELETE policy exists for it).
create table if not exists public.instruments (
  id         uuid primary key default gen_random_uuid(),
  symbol     text          not null,
  name       text          not null,
  exchange   text          not null,
  asset_type text          not null default 'EQUITY',
  currency   text          not null default 'INR',
  timezone   text          not null default 'Asia/Kolkata',
  tick_size  numeric(18, 6) not null default 0.05 check (tick_size > 0),
  lot_size   integer       not null default 1 check (lot_size > 0),
  is_active  boolean       not null default true,
  created_at timestamptz   not null default now(),
  constraint instruments_symbol_unique unique (exchange, symbol)
);

-- ---------------------------------------------------------- market_candles ---
create table if not exists public.market_candles (
  id            bigint generated always as identity primary key,
  instrument_id uuid           not null references public.instruments (id) on delete cascade,
  timeframe     text           not null,
  ts            timestamptz    not null,
  open          numeric(18, 6) not null,
  high          numeric(18, 6) not null,
  low           numeric(18, 6) not null,
  close         numeric(18, 6) not null,
  volume        numeric(20, 2) not null default 0 check (volume >= 0),
  created_at    timestamptz    not null default now(),
  constraint market_candles_unique unique (instrument_id, timeframe, ts),
  constraint market_candles_positive check (open > 0 and high > 0 and low > 0 and close > 0),
  constraint market_candles_high_is_max check (high >= open and high >= low and high >= close),
  constraint market_candles_low_is_min check (low <= open and low <= high and low <= close)
);

create index if not exists market_candles_lookup_idx
  on public.market_candles (instrument_id, timeframe, ts);

-- --------------------------------------------------------- replay_sessions ---
create table if not exists public.replay_sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid           not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id        uuid           not null references public.instruments (id),
  timeframe            text           not null,
  name                 text,
  start_ts             timestamptz    not null,
  end_ts               timestamptz    not null,
  -- Simulated clock. current_bar_index is 0-based into the session's ordered
  -- candle window; -1 means nothing has been released yet.
  current_simulated_at timestamptz,
  current_bar_index    integer        not null default -1,
  total_bars           integer        not null default 0,
  warmup_bars          integer        not null default 20 check (warmup_bars >= 0),
  status               public.replay_status not null default 'created',
  speed                smallint       not null default 1 check (speed between 1 and 3),
  starting_capital     numeric(20, 4) not null check (starting_capital > 0),
  cash_balance         numeric(20, 4) not null,
  currency             text           not null default 'INR',
  default_quantity     numeric(20, 4) not null default 1 check (default_quantity > 0),
  -- {"mode":"ticks"|"points"|"bps","value":<numeric>}
  slippage_config      jsonb          not null default '{"mode":"ticks","value":1}'::jsonb,
  -- {"per_order":20,"percent":0.03,"percent_cap":20,"exchange_bps":3.45,
  --  "statutory_bps":0,"min_commission":0,"preset":"custom"}
  fee_config           jsonb          not null default
    '{"per_order":20,"percent":0.03,"percent_cap":20,"exchange_bps":3.45,"statutory_bps":0,"min_commission":0,"preset":"indian-discount"}'::jsonb,
  allow_short          boolean        not null default true,
  allow_reversal       boolean        not null default false,
  market_open          time           not null default '09:15',
  market_close         time           not null default '15:30',
  created_at           timestamptz    not null default now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  constraint replay_sessions_window check (end_ts > start_ts)
);

create index if not exists replay_sessions_user_idx on public.replay_sessions (user_id, created_at desc);

-- ------------------------------------------------------------ paper_orders ---
create table if not exists public.paper_orders (
  id                     uuid primary key default gen_random_uuid(),
  -- Client-supplied idempotency key: a retried or double-clicked submission
  -- collides on this unique constraint instead of creating a second order.
  client_order_id        text           not null,
  session_id             uuid           not null references public.replay_sessions (id) on delete cascade,
  user_id                uuid           not null default auth.uid() references auth.users (id) on delete cascade,
  side                   public.order_side   not null,
  order_type             text           not null default 'MARKET',
  quantity               numeric(20, 4) not null check (quantity > 0),
  status                 public.order_status not null default 'pending',
  submitted_bar_index    integer        not null,
  submitted_at           timestamptz    not null default now(),
  simulated_submitted_at timestamptz,
  reference_price        numeric(18, 6),
  filled_at              timestamptz,
  cancelled_at           timestamptz,
  rejection_reason       text,
  is_close_request       boolean        not null default false,
  constraint paper_orders_idempotent unique (session_id, client_order_id)
);

create index if not exists paper_orders_session_idx on public.paper_orders (session_id, submitted_at desc);
create index if not exists paper_orders_pending_idx on public.paper_orders (session_id) where status = 'pending';

-- ------------------------------------------------------------- paper_fills ---
-- Immutable execution record. The running position/avg-entry/realized figures
-- are denormalised onto each fill so the transaction journal is a plain select
-- and can never drift from the ledger.
create table if not exists public.paper_fills (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid           not null references public.paper_orders (id) on delete cascade,
  session_id      uuid           not null references public.replay_sessions (id) on delete cascade,
  user_id         uuid           not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id   uuid           not null references public.instruments (id),
  side            public.order_side not null,
  quantity        numeric(20, 4) not null check (quantity > 0),
  raw_price       numeric(18, 6) not null check (raw_price > 0),
  slippage_amount numeric(18, 6) not null default 0,
  fill_price      numeric(18, 6) not null check (fill_price > 0),
  fees            numeric(20, 4) not null default 0 check (fees >= 0),
  bar_index       integer        not null,
  simulated_ts    timestamptz    not null,
  realized_pnl    numeric(20, 4) not null default 0,
  position_after  numeric(20, 4) not null,
  avg_entry_after numeric(18, 6) not null,
  cash_after      numeric(20, 4) not null,
  created_at      timestamptz    not null default now()
);

create index if not exists paper_fills_session_idx on public.paper_fills (session_id, bar_index, created_at);

-- --------------------------------------------------------- paper_positions ---
create table if not exists public.paper_positions (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid           not null references public.replay_sessions (id) on delete cascade,
  user_id             uuid           not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id       uuid           not null references public.instruments (id),
  signed_quantity     numeric(20, 4) not null default 0,
  average_entry_price numeric(18, 6) not null default 0,
  realized_pnl        numeric(20, 4) not null default 0,
  total_fees          numeric(20, 4) not null default 0,
  updated_at          timestamptz    not null default now(),
  constraint paper_positions_one_per_session unique (session_id, instrument_id)
);

-- ------------------------------------------------------------ trade_journal ---
-- One row per position cycle (flat -> open -> flat). Opened on the fill that
-- takes the position off zero, closed on the fill that returns it to zero.
create table if not exists public.trade_journal (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid           not null references public.replay_sessions (id) on delete cascade,
  user_id             uuid           not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id       uuid           not null references public.instruments (id),
  trade_number        integer        not null,
  direction           public.trade_direction not null,
  status              text           not null default 'open' check (status in ('open', 'closed')),
  entry_ts            timestamptz    not null,
  exit_ts             timestamptz,
  entry_bar_index     integer        not null,
  exit_bar_index      integer,
  average_entry_price numeric(18, 6) not null,
  average_exit_price  numeric(18, 6),
  quantity            numeric(20, 4) not null default 0,
  gross_pnl           numeric(20, 4) not null default 0,
  fees                numeric(20, 4) not null default 0,
  net_pnl             numeric(20, 4) not null default 0,
  return_percentage   numeric(14, 6),
  holding_bars        integer,
  -- Maximum favourable / adverse excursion, tracked bar by bar while open.
  mfe                 numeric(20, 4) not null default 0,
  mae                 numeric(20, 4) not null default 0,
  -- User annotations. Everything above this line is engine-owned and immutable
  -- from the client; everything below is user-editable.
  strategy            text,
  setup               text,
  tags                text[],
  confidence          smallint check (confidence between 1 and 5),
  mistake_category    text,
  notes               text,
  review              text,
  screenshot_path     text,
  created_at          timestamptz    not null default now(),
  updated_at          timestamptz    not null default now(),
  constraint trade_journal_number_unique unique (session_id, trade_number)
);

create index if not exists trade_journal_session_idx on public.trade_journal (session_id, trade_number);

-- -------------------------------------------------------- equity_snapshots ---
create table if not exists public.equity_snapshots (
  id             bigint generated always as identity primary key,
  session_id     uuid           not null references public.replay_sessions (id) on delete cascade,
  user_id        uuid           not null default auth.uid() references auth.users (id) on delete cascade,
  bar_index      integer        not null,
  simulated_ts   timestamptz    not null,
  cash           numeric(20, 4) not null,
  market_value   numeric(20, 4) not null,
  equity         numeric(20, 4) not null,
  realized_pnl   numeric(20, 4) not null,
  unrealized_pnl numeric(20, 4) not null,
  peak_equity    numeric(20, 4) not null,
  drawdown       numeric(20, 4) not null,
  constraint equity_snapshots_unique unique (session_id, bar_index)
);

create index if not exists equity_snapshots_session_idx on public.equity_snapshots (session_id, bar_index);

-- ------------------------------------------------------- updated_at triggers ---
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trade_journal_touch on public.trade_journal;
create trigger trade_journal_touch before update on public.trade_journal
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------- profile auto-provisioning ---
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
