import { supabase } from "./supabaseClient.js";
import type { Match, MatchWithTeams, Team } from "../types/domain.js";

export async function getOrCreateTeam(name: string, fifaCode?: string): Promise<Team> {
  const { data: existing, error: selectError } = await supabase.from("teams").select("*").eq("name", name).maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing as Team;

  const { data: created, error: insertError } = await supabase
    .from("teams")
    .insert({ name, fifa_code: fifaCode ?? null })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return created as Team;
}

export interface UpsertMatchInput {
  external_id: string;
  home_team_id: number;
  away_team_id: number;
  kickoff_time: string;
}

export async function upsertMatch(input: UpsertMatchInput): Promise<Match> {
  const { data, error } = await supabase
    .from("matches")
    .upsert(
      {
        external_id: input.external_id,
        home_team_id: input.home_team_id,
        away_team_id: input.away_team_id,
        kickoff_time: input.kickoff_time,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "external_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as Match;
}

async function attachTeams(matches: Match[]): Promise<MatchWithTeams[]> {
  if (matches.length === 0) return [];
  const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const { data: teams, error } = await supabase.from("teams").select("*").in("id", teamIds);
  if (error) throw error;
  const teamById = new Map((teams as Team[]).map((t) => [t.id, t]));
  return matches.map((m) => ({
    ...m,
    home_team: teamById.get(m.home_team_id)!,
    away_team: teamById.get(m.away_team_id)!,
  }));
}

/** Upcoming scheduled matches, soonest first - used by the read-only dashboard. */
export async function findUpcomingMatches(limit = 50): Promise<MatchWithTeams[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString())
    .order("kickoff_time", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return attachTeams((data ?? []) as Match[]);
}

export async function getMatchWithTeams(matchId: string): Promise<MatchWithTeams | null> {
  const { data, error } = await supabase.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [withTeams] = await attachTeams([data as Match]);
  return withTeams;
}

/** Scheduled matches kicking off within the next `hours` - used by the daily analysis batch. */
export async function findMatchesWithinHours(hours: number): Promise<MatchWithTeams[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "scheduled")
    .gte("kickoff_time", now.toISOString())
    .lt("kickoff_time", windowEnd.toISOString())
    .order("kickoff_time", { ascending: true });
  if (error) throw error;
  return attachTeams((data ?? []) as Match[]);
}

/** Scheduled matches whose kickoff was more than graceHours ago - likely finished, awaiting a result check. */
export async function findMatchesAwaitingResult(graceHours = 2): Promise<Match[]> {
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("matches").select("*").eq("status", "scheduled").lt("kickoff_time", cutoff);
  if (error) throw error;
  return (data ?? []) as Match[];
}

/**
 * Marks long-unresolved scheduled matches (kickoff more than `staleHours` ago, still no result)
 * as 'abandoned' so they stop being re-scanned every results check. The Odds API scores endpoint
 * only looks back ~3 days, so a default of 96h gives the periodic results check several chances to
 * resolve a match before we give up on it. Returns the affected matches (with teams) for alerting.
 */
export async function markStaleMatchesAbandoned(staleHours = 96): Promise<MatchWithTeams[]> {
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("matches")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("status", "scheduled")
    .lt("kickoff_time", cutoff)
    .select("*");
  if (error) throw error;
  return attachTeams((data ?? []) as Match[]);
}

export async function recordMatchResult(matchId: string, homeGoals: number, awayGoals: number): Promise<Match> {
  const { data, error } = await supabase
    .from("matches")
    .update({
      actual_home_goals: homeGoals,
      actual_away_goals: awayGoals,
      status: "finished",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Match;
}
