interface PolymarketMarket {
  question: string;
  outcomes: string; // JSON-encoded string array, e.g. '["Yes", "No"]'
  outcomePrices: string; // JSON-encoded string array, e.g. '["0.655", "0.345"]'
}

interface PolymarketEvent {
  title: string;
  slug: string;
  markets: PolymarketMarket[];
}

interface PolymarketSearchResponse {
  events: PolymarketEvent[];
}

export interface PolymarketSummary {
  homeProb: number;
  drawProb: number;
  awayProb: number;
  eventUrl: string;
}

function yesPrice(market: PolymarketMarket): number | null {
  const outcomes: string[] = JSON.parse(market.outcomes);
  const prices: string[] = JSON.parse(market.outcomePrices);
  const yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  if (yesIndex === -1) return null;
  return Number(prices[yesIndex]);
}

/** Lowercase, strip punctuation/diacritics, collapse whitespace - so "São Paulo" ~ "sao paulo". */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Finds the "Will {team} win?" market for a team, tolerant of naming differences between data sources. */
function findWinMarket(event: PolymarketEvent, team: string): PolymarketMarket | undefined {
  const target = normalizeName(team);
  return event.markets.find((m) => {
    const q = normalizeName(m.question);
    return q.startsWith("will ") && q.includes(" win") && q.includes(target);
  });
}

/**
 * Polymarket structures each soccer match as an event with three independent Yes/No
 * markets ("Will {home} win?", "Will {away} win?", "Will it end in a draw?"). The Yes
 * price on each *is* the market-implied probability directly (no odds conversion needed).
 *
 * A single search returns several candidate events; rather than blindly trusting the first hit
 * (which is often an unrelated market when team names differ between The Odds API and Polymarket),
 * we pick the first event that actually contains BOTH teams' win markets plus a draw market.
 * Returns null if none qualify - not every fixture has a Polymarket market.
 */
export async function fetchPolymarketSummary(homeTeam: string, awayTeam: string): Promise<PolymarketSummary | null> {
  const url = new URL("https://gamma-api.polymarket.com/public-search");
  url.searchParams.set("q", `${homeTeam} vs ${awayTeam}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polymarket search failed (${res.status} ${res.statusText}): ${body}`);
  }

  const data = (await res.json()) as PolymarketSearchResponse;
  const events = data.events ?? [];
  if (events.length === 0) return null;

  for (const event of events) {
    const homeMarket = findWinMarket(event, homeTeam);
    const awayMarket = findWinMarket(event, awayTeam);
    const drawMarket = event.markets.find((m) => normalizeName(m.question).includes("draw"));
    if (!homeMarket || !awayMarket || !drawMarket) continue;

    const homeProb = yesPrice(homeMarket);
    const awayProb = yesPrice(awayMarket);
    const drawProb = yesPrice(drawMarket);
    if (homeProb == null || awayProb == null || drawProb == null) continue;

    return { homeProb, drawProb, awayProb, eventUrl: `https://polymarket.com/event/${event.slug}` };
  }

  console.warn(`Polymarket: no event matched both teams for "${homeTeam} vs ${awayTeam}" (${events.length} candidate(s) searched).`);
  return null;
}
