import type { MatchWithTeams, OddsSnapshot, PredictionLearning } from "../types/domain.js";
import type { ArticleSummary } from "../services/tavilyService.js";
import type { PoissonModel } from "./poissonModel.js";
import type { TeamFormMatch } from "../db/learningsRepo.js";

export interface MatchContext {
  match: MatchWithTeams;
  oddsHistory: OddsSnapshot[];
  articles: ArticleSummary[];
  model: PoissonModel | null;
  homeForm: TeamFormMatch[];
  awayForm: TeamFormMatch[];
}

function pct(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function matchLabel(match: MatchWithTeams): string {
  return `${match.home_team.name} vs ${match.away_team.name}`;
}

function describeLineMovement(history: OddsSnapshot[]): string {
  if (history.length < 2) return "Insufficient history to detect line movement (only one snapshot recorded).";

  const first = history[0];
  const last = history[history.length - 1];
  const lines: string[] = [];

  if (first.home_implied_prob != null && last.home_implied_prob != null) {
    const delta = last.home_implied_prob - first.home_implied_prob;
    lines.push(`Home win implied probability moved from ${pct(first.home_implied_prob)} to ${pct(last.home_implied_prob)} (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp).`);
  }
  if (first.away_implied_prob != null && last.away_implied_prob != null) {
    const delta = last.away_implied_prob - first.away_implied_prob;
    lines.push(`Away win implied probability moved from ${pct(first.away_implied_prob)} to ${pct(last.away_implied_prob)} (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp).`);
  }
  if (first.totals_point != null && last.totals_point != null) {
    lines.push(`Goal total line moved from ${first.totals_point} to ${last.totals_point}.`);
  }
  if (first.polymarket_home_prob != null && last.polymarket_home_prob != null) {
    const delta = last.polymarket_home_prob - first.polymarket_home_prob;
    lines.push(`Polymarket home-win probability moved from ${pct(first.polymarket_home_prob)} to ${pct(last.polymarket_home_prob)} (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp).`);
  }

  return lines.length > 0 ? lines.join(" ") : "No material line movement detected.";
}

function describePolymarket(latest: OddsSnapshot | undefined): string {
  if (!latest || latest.polymarket_home_prob == null || latest.polymarket_draw_prob == null || latest.polymarket_away_prob == null) {
    return "No Polymarket market found for this fixture.";
  }
  const link = latest.polymarket_event_url ? ` (${latest.polymarket_event_url})` : "";
  return `Home ${pct(latest.polymarket_home_prob)} | Draw ${pct(latest.polymarket_draw_prob)} | Away ${pct(latest.polymarket_away_prob)}${link}`;
}

function describeCorrectScoreMarket(latest: OddsSnapshot | undefined): string {
  if (!latest?.correct_score_odds || latest.correct_score_odds.length === 0) {
    return "No correct-score market found for this fixture.";
  }
  return latest.correct_score_odds
    .slice(0, 5)
    .map((entry) => `${entry.score} (${pct(entry.impliedProb)}, @${entry.price.toFixed(2)})`)
    .join(", ");
}

function describeModel(model: PoissonModel | null, match: MatchWithTeams): string {
  if (!model) return "No quantitative model available (market totals/odds missing for this fixture).";
  const { home_team, away_team } = match;
  const top = model.topScores.map((s) => `${s.home}-${s.away} (${pct(s.prob)})`).join(", ");
  const best = model.bestPointsScore;
  return [
    `Expected goals: ${home_team.name} ${model.lambdaHome.toFixed(2)} / ${away_team.name} ${model.lambdaAway.toFixed(2)}.`,
    `Model outcome probabilities: Home ${pct(model.outcomeProbs.home)} | Draw ${pct(model.outcomeProbs.draw)} | Away ${pct(model.outcomeProbs.away)}.`,
    `Most likely exact scorelines: ${top}.`,
    `EXPECTED-POINTS-OPTIMAL PICK for this game's scoring: ${best.home}-${best.away}. Use this as your default scoreline.`,
  ].join("\n");
}

function describeForm(form: TeamFormMatch[], teamName: string): string {
  if (form.length === 0) return `${teamName}: no prior tournament matches recorded.`;
  const lines = form.map((f) => {
    const result = f.actual_home_goals > f.actual_away_goals ? "W" : f.actual_home_goals < f.actual_away_goals ? "L" : "D";
    const perspective = f.home_team_name === teamName ? result : result === "W" ? "L" : result === "L" ? "W" : "D";
    return `${f.home_team_name} ${f.actual_home_goals}-${f.actual_away_goals} ${f.away_team_name} (${perspective})`;
  });
  return `${teamName} (most recent first): ${lines.join("; ")}`;
}

function buildMatchSection(ctx: MatchContext, index: number): string {
  const { match, oddsHistory, articles, model, homeForm, awayForm } = ctx;
  const latest = oddsHistory[oddsHistory.length - 1];

  const articlesBlock = articles.length
    ? articles.map((a, i) => `${i + 1}. "${a.title}" (${a.url})\n   ${a.snippet}`).join("\n")
    : "No qualitative articles were found for this fixture.";

  return `=== MATCH ${index + 1}: ${matchLabel(match)} ===
KICKOFF: ${match.kickoff_time}

CURRENT MARKET ODDS (consensus average across bookmakers, decimal odds):
- Moneyline: Home ${latest?.home_moneyline_odds ?? "n/a"} | Draw ${latest?.draw_moneyline_odds ?? "n/a"} | Away ${latest?.away_moneyline_odds ?? "n/a"}
- Implied probabilities (vig-removed): Home ${pct(latest?.home_implied_prob ?? null)} | Draw ${pct(latest?.draw_implied_prob ?? null)} | Away ${pct(latest?.away_implied_prob ?? null)}
- Totals line: ${latest?.totals_point ?? "n/a"} goals (Over ${latest?.over_odds ?? "n/a"} / Under ${latest?.under_odds ?? "n/a"})
- Both Teams To Score: Yes ${latest?.btts_yes_odds ?? "n/a"} / No ${latest?.btts_no_odds ?? "n/a"}

PREDICTION MARKET SENTIMENT (Polymarket, peer-to-peer, prices are direct probabilities): ${describePolymarket(latest)}

BOOKMAKER'S OWN TOP SCORELINES (correct-score market, vig-removed implied probability, most likely first): ${describeCorrectScoreMarket(latest)}

LINE MOVEMENT (last 24h, ${oddsHistory.length} snapshot(s) recorded): ${describeLineMovement(oddsHistory)}

QUANTITATIVE MODEL (Poisson, derived from the market's goal-total line and win probabilities):
${describeModel(model, match)}

RECENT FORM (this tournament):
- ${describeForm(homeForm, match.home_team.name)}
- ${describeForm(awayForm, match.away_team.name)}

QUALITATIVE ANALYSIS (top articles/news found today):
${articlesBlock}`;
}

function buildLearningsBlock(learnings: PredictionLearning[]): string {
  if (learnings.length === 0) return "";
  const lines = learnings.map((l) => {
    const date = new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `[${l.error_type}] (${date}): ${l.lesson}`;
  });
  return `LESSONS FROM ALL PAST PREDICTIONS IN THIS TOURNAMENT (study these and apply them when relevant — these are your own past mistakes and successes):
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

/**
 * Builds one prompt covering every match in the batch, asking the LLM to analyze each
 * independently but return all predictions together in a single JSON response - this is what
 * lets one Gemini call replace what would otherwise be N separate calls.
 */
export function buildBatchPredictionPrompt(contexts: MatchContext[], learnings: PredictionLearning[] = []): string {
  const sections = contexts.map((ctx, i) => buildMatchSection(ctx, i)).join("\n\n");
  const learningsBlock = buildLearningsBlock(learnings);

  return `You are a quantitative football (soccer) analyst predicting 2026 FIFA World Cup scorelines to WIN A PREDICTION GAME. The game is scored as: +1 point for correctly calling the result (home win / draw / away win) and +3 points for the exact final scoreline. Your sole objective is to MAXIMIZE EXPECTED POINTS across all matches — not to look clever or interesting.

Because an exact score is worth 3x the outcome, each match carries a real trade-off: chasing a low-probability exact score can cost you the safer outcome point. For every match below you are given a QUANTITATIVE MODEL that has already computed the expected-points-optimal scoreline from the market. Default to that pick. Only override it when the qualitative team news (confirmed injuries, suspensions, rotation, must-win context, sharp line movement) gives a concrete, stated reason — and when you do, move to another high-probability scoreline, not a long-shot. Analyze each match independently using only its own data below, but return all predictions together in one JSON response.

${learningsBlock ? learningsBlock + "\n\n" : ""}${sections}

TASK:
For each match, START from the QUANTITATIVE MODEL's expected-points-optimal pick. Then sanity-check it against the bookmaker correct-score grid, the Polymarket sentiment, the recent form, and the qualitative team news. Keep that pick unless a concrete signal justifies moving to another HIGH-PROBABILITY scoreline (from the model's "most likely" list) — for example, a key striker ruled out (shift goals down), a leaky defence or a must-win chase (shift goals up), or a clear mismatch the market underrates. Note any meaningful divergence between the model, the bookmaker odds, and Polymarket sentiment.

GUARDRAILS (the model already enforces these, so only your overrides need checking against them):
- Do not default to 2-1; it has been heavily over-predicted. Only pick it if it is genuinely the model's or market's most likely score.
- Keep your predicted total goals close to the model's expected total (≈ the Over/Under line) unless news justifies otherwise.
- Take draws seriously when the model's draw probability is comparable to a win; do not reflexively pick a winner.
- Confidence discipline: reserve 8-10 only for standout, low-variance matchups. Most exact-score predictions should sit in the 4-7 range — do not claim high confidence in a precise score you are essentially guessing.

Respond with a single JSON object containing a "predictions" array with exactly one entry per match listed above, in the same order. Each entry's match_label must exactly equal the "Home vs Away" text shown in that match's "=== MATCH N: ... ===" header. Each entry must include:
- match_label: string, exact match identifier as described above
- predicted_outcome: "HOME_WIN", "AWAY_WIN", or "DRAW"
- predicted_home_goals: integer, exact predicted goals for the home team
- predicted_away_goals: integer, exact predicted goals for the away team
- confidence_score: integer 1-10
- market_consensus: one sentence summarizing what the betting markets indicate for that match
- analytical_edge: two sentences on qualitative factors (injuries, tactics) that might defy or support the odds for that match`;
}
