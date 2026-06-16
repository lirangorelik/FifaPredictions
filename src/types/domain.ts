export type MatchStatus = "scheduled" | "live" | "finished" | "cancelled";

export interface Team {
  id: number;
  name: string;
  fifa_code: string | null;
}

export interface Match {
  id: string;
  external_id: string | null;
  home_team_id: number;
  away_team_id: number;
  kickoff_time: string;
  status: MatchStatus;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchWithTeams extends Match {
  home_team: Team;
  away_team: Team;
}

export interface CorrectScoreOdds {
  score: string; // "home-away", e.g. "2-1"
  price: number;
  impliedProb: number;
}

export interface OddsSnapshot {
  id: string;
  match_id: string;
  bookmaker: string | null;
  captured_at: string;
  home_moneyline_odds: number | null;
  draw_moneyline_odds: number | null;
  away_moneyline_odds: number | null;
  home_implied_prob: number | null;
  draw_implied_prob: number | null;
  away_implied_prob: number | null;
  totals_point: number | null;
  over_odds: number | null;
  under_odds: number | null;
  btts_yes_odds: number | null;
  btts_no_odds: number | null;
  polymarket_home_prob: number | null;
  polymarket_draw_prob: number | null;
  polymarket_away_prob: number | null;
  polymarket_event_url: string | null;
  correct_score_odds: CorrectScoreOdds[] | null;
  raw: unknown;
}

export type PredictedOutcome = "HOME_WIN" | "AWAY_WIN" | "DRAW";

export interface Prediction {
  id: string;
  match_id: string;
  predicted_outcome: PredictedOutcome;
  predicted_home_goals: number;
  predicted_away_goals: number;
  confidence_score: number;
  market_consensus: string;
  analytical_edge: string;
  raw_llm_response: unknown;
  created_at: string;
}

export interface AlertLogEntry {
  id: string;
  match_id: string;
  prediction_id: string | null;
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string;
}
