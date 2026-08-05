-- =============================================================================
-- Nifty weekly: the recommendation itself, in prose
-- =============================================================================
-- Sits between the one-line explanatory note and the free-form notes box:
--
--   explanatory_note     1-2 lines, the gist, shown high on the card
--   recommendation_text  the actual call ("buy dips into 24,150, target 25,400")
--   notes                everything else worth remembering
--
-- Separate from explanatory_note because the gist and the instruction are
-- different things and get read at different moments.
-- =============================================================================

alter table public.nifty_weekly_recommendations
  add column if not exists recommendation_text text not null default '';
