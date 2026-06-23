-- Adds an 'abandoned' terminal status for matches whose final result never arrived.
-- The Odds API scores endpoint only covers the last ~3 days, so a fixture that isn't
-- resolved in that window (e.g. external_id mismatch, missed cron runs) would otherwise
-- stay 'scheduled' forever - re-queried on every results check and never reaching the
-- learning pipeline. Marking it 'abandoned' takes it out of the "awaiting result" scan.
alter table matches drop constraint if exists matches_status_check;
alter table matches add constraint matches_status_check
  check (status in ('scheduled', 'live', 'finished', 'cancelled', 'abandoned'));
