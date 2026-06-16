import type { MatchWithTeams, OddsSnapshot, Prediction } from "../types/domain.js";
import { getOddsHistory } from "../db/oddsRepo.js";
import { savePrediction } from "../db/predictionsRepo.js";
import { fetchMatchAnalysis } from "../services/tavilyService.js";
import { buildBatchPredictionPrompt, matchLabel, type MatchContext } from "./promptBuilder.js";
import { generateBatchPredictions } from "./geminiClient.js";

export interface AnalysisResult {
  match: MatchWithTeams;
  prediction: Prediction;
  latestOdds: OddsSnapshot;
  /** Bookmaker's own implied probability for the LLM's exact predicted scoreline, if it appears in the correct-score grid. */
  marketScoreProb: number | null;
}

function lookupMarketScoreProb(latestOdds: OddsSnapshot, homeGoals: number, awayGoals: number): number | null {
  const entry = latestOdds.correct_score_odds?.find((e) => e.score === `${homeGoals}-${awayGoals}`);
  return entry?.impliedProb ?? null;
}

/**
 * Runs ONE Gemini call analyzing every given match together (the lever against free-tier daily
 * request caps - N matches cost 1 request instead of N), while still fetching per-match
 * qualitative news separately via Tavily for quality. Matches without odds history yet, or
 * missing from the LLM's response, are skipped gracefully rather than failing the whole batch.
 */
export async function runBatchAnalysisPipeline(matches: MatchWithTeams[]): Promise<AnalysisResult[]> {
  const contexts: MatchContext[] = [];

  for (const match of matches) {
    const oddsHistory = await getOddsHistory(match.id, 24);
    if (oddsHistory.length === 0) {
      console.warn(`Skipping ${matchLabel(match)}: no odds snapshots recorded yet.`);
      continue;
    }
    const articles = await fetchMatchAnalysis(match.home_team.name, match.away_team.name);
    contexts.push({ match, oddsHistory, articles });
  }

  if (contexts.length === 0) return [];

  const prompt = buildBatchPredictionPrompt(contexts);
  const { output, raw } = await generateBatchPredictions(prompt);

  const results: AnalysisResult[] = [];
  for (const ctx of contexts) {
    const label = matchLabel(ctx.match);
    const matched = output.predictions.find((p) => p.match_label === label);
    if (!matched) {
      console.warn(`Gemini batch response did not include a prediction for ${label}.`);
      continue;
    }

    const prediction = await savePrediction({
      match_id: ctx.match.id,
      predicted_outcome: matched.predicted_outcome,
      predicted_home_goals: matched.predicted_home_goals,
      predicted_away_goals: matched.predicted_away_goals,
      confidence_score: matched.confidence_score,
      market_consensus: matched.market_consensus,
      analytical_edge: matched.analytical_edge,
      raw_llm_response: raw,
    });

    const latestOdds = ctx.oddsHistory[ctx.oddsHistory.length - 1];
    const marketScoreProb = lookupMarketScoreProb(latestOdds, matched.predicted_home_goals, matched.predicted_away_goals);

    results.push({ match: ctx.match, prediction, latestOdds, marketScoreProb });
  }

  return results;
}
