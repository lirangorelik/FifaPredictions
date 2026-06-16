import { supabase } from "./supabaseClient.js";
import type { OddsSnapshot } from "../types/domain.js";

export type NewOddsSnapshot = Omit<OddsSnapshot, "id" | "captured_at"> & { captured_at?: string };

export async function insertOddsSnapshot(snapshot: NewOddsSnapshot): Promise<OddsSnapshot> {
  const { data, error } = await supabase.from("odds_snapshots").insert(snapshot).select("*").single();
  if (error) throw error;
  return data as OddsSnapshot;
}

export async function getOddsHistory(matchId: string, hoursBack = 24): Promise<OddsSnapshot[]> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("odds_snapshots")
    .select("*")
    .eq("match_id", matchId)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OddsSnapshot[];
}
