-- =============================================================================
-- Nifty weekly: horizon, directional trend, range levels, split note fields
-- =============================================================================
-- Data-preserving. There are live rows by this point, so every change either
-- carries values across or only touches columns proven empty:
--
--   * analysis -> notes            renamed, so the text survives
--   * trend                        remapped Bullish->Up, Bearish->Down,
--                                  Sideways/Neutral->Neutral
--   * target_levels[]              first two entries become target_from/_to,
--                                  then the column goes
--   * invalidation_levels[]        same, into reversal_from/_to -- Reversal
--                                  replaces Invalidation as the "call is off
--                                  past here" marker
--
-- The range pairs are deliberately *directional* (from -> to), not min/max: a
-- reversal band on a long is quoted downward (23,900 -> 23,750). So no
-- low <= high constraint.
-- =============================================================================

-- ------------------------------------------------------------- horizon ------
alter table public.nifty_weekly_recommendations
  add column if not exists horizon text not null default 'Medium Term';

alter table public.nifty_weekly_recommendations
  drop constraint if exists nifty_weekly_horizon_check;
alter table public.nifty_weekly_recommendations
  add constraint nifty_weekly_horizon_check
  check (horizon in ('Short Term', 'Medium Term', 'Long Term'));

-- ------------------------------------------------- explanatory note ---------
alter table public.nifty_weekly_recommendations
  add column if not exists explanatory_note text not null default '';

-- --------------------------------------------------- analysis -> notes ------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nifty_weekly_recommendations'
      and column_name = 'analysis'
  ) then
    alter table public.nifty_weekly_recommendations rename column analysis to notes;
  end if;
end $$;

alter table public.nifty_weekly_recommendations
  add column if not exists notes text not null default '';

-- ------------------------------------------------------ range levels --------
alter table public.nifty_weekly_recommendations
  add column if not exists target_from numeric,
  add column if not exists target_to numeric,
  add column if not exists reversal_from numeric,
  add column if not exists reversal_to numeric;

-- Carry any existing list values into the new pairs before the columns go.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nifty_weekly_recommendations'
      and column_name = 'target_levels'
  ) then
    update public.nifty_weekly_recommendations
       set target_from = coalesce(target_from, (target_levels ->> 0)::numeric),
           target_to   = coalesce(target_to,   (target_levels ->> 1)::numeric)
     where jsonb_array_length(target_levels) > 0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nifty_weekly_recommendations'
      and column_name = 'invalidation_levels'
  ) then
    update public.nifty_weekly_recommendations
       set reversal_from = coalesce(reversal_from, (invalidation_levels ->> 0)::numeric),
           reversal_to   = coalesce(reversal_to,   (invalidation_levels ->> 1)::numeric)
     where jsonb_array_length(invalidation_levels) > 0;
  end if;
end $$;

-- ------------------------------------------------------------- trend --------
-- Drop the old check before rewriting values, or the UPDATE violates it.
alter table public.nifty_weekly_recommendations
  drop constraint if exists nifty_weekly_recommendations_trend_check;

update public.nifty_weekly_recommendations
   set trend = case trend
                 when 'Bullish' then 'Up'
                 when 'Bearish' then 'Down'
                 else 'Neutral'
               end
 where trend not in ('Up', 'Down', 'Neutral');

alter table public.nifty_weekly_recommendations
  alter column trend set default 'Neutral';

alter table public.nifty_weekly_recommendations
  drop constraint if exists nifty_weekly_trend_check;
alter table public.nifty_weekly_recommendations
  add constraint nifty_weekly_trend_check
  check (trend in ('Up', 'Down', 'Neutral'));

-- ------------------------------------------------- retire the old lists -----
-- The array check spans four columns, so dropping two of them would take the
-- constraint with it. Drop it explicitly and re-add over what remains.
alter table public.nifty_weekly_recommendations
  drop constraint if exists nifty_weekly_levels_are_number_arrays;

alter table public.nifty_weekly_recommendations
  drop column if exists target_levels,
  drop column if exists invalidation_levels;

alter table public.nifty_weekly_recommendations
  add constraint nifty_weekly_levels_are_number_arrays check (
    jsonb_typeof(support_levels) = 'array'
    and jsonb_typeof(resistance_levels) = 'array'
  );
