import { supabase } from "./supabaseClient.js";
import type { Prediction, PredictedOutcome } from "../types/domain.js";

export interface NewPrediction {
  match_id: string;
  predicted_outcome: PredictedOutcome;
  predicted_home_goals: number;
  predicted_away_goals: number;
  confidence_score: number;
  market_consensus: string;
  analytical_edge: string;
  raw_llm_response: unknown;
}

export async function savePrediction(prediction: NewPrediction): Promise<Prediction> {
  const { data, error } = await supabase.from("predictions").insert(prediction).select("*").single();
  if (error) throw error;
  return data as Prediction;
}

export async function getLatestPrediction(matchId: string): Promise<Prediction | null> {
  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Prediction) ?? null;
}

export interface AccuracyStats {
  totalFinishedWithPrediction: number;
  exactScoreCount: number;
  correctOutcomeCount: number;
}

/** Derived accuracy across all finished matches that have a prediction - no separate stats table, always fresh. */
export async function getAccuracyStats(): Promise<AccuracyStats> {
  const { data, error } = await supabase
    .from("predictions")
    .select("predicted_outcome, predicted_home_goals, predicted_away_goals, matches!inner(status, actual_home_goals, actual_away_goals)")
    .eq("matches.status", "finished");
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    predicted_outcome: PredictedOutcome;
    predicted_home_goals: number;
    predicted_away_goals: number;
    matches: { actual_home_goals: number | null; actual_away_goals: number | null };
  }[];

  let exactScoreCount = 0;
  let correctOutcomeCount = 0;
  for (const row of rows) {
    const { actual_home_goals, actual_away_goals } = row.matches;
    if (actual_home_goals == null || actual_away_goals == null) continue;
    if (row.predicted_home_goals === actual_home_goals && row.predicted_away_goals === actual_away_goals) {
      exactScoreCount++;
    }
    const actualOutcome: PredictedOutcome =
      actual_home_goals > actual_away_goals ? "HOME_WIN" : actual_home_goals < actual_away_goals ? "AWAY_WIN" : "DRAW";
    if (row.predicted_outcome === actualOutcome) correctOutcomeCount++;
  }

  return { totalFinishedWithPrediction: rows.length, exactScoreCount, correctOutcomeCount };
}
