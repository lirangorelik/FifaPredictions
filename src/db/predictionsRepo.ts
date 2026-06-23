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

export interface ConfidenceBucket {
  label: string; // e.g. "Low (1-3)"
  count: number;
  correctOutcomeCount: number;
}

export interface AccuracyStats {
  totalFinishedWithPrediction: number;
  exactScoreCount: number;
  correctOutcomeCount: number;
  /**
   * Calibration of the model's stated confidence against reality, treating confidence/10 as the
   * claimed probability the predicted outcome is correct. Mean squared error vs the 0/1 result;
   * lower is better (0 = perfect, 0.25 = no better than a coin flip). null until any match finishes.
   */
  brierScore: number | null;
  confidenceBuckets: ConfidenceBucket[];
}

function bucketLabel(confidence: number): string {
  if (confidence <= 3) return "Low (1-3)";
  if (confidence <= 6) return "Medium (4-6)";
  return "High (7-10)";
}

/** Derived accuracy across all finished matches that have a prediction - no separate stats table, always fresh. */
export async function getAccuracyStats(): Promise<AccuracyStats> {
  const { data, error } = await supabase
    .from("predictions")
    .select(
      "predicted_outcome, predicted_home_goals, predicted_away_goals, confidence_score, matches!inner(status, actual_home_goals, actual_away_goals)",
    )
    .eq("matches.status", "finished");
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    predicted_outcome: PredictedOutcome;
    predicted_home_goals: number;
    predicted_away_goals: number;
    confidence_score: number;
    matches: { actual_home_goals: number | null; actual_away_goals: number | null };
  }[];

  let exactScoreCount = 0;
  let correctOutcomeCount = 0;
  let brierSum = 0;
  let scored = 0;
  const buckets = new Map<string, ConfidenceBucket>([
    ["Low (1-3)", { label: "Low (1-3)", count: 0, correctOutcomeCount: 0 }],
    ["Medium (4-6)", { label: "Medium (4-6)", count: 0, correctOutcomeCount: 0 }],
    ["High (7-10)", { label: "High (7-10)", count: 0, correctOutcomeCount: 0 }],
  ]);

  for (const row of rows) {
    const { actual_home_goals, actual_away_goals } = row.matches;
    if (actual_home_goals == null || actual_away_goals == null) continue;
    if (row.predicted_home_goals === actual_home_goals && row.predicted_away_goals === actual_away_goals) {
      exactScoreCount++;
    }
    const actualOutcome: PredictedOutcome =
      actual_home_goals > actual_away_goals ? "HOME_WIN" : actual_home_goals < actual_away_goals ? "AWAY_WIN" : "DRAW";
    const correct = row.predicted_outcome === actualOutcome;
    if (correct) correctOutcomeCount++;

    // Brier: (claimed prob of being right − actual 0/1 result)^2, averaged.
    const p = Math.min(10, Math.max(1, row.confidence_score)) / 10;
    brierSum += (p - (correct ? 1 : 0)) ** 2;
    scored++;

    const bucket = buckets.get(bucketLabel(row.confidence_score))!;
    bucket.count++;
    if (correct) bucket.correctOutcomeCount++;
  }

  return {
    totalFinishedWithPrediction: rows.length,
    exactScoreCount,
    correctOutcomeCount,
    brierScore: scored > 0 ? brierSum / scored : null,
    confidenceBuckets: [...buckets.values()],
  };
}
