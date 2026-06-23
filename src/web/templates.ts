import type { MatchWithTeams, Prediction } from "../types/domain.js";
import type { AccuracyStats } from "../db/predictionsRepo.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 1.4rem; }
  a { color: #6cb6ff; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #2a2d34; vertical-align: top; }
  th { color: #9aa0a6; font-weight: 600; }
  .nav { margin-bottom: 1rem; }
  .nav a { margin-right: 1rem; }
  .muted { color: #9aa0a6; }
</style>
</head>
<body>
<div class="nav"><a href="/">Upcoming</a><a href="/accuracy">Accuracy</a></div>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

export interface UpcomingRow {
  match: MatchWithTeams;
  prediction: Prediction | null;
}

export function renderUpcomingPage(rows: UpcomingRow[]): string {
  const tableRows = rows
    .map(({ match, prediction }) => {
      const kickoff = escapeHtml(new Date(match.kickoff_time).toLocaleString("en-GB", { timeZone: "UTC" }));
      const teams = `${escapeHtml(match.home_team.name)} vs ${escapeHtml(match.away_team.name)}`;
      const predictedScore = prediction ? `${prediction.predicted_home_goals} - ${prediction.predicted_away_goals}` : "—";
      const confidence = prediction ? `${prediction.confidence_score}/10` : "—";
      const consensus = prediction ? escapeHtml(prediction.market_consensus) : `<span class="muted">No prediction yet</span>`;
      return `<tr><td>${kickoff} UTC</td><td>${teams}</td><td>${predictedScore}</td><td>${confidence}</td><td>${consensus}</td></tr>`;
    })
    .join("\n");

  const body = rows.length
    ? `<table><thead><tr><th>Kickoff</th><th>Match</th><th>Predicted</th><th>Confidence</th><th>Market Consensus</th></tr></thead><tbody>${tableRows}</tbody></table>`
    : `<p class="muted">No upcoming matches found.</p>`;

  return layout("Upcoming Predictions", body);
}

export function renderAccuracyPage(stats: AccuracyStats): string {
  const exactPct = stats.totalFinishedWithPrediction > 0 ? `${((stats.exactScoreCount / stats.totalFinishedWithPrediction) * 100).toFixed(1)}%` : "—";
  const outcomePct =
    stats.totalFinishedWithPrediction > 0 ? `${((stats.correctOutcomeCount / stats.totalFinishedWithPrediction) * 100).toFixed(1)}%` : "—";
  const brier = stats.brierScore == null ? "—" : stats.brierScore.toFixed(3);

  const summary = `<table>
<tr><th>Finished matches tracked</th><td>${stats.totalFinishedWithPrediction}</td></tr>
<tr><th>Exact scoreline correct</th><td>${stats.exactScoreCount} (${exactPct})</td></tr>
<tr><th>Correct outcome (W/D/L)</th><td>${stats.correctOutcomeCount} (${outcomePct})</td></tr>
<tr><th>Brier score (confidence calibration)</th><td>${brier} <span class="muted">(lower is better; 0.25 ≈ coin flip)</span></td></tr>
</table>`;

  const bucketRows = stats.confidenceBuckets
    .map((b) => {
      const hitRate = b.count > 0 ? `${((b.correctOutcomeCount / b.count) * 100).toFixed(1)}%` : "—";
      return `<tr><td>${escapeHtml(b.label)}</td><td>${b.count}</td><td>${b.correctOutcomeCount}</td><td>${hitRate}</td></tr>`;
    })
    .join("\n");

  const buckets = `<h1 style="font-size:1.1rem;margin-top:2rem">Outcome hit-rate by confidence</h1>
<p class="muted">If the model is well-calibrated, higher-confidence buckets should win more often.</p>
<table><thead><tr><th>Confidence</th><th>Predictions</th><th>Correct outcome</th><th>Hit rate</th></tr></thead>
<tbody>${bucketRows}</tbody></table>`;

  return layout("Prediction Accuracy", summary + buckets);
}
