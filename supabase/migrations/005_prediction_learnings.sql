-- Stores Gemini-generated lessons from finished matches, one per prediction.
-- The learning job reads all finished matches without a row here (LEFT JOIN IS NULL)
-- so it covers both the initial backfill and incremental daily runs.
create table if not exists prediction_learnings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  prediction_id uuid not null references predictions(id) on delete cascade,
  error_type text not null check (error_type in (
    'EXACT_SCORE',
    'CORRECT_OUTCOME_CLOSE',
    'CORRECT_OUTCOME_OFF',
    'WRONG_OUTCOME',
    'RIGHT_BUT_UNLUCKY'
  )),
  lesson text not null,
  created_at timestamptz not null default now(),
  unique (prediction_id)  -- one learning per prediction; safe to re-run job
);

create index if not exists idx_prediction_learnings_created_at on prediction_learnings (created_at asc);
