-- Stores the bookmaker correct-score market grid (top scorelines by implied probability)
-- alongside the existing odds snapshot, to cross-check the LLM's exact-score prediction.
alter table odds_snapshots
  add column if not exists correct_score_odds jsonb;
