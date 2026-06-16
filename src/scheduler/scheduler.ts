import cron from "node-cron";
import { env } from "../config/env.js";
import { syncMatchesAndOdds } from "./syncMatchesJob.js";
import { checkFinishedMatches } from "./resultsJob.js";
import { runDailyAnalysis } from "./dailyAnalysisJob.js";
import { notifyAdmin } from "../bot/telegramService.js";

let nextSyncAt = 0;
let nextResultsCheckAt = 0;

async function syncIfDue(): Promise<void> {
  if (Date.now() < nextSyncAt) return;

  try {
    await syncMatchesAndOdds();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Odds/match sync failed:", message);
    await notifyAdmin(`⚠️ Odds data source failed during poll tick: ${message}`);
    // Leave nextSyncAt unchanged so the next tick retries soon, rather than backing off on failure.
    return;
  }

  nextSyncAt = Date.now() + env.SLOW_SYNC_INTERVAL_MINUTES * 60 * 1000;
  console.log(`Odds sync complete. Next background sync in ${env.SLOW_SYNC_INTERVAL_MINUTES} minute(s).`);
}

async function checkResultsIfDue(): Promise<void> {
  if (Date.now() < nextResultsCheckAt) return;
  nextResultsCheckAt = Date.now() + env.RESULTS_CHECK_INTERVAL_MINUTES * 60 * 1000;

  try {
    await checkFinishedMatches();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Results check failed:", message);
    await notifyAdmin(`⚠️ Post-match results check failed: ${message}`);
  }
}

async function pollTick(): Promise<void> {
  await syncIfDue();
  await checkResultsIfDue();
}

export function startScheduler(): void {
  console.log(`Scheduler starting. Background poll cadence: "${env.POLL_INTERVAL_CRON}".`);
  cron.schedule(env.POLL_INTERVAL_CRON, () => {
    pollTick().catch((err) => console.error("Unhandled error in poll tick:", err));
  });

  console.log(`Daily analysis cadence: "${env.DAILY_ANALYSIS_CRON}" (${env.DAILY_ANALYSIS_TIMEZONE}).`);
  cron.schedule(
    env.DAILY_ANALYSIS_CRON,
    () => {
      runDailyAnalysis().catch((err) => console.error("Unhandled error in daily analysis:", err));
    },
    { timezone: env.DAILY_ANALYSIS_TIMEZONE },
  );

  // Run once immediately on startup so background odds/results data isn't empty while waiting for
  // the first cron tick - but deliberately NOT the daily analysis batch, which should only ever
  // run on its own schedule so a restart doesn't burn an extra Gemini/Tavily batch.
  pollTick().catch((err) => console.error("Unhandled error in initial poll tick:", err));
}
