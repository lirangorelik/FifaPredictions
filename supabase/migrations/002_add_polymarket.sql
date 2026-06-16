-- Adds Polymarket prediction-market probabilities alongside traditional bookmaker odds.
alter table odds_snapshots
  add column if not exists polymarket_home_prob numeric,
  add column if not exists polymarket_draw_prob numeric,
  add column if not exists polymarket_away_prob numeric,
  add column if not exists polymarket_event_url text;
