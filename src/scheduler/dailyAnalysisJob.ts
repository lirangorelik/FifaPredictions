import { env } from "../config/env.js";
import type { MatchWithTeams } from "../types/domain.js";
import { findMatchesWithinHours } from "../db/matchesRepo.js";
import { getLatestPrediction } from "../db/predictionsRepo.js";
import { runBatchAnalysisPipeline } from "../pipeline/analysisPipeline.js";
import { formatBatchMessages } from "../bot/formatDailyAnalysis.js";
import { sendTelegramMessage, notifyAdmin } from "../bot/telegramService.js";
import { syncMatchesAndOdds } from "./syncMatchesJob.js";

function isRecent(isoDate: string, hours: number): boolean {
  return Date.now() - new Date(isoDate).getTime() < hours * 60 * 60 * 1000;
}

/**
 * Runs once daily (DAILY_ANALYSIS_CRON, default 5PM Asia/Jerusalem): syncs fresh odds, analyzes
 * every match in the next 24h in a single Gemini call, and sends one consolidated Telegram
 * message. Matches already analyzed recently (BATCH_DEDUPE_HOURS) are skipped as a safety net
 * against duplicate sends if the job is retried or the process restarts.
 */
export async function runDailyAnalysis(): Promise<void> {
  try {
    await syncMatchesAndOdds();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Odds sync before daily analysis failed, continuing with existing data:", message);
    await notifyAdmin(`⚠️ Odds sync failed before daily analysis: ${message}`);
  }

  const upcoming = await findMatchesWithinHours(24);
  const toAnalyze: MatchWithTeams[] = [];
  for (const match of upcoming) {
    const latest = await getLatestPrediction(match.id);
    if (latest && isRecent(latest.created_at, env.BATCH_DEDUPE_HOURS)) {
      console.log(`Skipping ${match.home_team.name} vs ${match.away_team.name}: already analyzed recently.`);
      continue;
    }
    toAnalyze.push(match);
  }

  if (toAnalyze.length === 0) {
    console.log("Daily analysis: nothing new to analyze.");
    return;
  }

  let results;
  try {
    results = await runBatchAnalysisPipeline(toAnalyze);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Batch analysis failed:", message);
    await notifyAdmin(`⚠️ Daily analysis batch failed: ${message}`);
    throw err;
  }

  if (results.length === 0) {
    console.log("Daily analysis: no predictions produced (no odds data yet, or all skipped).");
    return;
  }

  const messages = formatBatchMessages(results);
  for (const message of messages) {
    try {
      await sendTelegramMessage(env.TELEGRAM_CHAT_ID, message, "MarkdownV2");
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to send daily analysis message:", errMessage);
      await notifyAdmin(`⚠️ Failed to send daily analysis message: ${errMessage}`);
    }
  }
  console.log(`Daily analysis sent for ${results.length} match(es) in ${messages.length} message(s).`);
}
