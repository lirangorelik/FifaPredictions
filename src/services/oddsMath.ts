// Pure transforms over The Odds API payloads. Deliberately free of any env/network imports so the
// math (vig removal, consensus lines, score parsing) can be unit-tested in isolation. The IO layer
// (oddsApiService.ts) imports and re-exports everything here.

export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiScoreEntry {
  id: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
}

export function average(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function collectPrices(event: OddsApiEvent, marketKey: string, outcomeName: string): number[] {
  const prices: number[] = [];
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((m) => m.key === marketKey);
    const outcome = market?.outcomes.find((o) => o.name === outcomeName);
    if (outcome) prices.push(outcome.price);
  }
  return prices;
}

export interface MoneylineSummary {
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  homeImpliedProb: number | null;
  drawImpliedProb: number | null;
  awayImpliedProb: number | null;
}

export function summarizeMoneyline(event: OddsApiEvent): MoneylineSummary {
  const homeOdds = average(collectPrices(event, "h2h", event.home_team));
  const drawOdds = average(collectPrices(event, "h2h", "Draw"));
  const awayOdds = average(collectPrices(event, "h2h", event.away_team));

  if (homeOdds == null || drawOdds == null || awayOdds == null) {
    return { homeOdds, drawOdds, awayOdds, homeImpliedProb: null, drawImpliedProb: null, awayImpliedProb: null };
  }

  // Remove bookmaker overround (vig) by normalizing the raw 1/odds implied probabilities to sum to 1.
  const rawHome = 1 / homeOdds;
  const rawDraw = 1 / drawOdds;
  const rawAway = 1 / awayOdds;
  const sum = rawHome + rawDraw + rawAway;

  return {
    homeOdds,
    drawOdds,
    awayOdds,
    homeImpliedProb: rawHome / sum,
    drawImpliedProb: rawDraw / sum,
    awayImpliedProb: rawAway / sum,
  };
}

export interface TotalsSummary {
  point: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

export function summarizeTotals(event: OddsApiEvent): TotalsSummary {
  // Bookmakers can hang the goal line at different points (2.5 vs 2.75). Pick the consensus
  // (modal) line across all bookmakers - not just whichever book happens to be listed first -
  // and average over/under only at that line. Ties break to the lower (more conservative) line.
  const lineCounts = new Map<number, number>();
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((m) => m.key === "totals");
    if (!market) continue;
    const pointsThisBook = new Set<number>();
    for (const outcome of market.outcomes) {
      if (outcome.point != null) pointsThisBook.add(outcome.point);
    }
    for (const p of pointsThisBook) lineCounts.set(p, (lineCounts.get(p) ?? 0) + 1);
  }
  if (lineCounts.size === 0) return { point: null, overOdds: null, underOdds: null };

  let point: number | null = null;
  let bestCount = -1;
  for (const [p, count] of lineCounts) {
    if (count > bestCount || (count === bestCount && (point == null || p < point))) {
      bestCount = count;
      point = p;
    }
  }

  const overPrices: number[] = [];
  const underPrices: number[] = [];
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((m) => m.key === "totals");
    if (!market) continue;
    const over = market.outcomes.find((o) => o.name === "Over" && o.point === point);
    const under = market.outcomes.find((o) => o.name === "Under" && o.point === point);
    if (over) overPrices.push(over.price);
    if (under) underPrices.push(under.price);
  }
  return { point, overOdds: average(overPrices), underOdds: average(underPrices) };
}

export interface BttsSummary {
  yesOdds: number | null;
  noOdds: number | null;
}

export function summarizeBtts(event: OddsApiEvent): BttsSummary {
  return {
    yesOdds: average(collectPrices(event, "btts", "Yes")),
    noOdds: average(collectPrices(event, "btts", "No")),
  };
}

export interface CorrectScoreEntry {
  score: string; // canonical "home-away" form, e.g. "2-1"
  price: number; // average decimal odds across bookmakers offering this scoreline
  impliedProb: number; // vig-removed, normalized across all collected scorelines for this event
}

function parseScoreOutcomeName(name: string): { home: number; away: number } | null {
  const match = name.match(/(\d+)\D+(\d+)/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

/**
 * Parses the correct-score market (full scoreline grid, e.g. "2:1" @ 9.50) into the top 10
 * most-likely scorelines by vig-removed implied probability. Not every bookmaker/sport/region
 * offers this market - returns [] when absent.
 */
export function summarizeCorrectScore(event: OddsApiEvent): CorrectScoreEntry[] {
  const pricesByScore = new Map<string, number[]>();
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((m) => m.key === "correct_score");
    if (!market) continue;
    for (const outcome of market.outcomes) {
      const parsed = parseScoreOutcomeName(outcome.name);
      if (!parsed) continue;
      const key = `${parsed.home}-${parsed.away}`;
      const prices = pricesByScore.get(key) ?? [];
      prices.push(outcome.price);
      pricesByScore.set(key, prices);
    }
  }
  if (pricesByScore.size === 0) return [];

  const avgPriceByScore = new Map<string, number>();
  for (const [score, prices] of pricesByScore) {
    avgPriceByScore.set(score, average(prices)!);
  }

  const totalInverse = [...avgPriceByScore.values()].reduce((sum, price) => sum + 1 / price, 0);

  return [...avgPriceByScore.entries()]
    .map(([score, price]) => ({ score, price, impliedProb: 1 / price / totalInverse }))
    .sort((a, b) => b.impliedProb - a.impliedProb)
    .slice(0, 10);
}

export function parseFinalScore(entry: OddsApiScoreEntry): { homeGoals: number; awayGoals: number } | null {
  if (!entry.completed || !entry.scores) return null;
  const home = entry.scores.find((s) => s.name === entry.home_team);
  const away = entry.scores.find((s) => s.name === entry.away_team);
  if (!home || !away) return null;
  const homeGoals = Number(home.score);
  const awayGoals = Number(away.score);
  if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) return null;
  return { homeGoals, awayGoals };
}
