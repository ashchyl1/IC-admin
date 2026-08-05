-- =============================================================================
-- Nifty weekly recommendations: let the page read, keep writes privileged
-- =============================================================================
-- 0008 left the table with RLS on and no policies, which meant every read had
-- to go through a service-role route handler. That makes the feed unusable
-- until SUPABASE_SERVICE_ROLE_KEY is populated, which is a poor default for a
-- page whose whole job is to display the calls.
--
-- The content is published market commentary, not a secret, and the chart
-- images already sit in a public bucket -- so a read-only grant matches what
-- is already exposed. Writes stay closed: no insert/update/delete policy
-- exists, so INSERT and DELETE only succeed for the service role (which
-- bypasses RLS) via /api/nifty-weekly.
-- =============================================================================

grant select on table public.nifty_weekly_recommendations to anon, authenticated;

drop policy if exists nifty_weekly_read_all on public.nifty_weekly_recommendations;
create policy nifty_weekly_read_all
  on public.nifty_weekly_recommendations
  for select
  to anon, authenticated
  using (true);
