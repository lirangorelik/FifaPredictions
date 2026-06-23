import { env } from "../config/env.js";
import type { OddsApiEvent, OddsApiScoreEntry } from "./oddsMath.js";

// Re-export the pure transforms and their types so existing importers can keep importing them from
// this module; the actual implementations live in oddsMath.ts (which has no env/network deps so it
// can be unit-tested in isolation).
export {
  summarizeMoneyline,
  summarizeTotals,
  summarizeBtts,
  summarizeCorrectScore,
  parseFinalScore,
} from "./oddsMath.js";
export type {
  OddsApiEvent,
  OddsApiScoreEntry,
  MoneylineSummary,
  TotalsSummary,
  BttsSummary,
  CorrectScoreEntry,
} from "./oddsMath.js";

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
