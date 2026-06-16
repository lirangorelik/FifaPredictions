-- Stores the actual final score once a match completes, so predictions can be checked
-- against reality and accuracy stats derived on demand.
alter table matches
  add column if not exists actual_home_goals integer,
  add column if not exists actual_away_goals integer,
  add column if not exists finished_at timestamptz;
