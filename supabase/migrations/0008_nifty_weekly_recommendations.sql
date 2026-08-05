-- =============================================================================
-- Nifty weekly recommendations: flashcard feed (chart image + structured call)
-- =============================================================================
-- Shape follows public.banknifty_recommendations, trimmed to the fields the
-- weekly card actually renders. Levels are jsonb arrays of plain numbers --
-- the add form offers a repeatable row per level, so ordering is the author's
-- (S1, S2, ... / T1, T2, ...) and is preserved as stored.
--
-- Access model: RLS is on with NO policies, so neither `anon` nor
-- `authenticated` can reach this table over PostgREST. The admin UI is
-- ungated (same as the existing recommendations admin), so every read and
-- write goes through a Next.js route handler using the service-role client.
-- That keeps the table unreachable from the public internet.
-- =============================================================================

create table if not exists public.nifty_weekly_recommendations (
  id                  bigint generated always as identity primary key,

  symbol              text not null default 'NIFTY',
  timeframe           text not null default '1W',

  -- "date of recommendation": the week the call was published for.
  week_ending         date not null,

  -- Storage object path inside the `nifty-charts` bucket, plus the resolved
  -- public URL. The URL is denormalised so the feed renders without a second
  -- round trip; the path is what a delete needs.
  chart_image_path    text,
  chart_image_url     text,

  trend               text not null default 'Neutral'
    check (trend in ('Bullish', 'Bearish', 'Sideways', 'Neutral')),
  bias                text not null default 'HOLD'
    check (bias in ('BUY', 'SELL', 'HOLD', 'AVOID')),
  setup_status        text not null default 'Watching'
    check (setup_status in ('Watching', 'Forming', 'Confirmed', 'Triggered', 'Invalidated', 'Completed')),

  spot_price          numeric,
  change_points       numeric,
  change_percent      numeric,

  support_levels      jsonb not null default '[]'::jsonb,
  resistance_levels   jsonb not null default '[]'::jsonb,
  target_levels       jsonb not null default '[]'::jsonb,
  invalidation_levels jsonb not null default '[]'::jsonb,

  analysis            text not null default '',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Guard against a malformed write putting an object or string where the UI
  -- expects a number to format.
  constraint nifty_weekly_levels_are_number_arrays check (
    jsonb_typeof(support_levels) = 'array'
    and jsonb_typeof(resistance_levels) = 'array'
    and jsonb_typeof(target_levels) = 'array'
    and jsonb_typeof(invalidation_levels) = 'array'
  )
);

-- The feed is always "newest week first"; the id tiebreaks two calls filed for
-- the same week (a correction, or a second chart).
create index if not exists nifty_weekly_recommendations_week_idx
  on public.nifty_weekly_recommendations (week_ending desc, id desc);

drop trigger if exists trg_nifty_weekly_touch on public.nifty_weekly_recommendations;
create trigger trg_nifty_weekly_touch
  before update on public.nifty_weekly_recommendations
  for each row execute function public.touch_updated_at();

alter table public.nifty_weekly_recommendations enable row level security;

-- No policies on purpose -- see the access-model note above. Revoke the
-- default grants too, so the table never appears in the PostgREST schema for
-- an anonymous caller.
revoke all on table public.nifty_weekly_recommendations from anon, authenticated;

-- ----------------------------------------------------------- chart storage ---
-- Public read so <img src> resolves without a signed URL; uploads and deletes
-- happen with the service-role key, which bypasses storage RLS. No policies
-- are granted to anon/authenticated, so the bucket is read-only to the world.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nifty-charts',
  'nifty-charts',
  true,
  8388608, -- 8 MB, matching the existing /api/upload ceiling
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
