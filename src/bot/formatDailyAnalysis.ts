import type { MatchWithTeams, OddsSnapshot, Prediction } from "../types/domain.js";

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (match) => `\\${match}`);
}

function pct(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatPolymarketLine(odds: OddsSnapshot): string | null {
  if (odds.polymarket_home_prob == null || odds.polymarket_draw_prob == null || odds.polymarket_away_prob == null) {
    return null;
  }
  return escapeMarkdownV2(
    `Home ${pct(odds.polymarket_home_prob)} / Draw ${pct(odds.polymarket_draw_prob)} / Away ${pct(odds.polymarket_away_prob)}`,
  );
}

export interface AnalysisResultLike {
  match: MatchWithTeams;
  prediction: Prediction;
  latestOdds: OddsSnapshot;
  marketScoreProb: number | null;
}

function formatMatchBlock(result: AnalysisResultLike): string {
  const { match, prediction, latestOdds, marketScoreProb } = result;
  const home = escapeMarkdownV2(match.home_team.name);
  const away = escapeMarkdownV2(match.away_team.name);
  const consensus = escapeMarkdownV2(prediction.market_consensus);
  const edge = escapeMarkdownV2(prediction.analytical_edge);
  const kickoff = escapeMarkdownV2(
    new Date(match.kickoff_time).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }),
  );
  const polymarketLine = formatPolymarketLine(latestOdds);

  const lines = [
    `⚽ *${home} vs ${away}*`,
    `⏰ Kickoff: ${kickoff} UTC`,
    `🎯 *PREDICTED SCORELINE:* *${home} ${prediction.predicted_home_goals} — ${prediction.predicted_away_goals} ${away}*`,
    `🎲 *Confidence:* ${prediction.confidence_score}/10`,
    `📊 *Market Consensus:* ${consensus}`,
    `🧠 *Analytical Edge:* ${edge}`,
  ];

  if (polymarketLine) lines.push(`🪙 *Polymarket:* ${polymarketLine}`);
  if (marketScoreProb != null) lines.push(`📐 *Market Price For This Score:* ${escapeMarkdownV2(pct(marketScoreProb))} implied`);

  return lines.join("\n");
}

const TELEGRAM_SAFE_LENGTH = 3800; // stay comfortably under Telegram's 4096-char message limit

/** Splits the full batch into multiple Telegram messages if needed - never cuts a match block in half. */
export function formatBatchMessages(results: AnalysisResultLike[]): string[] {
  if (results.length === 0) return [];

  const header = `🚨 *WORLD CUP DAILY ANALYSIS* 🚨\n${results.length} matches in the next 24h`;
  const blocks = results.map(formatMatchBlock);

  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    const candidate = `${current}\n\n${block}`;
    if (candidate.length > TELEGRAM_SAFE_LENGTH && current !== header) {
      messages.push(current);
      current = `${header} \\(cont'd\\)\n\n${block}`;
    } else {
      current = candidate;
    }
  }
  messages.push(current);
  return messages;
}
