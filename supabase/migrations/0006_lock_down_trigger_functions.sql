-- =============================================================================
-- Advisor remediation: trigger functions must not be reachable over the API
-- =============================================================================
-- Supabase grants EXECUTE on public-schema functions to `anon` and
-- `authenticated` by default, so `revoke ... from public` in 0001 did not
-- actually stop `/rest/v1/rpc/handle_new_user` being callable. Caught by
-- `get_advisors(security)` lints 0028 and 0029.
--
-- The nine paper-trading RPCs remain callable by `authenticated` on purpose:
-- they are the application's only write path, and each one verifies
-- auth.uid() ownership before touching a row.
-- =============================================================================

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.guard_trade_journal_columns() from public, anon, authenticated;
