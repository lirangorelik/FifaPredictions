import type { MatchWithTeams, OddsSnapshot, PredictionLearning } from "../types/domain.js";
import type { ArticleSummary } from "../services/tavilyService.js";

export interface MatchContext {
  match: MatchWithTeams;
  oddsHistory: OddsSnapshot[];
  articles: ArticleSummary[];
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

function buildMatchSection(ctx: MatchContext, index: number): string {
  const { match, oddsHistory, articles } = ctx;
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

  return `You are a quantitative football (soccer) analyst building precise scoreline predictions for multiple 2026 FIFA World Cup matches kicking off in the next 24 hours. Analyze each match independently using only its own data below, but return all predictions together in one JSON response.

${learningsBlock ? learningsBlock + "\n\n" : ""}${sections}

TASK:
For each match above, cross-reference the bookmaker market implied probabilities (moneyline + goal totals), the bookmaker's own correct-score grid, and the independent Polymarket prediction-market sentiment with the qualitative team news to project a realistic match flow and a precise final scoreline for that match. Use each match's correct-score grid as a concrete anchor for which exact scorelines the market itself considers plausible, but feel free to deviate from its single most-likely entry if the qualitative news or line movement strongly suggests otherwise. Note any meaningful divergence between bookmaker odds and Polymarket sentiment for each match.

SCORELINE CALIBRATION (apply to every prediction — these correct real, measured biases in past predictions):
- Do NOT default to 2-1. It has been wildly over-predicted; only use it for a genuinely tight favourite win, never as a generic "the better team edges it" answer.
- Anchor the TOTAL goals to the Over/Under line. If the totals line is 3.0 or higher, your two scores should usually add up to more than the line; if it is 2.0 or lower, lean to a low-scoring result. Do not predict a 2-1 (3 goals) when the line says ~3.5.
- Take draws seriously. They occur far more often than predicted. When no side's vig-removed implied probability is above ~45%, a draw (1-1, 0-0, 2-2) is often the correct call.
- Commit to blunt scorelines when warranted. When a side's implied probability is above ~65% against a clearly weaker opponent, do not be timid — lopsided results (3-0, 4-0, 4-1 and wider) are common at this tournament. Avoid shrinking every favourite win down to 2-1 or 2-0.
- Vary margins and clean sheets to fit each specific matchup instead of reusing the same one- or two-goal scorelines across different games.
- Confidence discipline: reserve 8-10 only for standout, low-variance matchups. Given how random exact scorelines are, most predictions should land in the 4-7 range. Do not state high confidence in a precise scoreline you are merely guessing.

Respond with a single JSON object containing a "predictions" array with exactly one entry per match listed above, in the same order. Each entry's match_label must exactly equal the "Home vs Away" text shown in that match's "=== MATCH N: ... ===" header. Each entry must include:
- match_label: string, exact match identifier as described above
- predicted_outcome: "HOME_WIN", "AWAY_WIN", or "DRAW"
- predicted_home_goals: integer, exact predicted goals for the home team
- predicted_away_goals: integer, exact predicted goals for the away team
- confidence_score: integer 1-10
- market_consensus: one sentence summarizing what the betting markets indicate for that match
- analytical_edge: two sentences on qualitative factors (injuries, tactics) that might defy or support the odds for that match`;
}
