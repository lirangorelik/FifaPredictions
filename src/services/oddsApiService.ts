import { env } from "../config/env.js";

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
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

const BASE_URL = "https://api.the-odds-api.com/v4";

// Markets we'd like, per sport. BTTS isn't offered for every sport/region (The Odds API returns
// 422 INVALID_MARKET in that case) - probed once per process lifetime, not on every poll tick,
// to avoid wasting a guaranteed-fail request (and quota) on every single sync.
const DESIRED_MARKETS = ["h2h", "totals", "btts", "correct_score"];
const unsupportedMarketsBySport = new Map<string, Set<string>>();

function getKnownUnsupported(sportKey: string): Set<string> {
  let set = unsupportedMarketsBySport.get(sportKey);
  if (!set) {
    set = new Set();
    unsupportedMarketsBySport.set(sportKey, set);
  }
  return set;
}

function parseUnsupportedMarketsFromError(message: string): string[] {
  // The Odds API phrases this differently depending on the reason (e.g. "Markets not supported by
  // this endpoint: btts" vs "Invalid markets: correct_score") - match either form.
  const match = message.match(/(?:markets not supported by this endpoint|invalid markets):\s*([a-z_,\s]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

async function fetchOddsForMarkets(markets: string[]): Promise<OddsApiEvent[]> {
  const url = new URL(`${BASE_URL}/sports/${env.ODDS_API_SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", env.ODDS_API_KEY);
  url.searchParams.set("regions", env.ODDS_API_REGIONS);
  url.searchParams.set("markets", markets.join(","));
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`The Odds API request failed (${res.status} ${res.statusText}): ${body}`);
  }
  return (await res.json()) as OddsApiEvent[];
}

/**
 * Fetches upcoming Moneyline (h2h) / Totals / BTTS / correct-score odds across bookmakers for the
 * configured sport. The API rejects on the first unsupported market it finds in the list (one at
 * a time, not all at once), so this retries in a loop - each failed attempt remembers the newly
 * discovered unsupported market and removes it - until it succeeds or runs out of markets to try.
 * Once discovered, a permanently-unavailable market is skipped on all subsequent calls.
 */
export async function fetchUpcomingOdds(): Promise<OddsApiEvent[]> {
  const sportKey = env.ODDS_API_SPORT_KEY;
  const known = getKnownUnsupported(sportKey);

  let lastError: unknown;
  for (let attempt = 0; attempt <= DESIRED_MARKETS.length; attempt++) {
    const marketsToRequest = DESIRED_MARKETS.filter((m) => !known.has(m));
    try {
      return await fetchOddsForMarkets(marketsToRequest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newlyUnsupported = parseUnsupportedMarketsFromError(message);
      if (newlyUnsupported.length === 0) throw err;

      newlyUnsupported.forEach((m) => known.add(m));
      console.warn(`Markets unavailable for ${sportKey}: ${newlyUnsupported.join(", ")}. Retrying without them.`);
      lastError = err;
    }
  }
  throw lastError;
}

function average(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function collectPrices(event: OddsApiEvent, marketKey: string, outcomeName: string): number[] {
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
  let point: number | null = null;
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((m) => m.key === "totals");
    if (market && market.outcomes.length > 0) {
      point = market.outcomes[0].point ?? null;
      break;
    }
  }
  if (point === null) return { point: null, overOdds: null, underOdds: null };

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
 * offers this market - returns [] when absent (DESIRED_MARKETS fallback handles the 422 case).
 */
export interface OddsApiScoreEntry {
  id: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
}

/** Fetches recent (and live/completed) match results for the configured sport - one request covers all of them. */
export async function fetchScores(daysFrom = 3): Promise<OddsApiScoreEntry[]> {
  const url = new URL(`${BASE_URL}/sports/${env.ODDS_API_SPORT_KEY}/scores`);
  url.searchParams.set("apiKey", env.ODDS_API_KEY);
  url.searchParams.set("daysFrom", String(daysFrom));
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`The Odds API scores request failed (${res.status} ${res.statusText}): ${body}`);
  }
  return (await res.json()) as OddsApiScoreEntry[];
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
