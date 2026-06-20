import { supabase } from "./supabaseClient.js";
import type { PredictionLearning } from "../types/domain.js";

export interface NewLearning {
  match_id: string;
  prediction_id: string;
  error_type: string;
  lesson: string;
}

export interface UnlearnedMatch {
  match_id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_time: string;
  actual_home_goals: number;
  actual_away_goals: number;
  prediction_id: string;
  predicted_outcome: string;
  predicted_home_goals: number;
  predicted_away_goals: number;
  confidence_score: number;
  market_consensus: string;
  analytical_edge: string;
  home_implied_prob: number | null;
  draw_implied_prob: number | null;
  away_implied_prob: number | null;
  totals_point: number | null;
}

export interface TeamFormMatch {
  home_team_name: string;
  away_team_name: string;
  actual_home_goals: number;
  actual_away_goals: number;
  kickoff_time: string;
}

/** All finished matches that have a prediction but no learning yet — drives both backfill and incremental runs. */
export async function getUnlearnedFinishedMatches(): Promise<UnlearnedMatch[]> {
  // Fetch finished matches with predictions, excluding any already in prediction_learnings
  const { data: learned, error: learnedErr } = await supabase
    .from("prediction_learnings")
    .select("prediction_id");
  if (learnedErr) throw learnedErr;

  const learnedIds = new Set((learned ?? []).map((r: { prediction_id: string }) => r.prediction_id));

  const { data: predictions, error: predErr } = await supabase
    .from("predictions")
    .select(
      "id, match_id, predicted_outcome, predicted_home_goals, predicted_away_goals, confidence_score, market_consensus, analytical_edge",
    )
    .order("created_at", { ascending: true });
  if (predErr) throw predErr;

  const unlearnedPredictions = (predictions ?? []).filter(
    (p: { id: string }) => !learnedIds.has(p.id),
  );
  if (unlearnedPredictions.length === 0) return [];

  const matchIds = unlearnedPredictions.map((p: { match_id: string }) => p.match_id);

  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select("id, kickoff_time, actual_home_goals, actual_away_goals, status, home_team_id, away_team_id")
    .in("id", matchIds)
    .eq("status", "finished");
  if (matchErr) throw matchErr;

  const finishedMatchIds = new Set((matches ?? []).map((m: { id: string }) => m.id));
  const finishedPredictions = unlearnedPredictions.filter((p: { match_id: string }) =>
    finishedMatchIds.has(p.match_id),
  );
  if (finishedPredictions.length === 0) return [];

  // Fetch team names for all involved matches
  const allTeamIds = [
    ...new Set(
      (matches ?? []).flatMap((m: { home_team_id: number; away_team_id: number }) => [m.home_team_id, m.away_team_id]),
    ),
  ];
  const { data: teams, error: teamErr } = await supabase.from("teams").select("id, name").in("id", allTeamIds);
  if (teamErr) throw teamErr;

  const teamById = new Map((teams ?? []).map((t: { id: number; name: string }) => [t.id, t.name]));
  const matchById = new Map(
    (matches ?? []).map((m: {
      id: string;
      kickoff_time: string;
      actual_home_goals: number;
      actual_away_goals: number;
      home_team_id: number;
      away_team_id: number;
    }) => [m.id, m]),
  );

  // Fetch latest odds snapshot per match for market context
  const { data: oddsRows, error: oddsErr } = await supabase
    .from("odds_snapshots")
    .select("match_id, home_implied_prob, draw_implied_prob, away_implied_prob, totals_point, captured_at")
    .in("match_id", finishedPredictions.map((p: { match_id: string }) => p.match_id))
    .order("captured_at", { ascending: false });
  if (oddsErr) throw oddsErr;

  // Keep only the most recent snapshot per match
  const latestOddsByMatch = new Map<string, { home_implied_prob: number | null; draw_implied_prob: number | null; away_implied_prob: number | null; totals_point: number | null }>();
  for (const o of oddsRows ?? []) {
    if (!latestOddsByMatch.has(o.match_id)) {
      latestOddsByMatch.set(o.match_id, {
        home_implied_prob: o.home_implied_prob,
        draw_implied_prob: o.draw_implied_prob,
        away_implied_prob: o.away_implied_prob,
        totals_point: o.totals_point,
      });
    }
  }

  return finishedPredictions.map((p: {
    id: string;
    match_id: string;
    predicted_outcome: string;
    predicted_home_goals: number;
    predicted_away_goals: number;
    confidence_score: number;
    market_consensus: string;
    analytical_edge: string;
  }) => {
    const m = matchById.get(p.match_id)!;
    const odds = latestOddsByMatch.get(p.match_id);
    return {
      match_id: p.match_id,
      home_team_name: teamById.get(m.home_team_id) ?? "Unknown",
      away_team_name: teamById.get(m.away_team_id) ?? "Unknown",
      kickoff_time: m.kickoff_time,
      actual_home_goals: m.actual_home_goals,
      actual_away_goals: m.actual_away_goals,
      prediction_id: p.id,
      predicted_outcome: p.predicted_outcome,
      predicted_home_goals: p.predicted_home_goals,
      predicted_away_goals: p.predicted_away_goals,
      confidence_score: p.confidence_score,
      market_consensus: p.market_consensus,
      analytical_edge: p.analytical_edge,
      home_implied_prob: odds?.home_implied_prob ?? null,
      draw_implied_prob: odds?.draw_implied_prob ?? null,
      away_implied_prob: odds?.away_implied_prob ?? null,
      totals_point: odds?.totals_point ?? null,
    };
  });
}

/** Last 3 finished tournament matches for a given team (by team name), for form context. */
export async function getTeamRecentForm(teamName: string, excludeMatchId: string): Promise<TeamFormMatch[]> {
  const { data: teamRow } = await supabase.from("teams").select("id").eq("name", teamName).maybeSingle();
  if (!teamRow) return [];

  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, actual_home_goals, actual_away_goals, kickoff_time")
    .eq("status", "finished")
    .neq("id", excludeMatchId)
    .or(`home_team_id.eq.${teamRow.id},away_team_id.eq.${teamRow.id}`)
    .order("kickoff_time", { ascending: false })
    .limit(3);

  if (!matches || matches.length === 0) return [];

  const teamIds = [...new Set(matches.flatMap((m: { home_team_id: number; away_team_id: number }) => [m.home_team_id, m.away_team_id]))];
  const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
  const teamById = new Map((teams ?? []).map((t: { id: number; name: string }) => [t.id, t.name]));

  return (matches as {
    home_team_id: number;
    away_team_id: number;
    actual_home_goals: number;
    actual_away_goals: number;
    kickoff_time: string;
  }[]).map((m) => ({
    home_team_name: teamById.get(m.home_team_id) ?? "Unknown",
    away_team_name: teamById.get(m.away_team_id) ?? "Unknown",
    actual_home_goals: m.actual_home_goals,
    actual_away_goals: m.actual_away_goals,
    kickoff_time: m.kickoff_time,
  }));
}

/** Saves one learning. Silently skips duplicates (re-run safe). */
export async function saveLearning(input: NewLearning): Promise<void> {
  const { error } = await supabase
    .from("prediction_learnings")
    .upsert(input, { onConflict: "prediction_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** All learnings ordered oldest-first — injected into prediction prompts as full history. */
export async function getAllLearnings(): Promise<PredictionLearning[]> {
  const { data, error } = await supabase
    .from("prediction_learnings")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PredictionLearning[];
}
