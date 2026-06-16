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

/**
 * Polymarket structures each soccer match as an event with three independent Yes/No
 * markets ("Will {home} win?", "Will {away} win?", "Will it end in a draw?"). The Yes
 * price on each *is* the market-implied probability directly (no odds conversion needed).
 * Returns null if no matching event/markets are found - not every fixture has a Polymarket market.
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
  const event = data.events?.[0];
  if (!event) return null;

  const homeMarket = event.markets.find((m) => m.question.toLowerCase().startsWith(`will ${homeTeam.toLowerCase()} win`));
  const awayMarket = event.markets.find((m) => m.question.toLowerCase().startsWith(`will ${awayTeam.toLowerCase()} win`));
  const drawMarket = event.markets.find((m) => m.question.toLowerCase().includes("draw"));

  const homeProb = homeMarket ? yesPrice(homeMarket) : null;
  const awayProb = awayMarket ? yesPrice(awayMarket) : null;
  const drawProb = drawMarket ? yesPrice(drawMarket) : null;

  if (homeProb == null || awayProb == null || drawProb == null) return null;

  return { homeProb, drawProb, awayProb, eventUrl: `https://polymarket.com/event/${event.slug}` };
}
