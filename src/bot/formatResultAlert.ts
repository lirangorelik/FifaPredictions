import type { MatchWithTeams, Prediction, PredictedOutcome } from "../types/domain.js";

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (match) => `\\${match}`);
}

/**
 * Plain-text composed then escaped as a whole (rather than per-field) - simpler and safe here
 * since this message has no bold/markup styling to preserve.
 */
export function formatResultMessage(match: MatchWithTeams, prediction: Prediction | null, actualHomeGoals: number, actualAwayGoals: number): string {
  const lines = [`🏁 FINAL: ${match.home_team.name} ${actualHomeGoals} - ${actualAwayGoals} ${match.away_team.name}`];

  if (!prediction) {
    lines.push("No prediction was recorded for this match.");
  } else {
    const predictedScoreText = `${prediction.predicted_home_goals}-${prediction.predicted_away_goals}`;
    const exactMatch = prediction.predicted_home_goals === actualHomeGoals && prediction.predicted_away_goals === actualAwayGoals;
    const actualOutcome: PredictedOutcome =
      actualHomeGoals > actualAwayGoals ? "HOME_WIN" : actualHomeGoals < actualAwayGoals ? "AWAY_WIN" : "DRAW";
    const correctOutcome = prediction.predicted_outcome === actualOutcome;

    if (exactMatch) {
      lines.push(`✅ Nailed the exact score! (predicted ${predictedScoreText}, confidence ${prediction.confidence_score}/10)`);
    } else if (correctOutcome) {
      lines.push(`🟡 Called the winner, missed the scoreline (predicted ${predictedScoreText})`);
    } else {
      lines.push(`❌ Missed it (predicted ${predictedScoreText})`);
    }
  }

  return escapeMarkdownV2(lines.join("\n"));
}
