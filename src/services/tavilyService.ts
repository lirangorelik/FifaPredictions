import { env } from "../config/env.js";

export interface ArticleSummary {
  title: string;
  url: string;
  snippet: string;
}

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  results: TavilySearchResult[];
}

// Team news goes stale fast (injuries, lineups), so restrict to recent news rather than letting the
// LLM reason over weeks-old articles. Snippets are capped so a single verbose result can't bloat the
// batch prompt (and its token cost) disproportionately.
const SNIPPET_MAX_CHARS = 400;
const NEWS_RECENCY_DAYS = 10;

/** Fetches the top 5 recent match-day articles/threads (injuries, team news, tactics) for a fixture. */
export async function fetchMatchAnalysis(homeTeam: string, awayTeam: string): Promise<ArticleSummary[]> {
  const query = `${homeTeam} vs ${awayTeam} World Cup 2026 injury news team news tactical analysis prediction`;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      topic: "news",
      days: NEWS_RECENCY_DAYS,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status} ${res.statusText}): ${body}`);
  }

  const data = (await res.json()) as TavilySearchResponse;
  return data.results.slice(0, 5).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content.length > SNIPPET_MAX_CHARS ? `${r.content.slice(0, SNIPPET_MAX_CHARS)}…` : r.content,
  }));
}
