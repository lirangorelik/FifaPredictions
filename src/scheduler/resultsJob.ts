import { env } from "../config/env.js";
import { fetchScores, parseFinalScore } from "../services/oddsApiService.js";
import { findMatchesAwaitingResult, recordMatchResult, getMatchWithTeams, markStaleMatchesAbandoned } from "../db/matchesRepo.js";
import { getLatestPrediction } from "../db/predictionsRepo.js";
import { formatResultMessage } from "../bot/formatResultAlert.js";
import { sendTelegramMessage, notifyAdmin } from "../bot/telegramService.js";

/**
 * Finds matches whose kickoff has passed but are still marked "scheduled", checks The Odds API's
 * scores endpoint for a final result, and - for any now-completed match - records the actual
 * score and sends a follow-up "did we call it" Telegram message comparing prediction vs reality.
 */
export async function checkFinishedMatches(): Promise<void> {
  const awaiting = await findMatchesAwaitingResult();
  if (awaiting.length === 0) return;

  let scores;
  try {
    scores = await fetchScores();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch match scores:", message);
    await notifyAdmin(`⚠️ Failed to fetch match results: ${message}`);
    return;
  }

  const scoresByExternalId = new Map(scores.map((s) => [s.id, s]));

  for (const match of awaiting) {
    if (!match.external_id) continue;
    const scoreEntry = scoresByExternalId.get(match.external_id);
    if (!scoreEntry) continue;
    const final = parseFinalScore(scoreEntry);
    if (!final) continue;

    try {
      await recordMatchResult(match.id, final.homeGoals, final.awayGoals);
      const matchWithTeams = await getMatchWithTeams(match.id);
      if (!matchWithTeams) continue;

      const prediction = await getLatestPrediction(match.id);
      const message = formatResultMessage(matchWithTeams, prediction, final.homeGoals, final.awayGoals);
      await sendTelegramMessage(env.TELEGRAM_CHAT_ID, message, "MarkdownV2");
      console.log(`Result alert sent for ${matchWithTeams.home_team.name} vs ${matchWithTeams.away_team.name}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to process result for match ${match.id}:`, message);
      await notifyAdmin(`⚠️ Failed to send result alert for match ${match.id}: ${message}`);
    }
  }

  // Give up on matches that have been waiting too long for a result the scores endpoint will
  // never return (it only looks back ~3 days). This is a DB-only operation - no extra API calls.
  try {
    const abandoned = await markStaleMatchesAbandoned();
    for (const m of abandoned) {
      console.warn(`Marked stale match abandoned: ${m.home_team.name} vs ${m.away_team.name} (kickoff ${m.kickoff_time}).`);
      await notifyAdmin(`ℹ️ No result ever found for ${m.home_team.name} vs ${m.away_team.name} — marked abandoned.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to mark stale matches abandoned:", message);
  }
}
