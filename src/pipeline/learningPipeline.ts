import { matchLabel } from "./promptBuilder.js";
import { generateLearnings } from "./geminiClient.js";
import { getUnlearnedFinishedMatches, getTeamRecentForm, saveLearning, type UnlearnedMatch } from "../db/learningsRepo.js";

function pct(v: number | null): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function formatFormLine(home: string, away: string, hg: number, ag: number): string {
  const result = hg > ag ? "W" : hg < ag ? "L" : "D";
  return `  ${home} ${hg}-${ag} ${away} (${result})`;
}

async function buildMatchLearningBlock(m: UnlearnedMatch): Promise<string> {
  const label = `${m.home_team_name} vs ${m.away_team_name}`;
  const homeForm = await getTeamRecentForm(m.home_team_name, m.match_id);
  const awayForm = await getTeamRecentForm(m.away_team_name, m.match_id);

  const homeFormBlock =
    homeForm.length > 0
      ? homeForm.map((f) => formatFormLine(f.home_team_name, f.away_team_name, f.actual_home_goals, f.actual_away_goals)).join("\n")
      : "  No prior tournament matches recorded.";

  const awayFormBlock =
    awayForm.length > 0
      ? awayForm.map((f) => formatFormLine(f.home_team_name, f.away_team_name, f.actual_home_goals, f.actual_away_goals)).join("\n")
      : "  No prior tournament matches recorded.";

  return `=== MATCH: ${label} ===
KICKOFF: ${m.kickoff_time}

PREDICTED: ${m.home_team_name} ${m.predicted_home_goals} - ${m.predicted_away_goals} ${m.away_team_name} (confidence ${m.confidence_score}/10, outcome: ${m.predicted_outcome})
ACTUAL:    ${m.home_team_name} ${m.actual_home_goals} - ${m.actual_away_goals} ${m.away_team_name}

MARKET AT PREDICTION TIME:
  - Implied probabilities: Home ${pct(m.home_implied_prob)} | Draw ${pct(m.draw_implied_prob)} | Away ${pct(m.away_implied_prob)}
  - Totals line: ${m.totals_point ?? "n/a"} goals
  - Market consensus stated: "${m.market_consensus}"
  - Analytical edge stated: "${m.analytical_edge}"

${m.home_team_name.toUpperCase()} RECENT FORM (this tournament, most recent first):
${homeFormBlock}

${m.away_team_name.toUpperCase()} RECENT FORM (this tournament, most recent first):
${awayFormBlock}`;
}

function buildLearningPrompt(blocks: string[]): string {
  return `You are a football prediction analyst reviewing your own past predictions for the 2026 FIFA World Cup. For each match below, evaluate whether the prediction was correct, incorrect, or analytically sound but unlucky.

For WRONG predictions: identify what signals were misread, over-weighted, or ignored. Be specific.
For CORRECT predictions: explain what worked and why it should be repeated.
For RIGHT_BUT_UNLUCKY: explain why the analysis was sound despite the result (e.g., late own goal, penalty miss, red card changed the game).

Return one honest, concise, actionable lesson per match. These lessons will be fed back into future predictions, so make them specific and generalisable — not just "we were wrong" but "when X happens, expect Y."

${blocks.join("\n\n")}`;
}

/** Processes all finished matches without a learning yet, in one Gemini call. Returns count of new lessons saved. */
export async function runLearningPipeline(): Promise<number> {
  const unlearned = await getUnlearnedFinishedMatches();
  if (unlearned.length === 0) {
    console.log("Learning: no new finished matches to analyze.");
    return 0;
  }

  console.log(`Learning: analyzing ${unlearned.length} finished match(es)...`);

  const blocks: string[] = [];
  for (const m of unlearned) {
    blocks.push(await buildMatchLearningBlock(m));
  }

  const prompt = buildLearningPrompt(blocks);
  const { output } = await generateLearnings(prompt);

  // Build a lookup by match label so we can match Gemini's response back to the right prediction
  const byLabel = new Map(
    unlearned.map((m) => [`${m.home_team_name} vs ${m.away_team_name}`, m]),
  );

  let saved = 0;
  for (const learning of output.learnings) {
    const match = byLabel.get(learning.match_label);
    if (!match) {
      console.warn(`Learning: Gemini returned label "${learning.match_label}" that doesn't match any unlearned match — skipping.`);
      continue;
    }
    await saveLearning({
      match_id: match.match_id,
      prediction_id: match.prediction_id,
      error_type: learning.error_type,
      lesson: learning.lesson,
    });
    console.log(`  [${learning.error_type}] ${learning.match_label}: ${learning.lesson.slice(0, 80)}...`);
    saved++;
  }

  return saved;
}
