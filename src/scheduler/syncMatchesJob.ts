import { fetchUpcomingOdds, summarizeMoneyline, summarizeTotals, summarizeBtts, summarizeCorrectScore } from "../services/oddsApiService.js";
import { fetchPolymarketSummary } from "../services/polymarketService.js";
import { getOrCreateTeam, upsertMatch } from "../db/matchesRepo.js";
import { insertOddsSnapshot } from "../db/oddsRepo.js";

/**
 * Pulls current odds from The Odds API, upserts the match + teams, and records a new
 * odds_snapshots row. Run on every poll tick so snapshots accumulate into a 24h line-movement history.
 */
export async function syncMatchesAndOdds(): Promise<void> {
  const events = await fetchUpcomingOdds();

  for (const event of events) {
    const homeTeam = await getOrCreateTeam(event.home_team);
    const awayTeam = await getOrCreateTeam(event.away_team);
    const match = await upsertMatch({
      external_id: event.id,
      home_team_id: homeTeam.id,
      away_team_id: awayTeam.id,
      kickoff_time: event.commence_time,
    });

    const moneyline = summarizeMoneyline(event);
    const totals = summarizeTotals(event);
    const btts = summarizeBtts(event);
    const correctScore = summarizeCorrectScore(event);

    // Not every fixture has a Polymarket market yet - treat failures/misses as optional data, not a sync error.
    let polymarket = null;
    try {
      polymarket = await fetchPolymarketSummary(event.home_team, event.away_team);
    } catch (err) {
      console.warn(`Polymarket lookup failed for ${event.home_team} vs ${event.away_team}:`, err instanceof Error ? err.message : err);
    }

    await insertOddsSnapshot({
      match_id: match.id,
      bookmaker: "consensus_average",
      home_moneyline_odds: moneyline.homeOdds,
      draw_moneyline_odds: moneyline.drawOdds,
      away_moneyline_odds: moneyline.awayOdds,
      home_implied_prob: moneyline.homeImpliedProb,
      draw_implied_prob: moneyline.drawImpliedProb,
      away_implied_prob: moneyline.awayImpliedProb,
      totals_point: totals.point,
      over_odds: totals.overOdds,
      under_odds: totals.underOdds,
      btts_yes_odds: btts.yesOdds,
      btts_no_odds: btts.noOdds,
      polymarket_home_prob: polymarket?.homeProb ?? null,
      polymarket_draw_prob: polymarket?.drawProb ?? null,
      polymarket_away_prob: polymarket?.awayProb ?? null,
      polymarket_event_url: polymarket?.eventUrl ?? null,
      correct_score_odds: correctScore.length > 0 ? correctScore : null,
      raw: event,
    });
  }
}
