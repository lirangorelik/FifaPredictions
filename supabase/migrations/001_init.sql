-- 2026 FIFA World Cup Prediction Platform - initial schema
create extension if not exists pgcrypto;

create table if not exists teams (
  id serial primary key,
  name text not null unique,
  fifa_code text
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  external_id text unique, -- The Odds API event id
  home_team_id integer not null references teams(id),
  away_team_id integer not null references teams(id),
  kickoff_time timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_matches_kickoff_time on matches (kickoff_time);

create table if not exists odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  bookmaker text,
  captured_at timestamptz not null default now(),

  home_moneyline_odds numeric,
  draw_moneyline_odds numeric,
  away_moneyline_odds numeric,
  home_implied_prob numeric,
  draw_implied_prob numeric,
  away_implied_prob numeric,

  totals_point numeric,
  over_odds numeric,
  under_odds numeric,

  btts_yes_odds numeric,
  btts_no_odds numeric,

  raw jsonb
);

create index if not exists idx_odds_snapshots_match_id on odds_snapshots (match_id, captured_at desc);

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  predicted_outcome text not null check (predicted_outcome in ('HOME_WIN', 'AWAY_WIN', 'DRAW')),
  predicted_home_goals integer not null check (predicted_home_goals >= 0),
  predicted_away_goals integer not null check (predicted_away_goals >= 0),
  confidence_score integer not null check (confidence_score between 1 and 10),
  market_consensus text not null,
  analytical_edge text not null,
  raw_llm_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_predictions_match_id on predictions (match_id, created_at desc);

create table if not exists alerts_log (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  prediction_id uuid references predictions(id),
  status text not null check (status in ('sent', 'failed')),
  error_message text,
  sent_at timestamptz not null default now(),
  unique (match_id)
);
